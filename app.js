import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  documentId,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

(() => {
  "use strict";

  const IDENTITY_KEY = "together-diet-identity-v2";
  const WATER_TARGET = 8; // glasses per day (250ml each)
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

  const isConfigured = firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

  let app, db;
  if (isConfigured) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }

  // ---------- Identity ----------

  function loadIdentity() {
    try {
      const raw = localStorage.getItem(IDENTITY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.groupCode || !parsed.memberId) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveIdentity(identity) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  }

  function clearIdentity() {
    localStorage.removeItem(IDENTITY_KEY);
  }

  let identity = loadIdentity();

  // ---------- Date helpers ----------

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isSameDate(a, b) {
    return toISODate(a) === toISODate(b);
  }

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-indexed
  let selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // ---------- DOM refs ----------

  const onboardingEl = document.getElementById("onboarding");
  const appRootEl = document.getElementById("appRoot");
  const bootLoadingEl = document.getElementById("bootLoading");
  const configWarningEl = document.getElementById("configWarning");

  const obTabCreate = document.getElementById("obTabCreate");
  const obTabJoin = document.getElementById("obTabJoin");
  const obCreate = document.getElementById("obCreate");
  const obJoin = document.getElementById("obJoin");
  const createNameInput = document.getElementById("createName");
  const joinNameInput = document.getElementById("joinName");
  const joinCodeInput = document.getElementById("joinCode");
  const createGroupBtn = document.getElementById("createGroupBtn");
  const joinGroupBtn = document.getElementById("joinGroupBtn");
  const obErrorEl = document.getElementById("obError");

  const groupCodeValueEl = document.getElementById("groupCodeValue");
  const copyCodeBtn = document.getElementById("copyCodeBtn");
  const memberCountEl = document.getElementById("memberCount");
  const leaveGroupBtn = document.getElementById("leaveGroupBtn");

  const friendStatusListEl = document.getElementById("friendStatusList");
  const cheerOverlayEl = document.getElementById("cheerOverlay");
  const cheerImageEl = document.getElementById("cheerImage");
  const cheerTextEl = document.getElementById("cheerText");

  const userSwitchEl = document.getElementById("userSwitch");
  const monthLabelEl = document.getElementById("monthLabel");
  const calendarGridEl = document.getElementById("calendarGrid");
  const prevMonthBtn = document.getElementById("prevMonth");
  const nextMonthBtn = document.getElementById("nextMonth");

  const selectedDateLabelEl = document.getElementById("selectedDateLabel");
  const readonlyBannerEl = document.getElementById("readonlyBanner");
  const weightInput = document.getElementById("weightInput");
  const weightTrendEl = document.getElementById("weightTrend");
  const weightLockToggle = document.getElementById("weightLockToggle");
  const exerciseListEl = document.getElementById("exerciseList");
  const exerciseEmptyEl = document.getElementById("exerciseEmpty");
  const exerciseAddRowEl = document.getElementById("exerciseAddRow");
  const exerciseItemInput = document.getElementById("exerciseItemInput");
  const addExerciseItemBtn = document.getElementById("addExerciseItemBtn");
  const celebrateLayerEl = document.getElementById("celebrateLayer");
  const praiseOverlayEl = document.getElementById("praiseOverlay");
  const praiseImageEl = document.getElementById("praiseImage");
  const glassesEl = document.getElementById("glasses");
  const waterMinusBtn = document.getElementById("waterMinus");
  const waterPlusBtn = document.getElementById("waterPlus");
  const waterCaptionEl = document.getElementById("waterCaption");
  const moodPickerEl = document.getElementById("moodPicker");
  const moodBurstImageEl = document.getElementById("moodBurstImage");
  const saveBtn = document.getElementById("saveBtn");
  const saveHintEl = document.getElementById("saveHint");

  const summaryTitleEl = document.getElementById("summaryTitle");
  const sumWeightChangeEl = document.getElementById("sumWeightChange");
  const sumExerciseDaysEl = document.getElementById("sumExerciseDays");
  const sumAvgWaterEl = document.getElementById("sumAvgWater");

  // ---------- Runtime state ----------

  let members = []; // [{id, name, joinedAt}]
  let viewingMemberId = null; // whose calendar/records are currently shown
  let monthRecords = {}; // {iso: record} for viewingMemberId + viewYear/viewMonth
  let unsubscribeMembers = null;
  let unsubscribeRecords = null;
  let groupOwnerId = null; // creator of the group; falls back to earliest joiner for older groups without this field
  let draft = { weight: "", exerciseItems: [], water: 0, mood: null };
  let saveHintTimer = null;
  let trendRequestToken = 0;
  let wasAllComplete = false;
  let praiseTimer = null;

  const todayIso = toISODate(today);
  let todayListeners = {}; // {memberId: unsubscribe}
  let todayStatus = {}; // {memberId: record|null}
  let lastCheerHandledAt = null;
  let cheerOverlayTimer = null;

  function isViewingSelf() {
    return viewingMemberId === identity.memberId;
  }

  function isDraftComplete() {
    const weightOk = draft.weight !== "" && draft.weight != null;
    const waterOk = draft.water >= WATER_TARGET;
    const exerciseOk = draft.exerciseItems.length > 0 && draft.exerciseItems.every((i) => i.done);
    return weightOk && waterOk && exerciseOk;
  }

  function checkCompletion() {
    const complete = isDraftComplete();
    if (complete && !wasAllComplete) {
      showPraise();
    }
    wasAllComplete = complete;
  }

  function showPraise() {
    clearTimeout(praiseTimer);
    praiseOverlayEl.classList.remove("show");
    praiseImageEl.classList.remove("orbit");
    void praiseImageEl.offsetWidth; // force reflow so the orbit animation restarts
    praiseOverlayEl.classList.add("show");
    praiseImageEl.classList.add("orbit");
    praiseTimer = setTimeout(() => {
      praiseOverlayEl.classList.remove("show");
      praiseImageEl.classList.remove("orbit");
    }, 1500);
  }

  function hasAnyData(rec) {
    if (!rec) return false;
    return (
      (rec.weight != null && rec.weight !== "") ||
      (rec.exerciseItems && rec.exerciseItems.length > 0) ||
      rec.water > 0 ||
      rec.mood != null
    );
  }

  // ================= Onboarding =================

  if (!isConfigured) {
    configWarningEl.hidden = false;
    createGroupBtn.disabled = true;
    joinGroupBtn.disabled = true;
  }

  obTabCreate.addEventListener("click", () => switchObTab("create"));
  obTabJoin.addEventListener("click", () => switchObTab("join"));

  function switchObTab(tab) {
    obTabCreate.classList.toggle("active", tab === "create");
    obTabJoin.classList.toggle("active", tab === "join");
    obCreate.hidden = tab !== "create";
    obJoin.hidden = tab !== "join";
    obErrorEl.textContent = "";
  }

  function generateCode() {
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  async function createGroup() {
    const name = createNameInput.value.trim();
    if (!name) {
      obErrorEl.textContent = "닉네임을 입력해주세요";
      return;
    }
    createGroupBtn.disabled = true;
    obErrorEl.textContent = "";
    try {
      const memberId = randomId();
      let code = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCode();
        const ref = doc(db, "groups", candidate);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, { createdAt: serverTimestamp(), ownerId: memberId });
          code = candidate;
          break;
        }
      }
      if (!code) {
        obErrorEl.textContent = "코드 생성에 실패했어요. 다시 시도해주세요.";
        return;
      }
      await setDoc(doc(db, "groups", code, "members", memberId), {
        name,
        joinedAt: serverTimestamp(),
      });
      identity = { groupCode: code, memberId, name };
      saveIdentity(identity);
      enterApp();
    } catch (e) {
      console.error(e);
      obErrorEl.textContent = "그룹을 만들지 못했어요. Firebase 설정을 확인해주세요.";
    } finally {
      createGroupBtn.disabled = false;
    }
  }

  async function joinGroup() {
    const name = joinNameInput.value.trim();
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!name) {
      obErrorEl.textContent = "닉네임을 입력해주세요";
      return;
    }
    if (!code) {
      obErrorEl.textContent = "그룹 코드를 입력해주세요";
      return;
    }
    joinGroupBtn.disabled = true;
    obErrorEl.textContent = "";
    try {
      const groupRef = doc(db, "groups", code);
      const snap = await getDoc(groupRef);
      if (!snap.exists()) {
        obErrorEl.textContent = "존재하지 않는 그룹 코드예요";
        return;
      }
      const memberId = randomId();
      await setDoc(doc(db, "groups", code, "members", memberId), {
        name,
        joinedAt: serverTimestamp(),
      });
      identity = { groupCode: code, memberId, name };
      saveIdentity(identity);
      enterApp();
    } catch (e) {
      console.error(e);
      obErrorEl.textContent = "참여하지 못했어요. Firebase 설정을 확인해주세요.";
    } finally {
      joinGroupBtn.disabled = false;
    }
  }

  createGroupBtn.addEventListener("click", createGroup);
  joinGroupBtn.addEventListener("click", joinGroup);

  leaveGroupBtn.addEventListener("click", () => {
    const ok = confirm("그룹에서 나갈까요? 이 기기에서 다시 참여하려면 그룹 코드가 필요해요.");
    if (!ok) return;
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeRecords) unsubscribeRecords();
    clearIdentity();
    identity = null;
    location.reload();
  });

  function handleRemovedFromGroup() {
    if (unsubscribeMembers) unsubscribeMembers();
    if (unsubscribeRecords) unsubscribeRecords();
    Object.values(todayListeners).forEach((unsub) => unsub());
    todayListeners = {};
    clearIdentity();
    identity = null;
    alert("그룹장에 의해 그룹에서 제외되었어요.");
    location.reload();
  }

  copyCodeBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(identity.groupCode);
      copyCodeBtn.textContent = "복사됨";
      setTimeout(() => (copyCodeBtn.textContent = "복사"), 1500);
    } catch (e) {
      /* clipboard unavailable, ignore */
    }
  });

  // ================= App entry =================

  function enterApp() {
    onboardingEl.hidden = true;
    bootLoadingEl.style.display = "none";
    appRootEl.hidden = false;
    viewingMemberId = identity.memberId;
    groupCodeValueEl.textContent = identity.groupCode;
    loadGroupOwner();
    subscribeMembers();
    subscribeRecords();
    loadDraftForSelectedDate();
    renderCalendar();
    renderSummary();
  }

  async function loadGroupOwner() {
    try {
      const snap = await getDoc(doc(db, "groups", identity.groupCode));
      groupOwnerId = (snap.exists() && snap.data().ownerId) || null;
    } catch (e) {
      groupOwnerId = null;
    }
    renderMemberTabs();
    renderFriendStatus();
  }

  // groups created before the owner field existed fall back to their earliest joiner
  function effectiveOwnerId() {
    return groupOwnerId || (members[0] && members[0].id) || null;
  }

  // ================= Members (real-time) =================

  function subscribeMembers() {
    const ref = collection(db, "groups", identity.groupCode, "members");
    unsubscribeMembers = onSnapshot(ref, (snap) => {
      members = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const at = a.joinedAt?.toMillis ? a.joinedAt.toMillis() : 0;
          const bt = b.joinedAt?.toMillis ? b.joinedAt.toMillis() : 0;
          return at - bt;
        });
      if (members.length > 0 && !members.find((m) => m.id === identity.memberId)) {
        handleRemovedFromGroup();
        return;
      }
      if (!members.find((m) => m.id === viewingMemberId)) {
        viewingMemberId = identity.memberId;
        subscribeRecords();
        loadDraftForSelectedDate();
        renderCalendar();
        renderSummary();
      }
      renderMemberTabs();
      memberCountEl.textContent = `그룹원 ${members.length}명`;
      syncTodayListeners();
      checkForIncomingCheer();
    });
  }

  function renderMemberTabs() {
    userSwitchEl.innerHTML = "";
    const ownerId = effectiveOwnerId();
    members.forEach((m) => {
      const isMe = m.id === identity.memberId;
      const isOwner = m.id === ownerId;
      const btn = document.createElement("button");
      btn.className = "user-tab" + (m.id === viewingMemberId ? " active" : "");
      btn.innerHTML = `${escapeHtml(m.name)}${isOwner ? '<span class="owner-badge">👑 그룹장</span>' : ""}${isMe ? '<span class="me-badge">나</span><span class="edit-icon">✎</span>' : ""}`;
      btn.addEventListener("click", () => {
        if (isMe && m.id === viewingMemberId) {
          renameSelf();
          return;
        }
        if (m.id === viewingMemberId) return;
        viewingMemberId = m.id;
        renderMemberTabs();
        subscribeRecords();
        loadDraftForSelectedDate();
        renderCalendar();
        renderSummary();
      });
      userSwitchEl.appendChild(btn);
    });
  }

  async function renameSelf() {
    const next = prompt("이름을 입력하세요", identity.name);
    if (next && next.trim()) {
      const name = next.trim().slice(0, 12);
      await setDoc(doc(db, "groups", identity.groupCode, "members", identity.memberId), { name }, { merge: true });
      identity.name = name;
      saveIdentity(identity);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ================= Friend status card =================

  function syncTodayListeners() {
    const currentIds = new Set(members.filter((m) => m.id !== identity.memberId).map((m) => m.id));

    Object.keys(todayListeners).forEach((memberId) => {
      if (!currentIds.has(memberId)) {
        todayListeners[memberId]();
        delete todayListeners[memberId];
        delete todayStatus[memberId];
      }
    });

    currentIds.forEach((memberId) => {
      if (todayListeners[memberId]) return;
      const ref = doc(db, "groups", identity.groupCode, "members", memberId, "records", todayIso);
      todayListeners[memberId] = onSnapshot(ref, (snap) => {
        todayStatus[memberId] = snap.exists() ? snap.data() : null;
        renderFriendStatus();
      });
    });

    renderFriendStatus();
  }

  function renderFriendStatus() {
    const friends = members.filter((m) => m.id !== identity.memberId);
    const isOwnerViewing = identity.memberId === effectiveOwnerId();
    friendStatusListEl.innerHTML = "";

    if (friends.length === 0) {
      const empty = document.createElement("p");
      empty.className = "friend-status-empty";
      empty.textContent = "아직 그룹에 참여한 친구가 없어요. 그룹 코드를 공유해보세요!";
      friendStatusListEl.appendChild(empty);
      return;
    }

    friends.forEach((friend) => {
      const rec = todayStatus[friend.id];

      const exerciseDone = !!rec && rec.exerciseItems && rec.exerciseItems.length > 0 && rec.exerciseItems.every((i) => i.done);
      const exerciseStarted = !!rec && rec.exerciseItems && rec.exerciseItems.length > 0;
      const exerciseText = exerciseDone ? "운동 완료" : exerciseStarted ? "운동 진행 중" : "운동 기록 전";

      const water = rec?.water || 0;
      const waterText = water >= WATER_TARGET ? `물 ${water}잔 달성` : `물 ${water}잔`;

      const weightText = rec && rec.weight != null && rec.weight !== "" ? "몸무게 기록 완료" : "몸무게 기록 전";

      const row = document.createElement("div");
      row.className = "friend-status-row";

      const text = document.createElement("div");
      text.className = "friend-status-text";
      text.innerHTML = `오늘 <span class="friend-status-name">${escapeHtml(friend.name)}</span>는<span class="friend-status-line">${exerciseText} · ${waterText} · ${weightText}</span>`;
      row.appendChild(text);

      const actions = document.createElement("div");
      actions.className = "friend-status-actions";

      const cheerBtn = document.createElement("button");
      cheerBtn.className = "cheer-btn";
      cheerBtn.type = "button";
      cheerBtn.textContent = "👏 응원하기";
      cheerBtn.addEventListener("click", () => sendCheer(friend.id, cheerBtn));
      actions.appendChild(cheerBtn);

      if (isOwnerViewing) {
        const kickBtn = document.createElement("button");
        kickBtn.className = "kick-btn";
        kickBtn.type = "button";
        kickBtn.textContent = "내보내기";
        kickBtn.addEventListener("click", () => kickMember(friend.id, friend.name, kickBtn));
        actions.appendChild(kickBtn);
      }

      row.appendChild(actions);
      friendStatusListEl.appendChild(row);
    });
  }

  async function sendCheer(targetMemberId, btnEl) {
    const originalText = btnEl.textContent;
    btnEl.disabled = true;
    try {
      await setDoc(
        doc(db, "groups", identity.groupCode, "members", targetMemberId),
        { lastCheer: { fromName: identity.name, at: serverTimestamp() } },
        { merge: true }
      );
      btnEl.textContent = "보냈어요!";
      btnEl.classList.add("sent");
      setTimeout(() => {
        btnEl.textContent = originalText;
        btnEl.classList.remove("sent");
        btnEl.disabled = false;
      }, 1500);
    } catch (e) {
      console.error(e);
      btnEl.textContent = originalText;
      btnEl.disabled = false;
    }
  }

  async function kickMember(targetMemberId, targetName, btnEl) {
    const ok = confirm(`${targetName}님을 그룹에서 내보낼까요? 이 작업은 되돌릴 수 없어요.`);
    if (!ok) return;
    btnEl.disabled = true;
    try {
      const recordsSnap = await getDocs(recordsCollection(targetMemberId));
      await Promise.all(recordsSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "groups", identity.groupCode, "members", targetMemberId));
    } catch (e) {
      console.error(e);
      alert("내보내지 못했어요. 다시 시도해주세요.");
      btnEl.disabled = false;
    }
  }

  function checkForIncomingCheer() {
    const me = members.find((m) => m.id === identity.memberId);
    const cheer = me?.lastCheer;
    if (!cheer || !cheer.at || !cheer.at.toMillis) return;
    const ts = cheer.at.toMillis();
    if (ts === lastCheerHandledAt) return;
    lastCheerHandledAt = ts;
    showCheerOverlay(cheer);
    setDoc(doc(db, "groups", identity.groupCode, "members", identity.memberId), { lastCheer: null }, { merge: true }).catch((e) =>
      console.error(e)
    );
  }

  function showCheerOverlay(cheer) {
    cheerTextEl.textContent = `${cheer.fromName}님이 응원을 보냈어요 👏`;
    cheerOverlayEl.classList.remove("show");
    cheerImageEl.classList.remove("spin");
    void cheerImageEl.offsetWidth; // force reflow so the spin animation restarts
    cheerOverlayEl.classList.add("show");
    cheerImageEl.classList.add("spin");
    clearTimeout(cheerOverlayTimer);
    cheerOverlayTimer = setTimeout(() => {
      cheerOverlayEl.classList.remove("show");
      cheerImageEl.classList.remove("spin");
    }, 1800);
  }

  // ================= Records (real-time, current month) =================

  function recordsCollection(memberId) {
    return collection(db, "groups", identity.groupCode, "members", memberId, "records");
  }

  function subscribeRecords() {
    if (unsubscribeRecords) unsubscribeRecords();
    const start = `${viewYear}-${pad(viewMonth + 1)}-01`;
    const end = `${viewYear}-${pad(viewMonth + 1)}-31`;
    const q = query(recordsCollection(viewingMemberId), where(documentId(), ">=", start), where(documentId(), "<=", end));
    unsubscribeRecords = onSnapshot(q, (snap) => {
      monthRecords = {};
      snap.forEach((d) => (monthRecords[d.id] = d.data()));
      renderCalendar();
      renderSummary();
      refreshDetailFromLiveData();
    });
  }

  function refreshDetailFromLiveData() {
    const iso = toISODate(selectedDate);
    if (isViewingSelf()) return; // self edits via draft, not live overwrite
    const rec = monthRecords[iso];
    draft = rec
      ? {
          weight: rec.weight ?? "",
          exerciseItems: (rec.exerciseItems || []).map((i) => ({ ...i })),
          water: rec.water || 0,
          mood: rec.mood ?? null,
        }
      : { weight: "", exerciseItems: [], water: 0, mood: null };
    wasAllComplete = isDraftComplete();
    renderDetail();
  }

  // ================= Detail panel =================

  function loadDraftForSelectedDate() {
    const iso = toISODate(selectedDate);
    const rec = monthRecords[iso];
    draft = rec
      ? {
          weight: rec.weight ?? "",
          exerciseItems: (rec.exerciseItems || []).map((i) => ({ ...i })),
          water: rec.water || 0,
          mood: rec.mood ?? null,
        }
      : { weight: "", exerciseItems: [], water: 0, mood: null };
    wasAllComplete = isDraftComplete();
    renderDetail();
  }

  function formatDateLabel(date) {
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
    const isToday = isSameDate(date, today);
    return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekday})${isToday ? " · 오늘" : ""}`;
  }

  async function fetchPreviousWeight(memberId, iso) {
    const q = query(recordsCollection(memberId), where(documentId(), "<", iso), orderBy(documentId(), "desc"), limit(7));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data();
      if (data.weight != null && data.weight !== "") return Number(data.weight);
    }
    return null;
  }

  function renderDetail() {
    const viewingSelf = isViewingSelf();
    const viewingMember = members.find((m) => m.id === viewingMemberId);

    selectedDateLabelEl.textContent = formatDateLabel(selectedDate);
    readonlyBannerEl.hidden = viewingSelf;
    if (!viewingSelf && viewingMember) {
      readonlyBannerEl.textContent = `👀 ${viewingMember.name}님의 기록이에요 · 읽기 전용`;
    }

    const weightLocked = !!viewingMember?.weightLocked;
    weightLockToggle.hidden = !viewingSelf;
    if (viewingSelf) {
      weightLockToggle.textContent = weightLocked ? "🔒 비공개" : "🔓 공개";
      weightLockToggle.classList.toggle("locked", weightLocked);
    }

    if (!viewingSelf && weightLocked) {
      weightInput.value = "";
      weightInput.placeholder = "🔒 비공개";
    } else {
      weightInput.value = draft.weight;
      weightInput.placeholder = "0.0";
    }
    weightInput.disabled = !viewingSelf;
    waterMinusBtn.disabled = !viewingSelf;
    waterPlusBtn.disabled = !viewingSelf;
    saveBtn.hidden = !viewingSelf;
    exerciseAddRowEl.hidden = !viewingSelf;

    renderExerciseList();
    renderGlasses();
    renderWeightTrend();
    renderMoodPicker();
    saveHintEl.textContent = "";
  }

  function renderMoodPicker() {
    const viewingSelf = isViewingSelf();
    moodPickerEl.querySelectorAll(".mood-option").forEach((btn) => {
      const mood = btn.dataset.mood;
      btn.classList.toggle("selected", draft.mood === mood);
      btn.disabled = !viewingSelf;
    });
  }

  function renderExerciseList() {
    const viewingSelf = isViewingSelf();
    exerciseListEl.innerHTML = "";
    exerciseEmptyEl.hidden = draft.exerciseItems.length > 0;

    draft.exerciseItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = "exercise-item" + (item.done ? " done" : "");

      const check = document.createElement("button");
      check.className = "exercise-check";
      check.type = "button";
      check.textContent = "✓";
      check.disabled = !viewingSelf;
      check.addEventListener("click", () => {
        item.done = !item.done;
        const allDone = draft.exerciseItems.length > 0 && draft.exerciseItems.every((i) => i.done);
        renderExerciseList();
        if (item.done && allDone) celebrateBurst(exerciseListEl);
        checkCompletion();
      });
      li.appendChild(check);

      const text = document.createElement("span");
      text.className = "exercise-text";
      text.textContent = item.text;
      li.appendChild(text);

      if (viewingSelf) {
        const del = document.createElement("button");
        del.className = "exercise-delete";
        del.type = "button";
        del.textContent = "×";
        del.setAttribute("aria-label", "삭제");
        del.addEventListener("click", () => {
          draft.exerciseItems = draft.exerciseItems.filter((i) => i !== item);
          renderExerciseList();
          checkCompletion();
        });
        li.appendChild(del);
      }

      exerciseListEl.appendChild(li);
    });
  }

  function celebrateBurst(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const symbols = ["⭐", "✨", "🌟"];
    const count = 16;

    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = "star-particle";
      el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 90;
      el.style.left = `${originX}px`;
      el.style.top = `${originY}px`;
      el.style.fontSize = `${14 + Math.random() * 14}px`;
      el.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      el.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      el.style.setProperty("--rot", `${Math.random() * 360 - 180}deg`);
      el.style.animationDelay = `${Math.random() * 0.12}s`;
      el.addEventListener("animationend", () => el.remove());
      celebrateLayerEl.appendChild(el);
    }
  }

  function addExerciseItem() {
    if (!isViewingSelf()) return;
    const text = exerciseItemInput.value.trim();
    if (!text) return;
    draft.exerciseItems.push({ id: randomId(), text, done: false });
    exerciseItemInput.value = "";
    renderExerciseList();
    checkCompletion();
  }

  addExerciseItemBtn.addEventListener("click", addExerciseItem);
  exerciseItemInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return; // ignore IME composition-confirm Enter
    e.preventDefault();
    addExerciseItem();
  });

  function renderWeightTrend() {
    const iso = toISODate(selectedDate);
    const curr = draft.weight === "" ? null : Number(draft.weight);
    const myToken = ++trendRequestToken;
    weightTrendEl.textContent = "";
    weightTrendEl.className = "trend";
    if (curr == null) return;

    fetchPreviousWeight(viewingMemberId, iso).then((prev) => {
      if (myToken !== trendRequestToken) return; // stale response
      if (prev == null) return;
      const diff = Math.round((curr - prev) * 10) / 10;
      if (diff === 0) {
        weightTrendEl.textContent = "변화 없음";
        weightTrendEl.className = "trend";
      } else if (diff > 0) {
        weightTrendEl.textContent = `▲ ${diff}kg`;
        weightTrendEl.className = "trend up";
      } else {
        weightTrendEl.textContent = `▼ ${Math.abs(diff)}kg`;
        weightTrendEl.className = "trend down";
      }
    });
  }

  function renderGlasses() {
    const viewingSelf = isViewingSelf();
    glassesEl.innerHTML = "";
    const total = Math.max(WATER_TARGET, draft.water);
    for (let i = 0; i < total; i++) {
      const g = document.createElement("div");
      g.className = "glass" + (i < draft.water ? " filled" : "");
      if (viewingSelf) {
        g.addEventListener("click", () => {
          draft.water = i + 1 === draft.water ? i : i + 1;
          renderGlasses();
        });
      }
      glassesEl.appendChild(g);
    }
    updateWaterCaption();
  }

  function updateWaterCaption() {
    const ml = draft.water * 250;
    const reached = draft.water >= WATER_TARGET ? " · 목표 달성!" : "";
    waterCaptionEl.textContent = `${draft.water}잔 · ${ml}ml${reached}`;
  }

  // ---------- Events: detail panel (only meaningful when viewing self) ----------

  weightInput.addEventListener("input", () => {
    draft.weight = weightInput.value;
    renderWeightTrend();
    checkCompletion();
  });

  weightLockToggle.addEventListener("click", async () => {
    const me = members.find((m) => m.id === identity.memberId);
    const next = !me?.weightLocked;
    try {
      await setDoc(doc(db, "groups", identity.groupCode, "members", identity.memberId), { weightLocked: next }, { merge: true });
      if (me) me.weightLocked = next;
      renderDetail();
    } catch (e) {
      console.error(e);
    }
  });

  moodPickerEl.addEventListener("click", (e) => {
    if (!isViewingSelf()) return;
    const btn = e.target.closest(".mood-option");
    if (!btn) return;
    const mood = btn.dataset.mood;
    const selecting = draft.mood !== mood;
    draft.mood = selecting ? mood : null;
    renderMoodPicker();
    if (selecting) {
      const img = btn.querySelector("img");
      if (img) triggerMoodBurst(img);
    }
  });

  let moodBurstTimer = null;

  function triggerMoodBurst(sourceImg) {
    const rect = sourceImg.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // grow to fill most of the viewport while keeping the image's real aspect ratio,
    // so the browser re-lays-out (and re-rasterizes) the image at each size instead of
    // just stretching a small cached texture — that stretching is what looked "broken".
    const naturalRatio = sourceImg.naturalWidth && sourceImg.naturalHeight ? sourceImg.naturalWidth / sourceImg.naturalHeight : 1;
    const maxW = vw * 0.8;
    const maxH = vh * 0.7;
    let targetW = maxW;
    let targetH = targetW / naturalRatio;
    if (targetH > maxH) {
      targetH = maxH;
      targetW = targetH * naturalRatio;
    }
    const targetLeft = (vw - targetW) / 2;
    const targetTop = (vh - targetH) / 2;

    clearTimeout(moodBurstTimer);
    moodBurstImageEl.src = sourceImg.src;
    moodBurstImageEl.classList.add("burst");
    moodBurstImageEl.style.transition = "none";
    moodBurstImageEl.style.left = `${rect.left}px`;
    moodBurstImageEl.style.top = `${rect.top}px`;
    moodBurstImageEl.style.width = `${rect.width}px`;
    moodBurstImageEl.style.height = `${rect.height}px`;
    moodBurstImageEl.style.opacity = "1";

    void moodBurstImageEl.offsetWidth; // force reflow so the transition below actually animates

    moodBurstImageEl.style.transition =
      "left 0.9s ease-out, top 0.9s ease-out, width 0.9s ease-out, height 0.9s ease-out, opacity 0.6s ease-in 0.9s";
    moodBurstImageEl.style.left = `${targetLeft}px`;
    moodBurstImageEl.style.top = `${targetTop}px`;
    moodBurstImageEl.style.width = `${targetW}px`;
    moodBurstImageEl.style.height = `${targetH}px`;
    moodBurstImageEl.style.opacity = "0";

    moodBurstTimer = setTimeout(() => {
      moodBurstImageEl.classList.remove("burst");
    }, 1550);
  }

  waterPlusBtn.addEventListener("click", () => {
    if (!isViewingSelf()) return;
    draft.water += 1;
    renderGlasses();
    checkCompletion();
  });

  waterMinusBtn.addEventListener("click", () => {
    if (!isViewingSelf()) return;
    draft.water = Math.max(0, draft.water - 1);
    renderGlasses();
    checkCompletion();
  });

  saveBtn.addEventListener("click", async () => {
    if (!isViewingSelf()) return;
    const iso = toISODate(selectedDate);
    const cleaned = {
      weight: draft.weight === "" ? null : Number(draft.weight),
      exerciseItems: draft.exerciseItems.map((i) => ({ id: i.id, text: i.text, done: !!i.done })),
      water: draft.water,
      mood: draft.mood ?? null,
      updatedAt: serverTimestamp(),
    };

    saveBtn.disabled = true;
    try {
      const ref = doc(db, "groups", identity.groupCode, "members", identity.memberId, "records", iso);
      if (hasAnyData(cleaned)) {
        await setDoc(ref, cleaned);
      } else {
        await deleteDoc(ref);
      }
      saveHintEl.textContent = "저장되었어요";
      clearTimeout(saveHintTimer);
      saveHintTimer = setTimeout(() => (saveHintEl.textContent = ""), 1800);
    } catch (e) {
      console.error(e);
      saveHintEl.textContent = "저장에 실패했어요";
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ================= Calendar =================

  function renderCalendar() {
    monthLabelEl.textContent = `${viewYear}년 ${viewMonth + 1}월`;
    calendarGridEl.innerHTML = "";

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement("div");
      empty.className = "day-cell empty";
      calendarGridEl.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(viewYear, viewMonth, day);
      const iso = toISODate(cellDate);
      const rec = monthRecords[iso];

      const cell = document.createElement("div");
      cell.className = "day-cell";
      if (isSameDate(cellDate, today)) cell.classList.add("today");
      if (isSameDate(cellDate, selectedDate)) cell.classList.add("selected");

      const num = document.createElement("span");
      num.textContent = String(day);
      cell.appendChild(num);

      const dots = document.createElement("div");
      dots.className = "dots";
      if (rec && rec.weight != null && rec.weight !== "") {
        const d = document.createElement("i");
        d.className = "dot weight-dot";
        dots.appendChild(d);
      }
      if (rec && rec.exerciseItems && rec.exerciseItems.some((i) => i.done)) {
        const d = document.createElement("i");
        d.className = "dot exercise-dot";
        dots.appendChild(d);
      }
      if (rec && rec.water >= WATER_TARGET) {
        const d = document.createElement("i");
        d.className = "dot water-dot";
        dots.appendChild(d);
      }
      cell.appendChild(dots);

      cell.addEventListener("click", () => {
        selectedDate = cellDate;
        loadDraftForSelectedDate();
        renderCalendar();
      });

      calendarGridEl.appendChild(cell);
    }
  }

  prevMonthBtn.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    subscribeRecords();
    renderCalendar();
  });

  nextMonthBtn.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    subscribeRecords();
    renderCalendar();
  });

  // ================= Summary =================

  function renderSummary() {
    const viewingMember = members.find((m) => m.id === viewingMemberId);
    summaryTitleEl.textContent = viewingMember && viewingMember.id !== identity.memberId
      ? `${viewingMember.name}님의 이번 달 요약`
      : "이번 달 요약";

    const entries = Object.keys(monthRecords)
      .sort()
      .map((d) => monthRecords[d]);

    const weighed = entries.filter((r) => r.weight != null);
    if (weighed.length >= 1) {
      const first = Number(weighed[0].weight);
      const last = Number(weighed[weighed.length - 1].weight);
      if (weighed.length === 1) {
        sumWeightChangeEl.textContent = `${first}kg`;
      } else {
        const diff = Math.round((last - first) * 10) / 10;
        sumWeightChangeEl.textContent = `${diff > 0 ? "+" : ""}${diff}kg`;
      }
    } else {
      sumWeightChangeEl.textContent = "-";
    }

    const exerciseDays = entries.filter((r) => r.exerciseItems && r.exerciseItems.some((i) => i.done)).length;
    sumExerciseDaysEl.textContent = entries.length ? `${exerciseDays}일` : "-";

    const waterEntries = entries.filter((r) => r.water > 0);
    if (waterEntries.length) {
      const avg = waterEntries.reduce((sum, r) => sum + r.water, 0) / waterEntries.length;
      sumAvgWaterEl.textContent = `${Math.round(avg * 10) / 10}잔`;
    } else {
      sumAvgWaterEl.textContent = "-";
    }
  }

  // ================= Init =================

  if (identity && isConfigured) {
    enterApp();
  }
})();
