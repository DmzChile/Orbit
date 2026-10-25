# 0005 — 요청 #1: 사이드바 높이와 NSIS 앱 업데이트

날짜: 2026-10-25 · 상태: 구현, 출시 수명주기 실검증은 별도

요청: https://github.com/DmzChile/Orbit/issues/1 · request ID c46eb677-f9f1-4a64-86e9-738320b51333 · version 3

## 요청 처리 경로 조사

기존 AGENTS.md 1/4/8/9, docs/REQUIREMENTS.md GH-02~04/AUTO-06~11/RES-01~04, docs/EXTERNAL_CHATGPT.md 1~5에 이미 처리 방식이 있다. 열린 Issue의 최신 요청/모든 댓글 확인, 큐/취소/중복 검사, 스냅샷·규칙 해시·기준 SHA, 격리 작업, 동일 orbit-run:v1 댓글의 단계 갱신, 검증 후 PR 및 결과/실제 산출물 게시 순서다. 별도의 절차가 없다고 보고할 근거가 없다.

요청은 수동이며 큐 댓글은 없었다. 사용자의 현재 직접 실행 지시를 이번 수동 회차의 근거로 기록한다. 실행 시 main=5f1fcb23ede95a24ab6265a8d9ccb61b66252e57은 문서/디자인만 포함하고 앱 코드는 구현 브랜치 5430955a43ec1d554c1e50b22dc727e91ba602c4에 있었다. 기존 체크아웃을 수정하지 않고 격리 복사했다. PR 대상은 요청의 main이며 기존 미병합 앱 구현 커밋을 포함함을 PR에 명시한다. 기본 브랜치 직접 push/자동 merge/공개 릴리스 발행은 수행하지 않는다.

## UI

HTML 참조의 색/너비/계층은 보존한다. 기존 main은 콘텐츠 높이만큼 페이지 전체를 늘렸지만 aside는 sticky+viewport height로 제한되어 문서 스크롤 바닥에서 짧아졌다. app을 창 높이의 flex column, shell을 남은 높이의 grid(min-height:0), aside/main을 독립 scroll 영역으로 구성한다. 상단 업데이트 공지도 shell 높이 계산에 반영한다. 좁은 창에서도 설정 아이콘을 사용할 수 있게 한다.

## 업데이트 선택

기존 electron-builder 26 NSIS와 직접 호환되는 electron-updater 6.8.11(MIT)를 고정한다. Electron 기본 autoUpdater의 Squirrel 공급자 전환이나 자체 설치 파일 실행기를 만드는 것보다 기존 패키징과 이어지고 다운로드 검증을 재사용할 수 있다. 별도 상시 서버 없이 공개 GitHub Releases를 사용한다. 앱에 배포 토큰을 넣지 않는다. production dependency의 크기·라이선스 고지는 lockfile 및 notices에 반영한다.

공식 v26 API: https://www.electron.build/v26/docs/api/electron-updater.class.appupdater/

기본 autoDownload와 autoInstallOnAppQuit을 모두 끄며 다운그레이드/시험 릴리스/web installer를 허용하지 않는다. provider 설정은 패키지에 고정하고 renderer에는 state/check/online/download/install 동작만 노출한다. 기존 sender/frame 검사와 입력 검증을 통과해야 한다. 재시작 확인·데이터 저장 실패 시 설치를 시작하지 않으며 복구한다. 다운로드 검증/서명 검증을 우회하는 코드를 두지 않는다.

## 출시 경계

조사 시 GitHub Releases는 비어 있었다. 태그 일치와 검사 통과 후 exe/blockmap/latest.yml을 함께 배포하는 workflow를 추가하지만 이번 개발은 태그·릴리스를 발행하지 않는다. 기존 0.1.3에서 자체 업데이트 코드를 소급 실행할 수 없으므로 한 번의 초기 설치가 필요하다. 미서명 상태를 표시한다. 실제 두 공개 릴리스 간 업그레이드·rollback과 OS DPI/스크린리더 검증이 완료되기 전 SHIP-01 전체를 검증됨으로 표시하지 않는다.
