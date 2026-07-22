# 설정 방법

이 앱은 여러 기기 간 데이터 동기화를 위해 Firebase(Firestore)를 사용합니다. 아래 두 가지를 준비해야 실제로 친구와 함께 쓸 수 있습니다.

1. Firebase 프로젝트 생성 (데이터 저장/동기화)
2. 정적 호스팅 (친구가 접속할 URL)

## 1. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 후 구글 계정으로 로그인, "프로젝트 추가"로 새 프로젝트 생성 (이름은 자유롭게, 애널리틱스는 꺼도 무방).
2. 왼쪽 메뉴 **빌드 > Firestore Database** 이동 → "데이터베이스 만들기" → 위치는 가까운 리전(asia-northeast3 등) 선택 → **테스트 모드**로 시작.
3. 프로젝트 개요 옆 톱니바퀴 → **프로젝트 설정** → 아래로 스크롤해 "내 앱" 섹션 → 웹 아이콘(`</>`)으로 웹 앱 등록 (이름 아무거나) → 호스팅 설정은 건너뛰어도 됨.
4. 화면에 나오는 `firebaseConfig` 객체 값을 복사해서, 이 프로젝트의 `firebase-config.js` 파일 안 값들을 그대로 교체하세요.

## 2. Firestore 보안 규칙 설정

Firestore Database > **규칙** 탭에서 아래 내용으로 교체 후 게시하세요.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /groups/{groupCode} {
      allow read, create: if true;

      match /members/{memberId} {
        allow read, create, update, delete: if true;

        match /records/{date} {
          allow read, write: if true;
        }
      }
    }
  }
}
```

> `members`에 `delete`가 포함되어야 그룹장이 멤버 내보내기(강퇴) 기능을 쓸 수 있어요. 이미 배포된 프로젝트라면 콘솔의 규칙 탭에서 `allow read, create, update: if true;`를 `allow read, create, update, delete: if true;`로 바꾸고 다시 게시하면 됩니다.

> 참고: 별도 로그인 없이 "그룹 코드"만으로 참여하는 구조라 규칙도 인증 없이 열려 있습니다. 그룹 코드(5자리, 약 3,300만 개 조합)를 아는 사람만 접근할 수 있지만, 완전히 안전한 인증 시스템은 아니므로 민감한 정보는 기록하지 마세요.

## 3. 로컬에서 테스트하기

파일을 더블클릭해서 여는 대신, 같은 폴더에서 간단한 로컬 서버를 켜서 열어보세요 (ES 모듈 방식이라 `file://`로 열면 일부 브라우저에서 막힐 수 있습니다).

```
cd /Users/yunseo/my-first-app
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 접속.

## 4. 친구와 함께 쓰려면: 정적 호스팅에 배포

친구가 각자 기기에서 접속하려면 인터넷에 공개된 URL이 필요합니다. 아래 중 아무거나 무료로 사용 가능합니다.

- **GitHub Pages**: 이 폴더를 GitHub 저장소에 올리고 Settings > Pages에서 활성화.
- **Netlify / Vercel**: 폴더를 그대로 드래그 앤 드롭하거나 GitHub 연동으로 배포.

배포 후 나온 URL을 친구에게 공유하면, 각자 접속해서 "그룹 만들기"(처음 만든 사람) / "코드로 참여하기"(나머지)로 같은 그룹에 들어와 서로의 기록을 볼 수 있습니다.
