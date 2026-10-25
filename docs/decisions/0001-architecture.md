# 기술 결정 0001 — Windows shell, 로컬 데이터, 선택적 원격 실행

상태: 일부 대체됨 — 기본 예약·뉴스 공급자는 [0002](0002-external-chatgpt-korean-news-motion.md)로 대체. API worker 경계는 선택적 이전 요청에만 적용(제품 연결과 출시 검증은 상태표 별도) · 확인일: 2026-10-25 Asia/Seoul

## 범위와 근거

전체 제품 구현 요청에 따라 APP/NEWS/CAL/WID/GH/AUTO/RES/UX/DATA/API/SEC/OPS/REL/SHIP/E2E 항목 전체를 추적한다. 기준 문서는 수정하지 않는다. 구현 전 AGENTS.md와 REQUIREMENTS.md 전체, design/README.md 및 HTML 원본의 CSS·화면·스크립트를 읽었다. Figma 파일은 도구로 열지 않았으므로 Figma 직접 확인으로 보고하지 않는다. 원본 HTML은 변경하지 않는다.

## 비교와 선택

| 선택지 | 장점 | 제약 / 결정 |
|---|---|---|
| Electron + TypeScript + React | HTML 디자인을 직접 계승, Windows 창 제어·DPAPI·알림·설치 파일, UI와 도메인 분리 | 배포 크기와 메모리 비용. 이 스택을 채택 |
| Tauri | 작은 shell, Rust 경계 | 별도 Rust/WebView 빌드 체인과 초기 개발 비용 |
| .NET/WinUI | Windows 기본 접근성과 통합 | HTML 디자인 이식 비용, SDK/패키징 구성 필요 |

Windows 11 x64를 1차 지원 대상으로 확정한다. 최소 창은 640×480 DIP, 권장 디자인 기준 1440×1000, RAM 4GB 이상/설치 여유 1GB를 권장한다. 최소 RAM에서의 실측은 아직 없다. Windows 창 제어는 OS의 titlebar overlay를 사용한다. 시스템 글꼴 Segoe UI/Malgun Gothic을 사용한다.

## 저장과 복구

클라이언트의 일정·보드·저장 기사·읽음·학습 기록은 해당 Windows 사용자의 로컬 데이터가 기준이다. JSON 스키마 v1, 순차 트랜잭션, fsync 후 rename, 직전 백업, 낡은 프로세스 잠금 복구, 버전 충돌 검사를 사용한다. 최초 공개 스키마가 v1이므로 임의의 과거 포맷을 추정해 변환하지 않는다. 마이그레이션 레지스트리를 두고 미래/미지원 버전은 덮어쓰지 않는다. 백업/가져오기/로컬 초기화를 제공한다.

원격 요청/예약/실행/산출물 메타데이터는 GitHub Issue/작업 실행/산출물이 기준이다. 로컬 읽음·알림 수신 상태는 병합 시 유지한다. 추적 Issue는 커서와 관계없이 조회하여 댓글 수정으로 인한 누락을 복구한다. 충돌 시 원격 정의를 확인한 뒤 사용자가 편집을 다시 적용한다. 오프라인 일정/보드 변경은 원격과 동기화하지 않는 로컬 소유 데이터다.

## 공식 AI·예약 경로 확인 (AUTO-03/04)

[ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations), [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [공식 함수 호출 문서](https://developers.openai.com/api/docs/guides/function-calling)를 실제 열어 확인했다. ChatGPT UI 예약의 존재와 제3자 앱의 생성/인증/결과 수신 계약은 구분한다. 현재 연결 계정에서 ChatGPT 자체 예약용 공개 계약·배포용 자격증명은 검증되지 않았다. 따라서 직접 연동은 미지원이다. 개발 세션의 Codex 도구/구독 권한을 배포 앱의 권한으로 재사용하지 않는다. 별도 Agents API 계열 기능의 존재를 ChatGPT 자체 예약 계약의 증거로 삼지 않는다.

대안은 **GitHub Actions 스케줄러 + 공식 OpenAI Responses API**이다. 모델은 사용자가 접근 가능한 API 모델 ID로 설정한다. 모델 선택/계정 플랜/요금은 환경에서 확인해야 하며 기본값을 최신·무료·무제한으로 가정하지 않는다. 앱에서 비용과 실행 위치에 명시적으로 동의한 요청만 게시한다. 실행기 운영 키는 저장소 secret이며 Windows 앱에 저장하지 않는다.

실행기는 임의 셸을 모델에 주지 않는다. 코드 읽기/쓰기/삭제, 허용된 npm 검증 스크립트만 도구로 제공한다. AGENTS.md와 REQUIREMENTS.md 전체를 읽기 전 변경/검증 도구는 거부한다. 검증 스크립트는 네트워크 없음, 제한된 CPU/RAM/PID, 읽기 전용 root 및 Git 메타데이터, 비밀키 없는 Docker 컨테이너에서 실행한다. 검증 후 보호 경로·심볼릭 링크·크기를 재확인한 뒤 신뢰된 게시기가 작업 브랜치와 초안 PR을 만든다.

## 예약 정책

예약 정의와 실행 회차를 분리한다. GitHub Actions가 약 5분마다 열린 예약 Issue와 영속 수동 큐 댓글을 스캔한다. 기준 브랜치의 최신 SHA 및 요청 스냅샷·규칙 해시를 고정한다. 예약+예정 시각의 결정적 ID를 사용한다. 전역 저장소 concurrency=1, 추가 작업은 영속 큐에 대기하며 누락된 반복은 최신 1회로 coalesce한다. 실행기 ID를 lease 소유자로 하고 AI 실행 중 30초 heartbeat/90초 lease 정보를 기록한다. 작업 timeout은 정책 최대 30분, 검증 명령별 최대 2분, workflow 전체 최대 120분이다. 전송은 동일 ID로 최대 3회 자동 복구하고 이후 수동 복구를 요구한다. 이미 모델 실행이 시작된 실패는 중복 과금을 막기 위해 자동 재실행하지 않는다. 새 실행은 새 run ID를 사용한다.

PC 전원이 꺼져도 GitHub 측 실행기는 동작할 수 있다. GitHub cron 지연, 비활성 저장소의 스케줄 중지, API 한도, 조직 정책의 영향을 받으며 정시 SLA를 제공하지 않는다. 로컬 일정 알림은 앱이 실행 중일 때만 지원하며, 절전 복귀 시 15분 이내 놓친 알림을 전달한다.

## 공급자·라이선스·배포

뉴스는 [공식 Hacker News API](https://github.com/HackerNews/API)의 링크·제목·출처·시각 메타데이터만 표시한다. 외부 기사 전문·이미지는 복제하지 않는다. 읽기 시간은 본문이 없어 미제공으로 표시한다. 주제는 제목 키워드 분류이며 추천은 공급자 top stories이다.

금융은 [Alpha Vantage 공식 API](https://www.alphavantage.co/documentation/)를 사용한다. 일 마감/지연 표시를 유지한다. 종목의 통화는 SYMBOL_SEARCH로 확인하고, 지수는 별도 유료 INDEX_DATA 권한이 필요하다. ETF를 실제 지수로 바꿔 표시하지 않는다. 캐시는 6시간이며 개인용 사용 조건과 구독 권한을 확인해야 한다. 거래 기능은 없다.

직접 의존성은 정확한 버전과 npm lockfile로 고정한다. React/Electron/Zod/JSZip은 MIT, Temporal polyfill은 ISC, JSBI는 Apache-2.0 등 실제 패키지 라이선스를 `resources/third-party-licenses.txt`로 생성한다. PDFKit은 원격 실행기에서만 사용한다. Electron/Chromium 고지는 배포에 포함한다. 런타임 공급망은 검토된 Orbit 커밋 SHA를 GitHub 변수로 고정하고 Action도 SHA로 고정한다.

서명 인증서·업데이트 호스팅은 제공되지 않았다. 설치 파일은 미서명이며 자동 업데이트는 비활성이다. 운영 자격증명·원격 Docker 실행·실제 PR/예약 수신 및 OS 설치 수명주기 검증은 별도 상태표에 남긴다.
