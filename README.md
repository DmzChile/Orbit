# Orbit

Apple에서 영감을 받은 기존 Orbit 디자인을 유지한 **Windows 11 x64 개인 워크스페이스 앱**입니다. 원본 디자인은 `design/`에 보존했습니다.

일정·반복·학습 기록·보드·메모는 로컬에 저장됩니다. **키 없는 한국 뉴스 공식 RSS**로 실제 기사 수집·저장·검색·리더와 정치 필터를 제공합니다. 메인 뉴스는 기사 있는 분야를 8초마다 번갈아 표시하며 직접 선택·이전/다음·일시정지를 지원합니다. 금융은 별도 Alpha Vantage 키와 공급자 권한으로 조회합니다. 뉴스 그래픽은 사용자가 제공한 행성·기울어진 궤도 디자인을 따릅니다. 같은 궤도 위로 선이 공전하며 잔광을 남기고 시스템/앱 모션 감소 시 정지합니다.

**GPT API 키가 필요하지 않습니다.** GitHub에 요청과 예약 정의를 등록하고 예약 프롬프트를 복사해 **사용자가 직접 만든 ChatGPT 예약 작업**에 연결합니다. 외부 작업이 실제 검증·PR·산출물 작업 후 GitHub에 결과 댓글을 게시하면 앱이 자동 수신합니다. 앱의 예정 시각/지금 실행은 GitHub 요청 전달이며 ChatGPT 예약 생성이 아닙니다. 실제 연결은 [설치 안내](docs/SETUP.md)와 [결과 계약](docs/EXTERNAL_CHATGPT.md)을 따릅니다.

연결 전에도 로컬 기능을 사용할 수 있습니다. 외부 ChatGPT 예약·실제 원격 결과의 계정별 검증과 출시 검증은 남아 있습니다. [요구사항별 현황](docs/IMPLEMENTATION_STATUS.md)을 참조하세요. 이전 API worker는 명시적으로 활성화해야 하며 새 외부 ChatGPT 요청을 처리하지 않습니다.

## 개발과 실행

Node.js 24 LTS, npm, Windows 11 x64가 필요합니다.

```powershell
npm ci
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
npm run test:e2e
npm run package
npm run test:packaged
```

`npm run package`는 `release/Orbit Setup 0.1.3.exe`와 `release/win-unpacked/Orbit.exe`를 생성합니다. 현재 빌드는 서명되지 않았으며 자동 업데이트는 비활성입니다. 기본 설치는 사용자별 설치이며 사용자 데이터는 제거 후에도 유지됩니다. 설치/제거·업데이트/rollback의 실제 검증 여부는 상태 문서를 확인하세요.

개발/검증용 데이터 폴더를 분리하려면 `ORBIT_DATA_DIR` 환경 변수로 절대 경로를 지정할 수 있습니다. 비밀키를 환경 파일에 넣거나 저장소에 커밋하지 마세요. 원격 실행기 설정과 연결 권한은 [설치 안내](docs/SETUP.md)에 있습니다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/renderer` | 기존 토큰·카드 계층을 유지한 React 화면 |
| `src/domain` | 스키마, UTC/IANA 시간대, 반복, 상태 전이, 마이그레이션 |
| `src/main` | Electron 보안 경계, DPAPI, 원자적 저장, 공급자, 결과 수신 |
| `worker` | 이전 API worker 호환 코드 (기본 비활성) |
| `.github/workflows` | CI와 선택적으로 설치하는 원격 실행기 |
| `tests` | 도메인·저장·공급자·보안·파일 통합·Windows E2E |

[기술 결정](docs/decisions/0001-architecture.md) · [API 계약](docs/API.md) · [보안 경계](docs/SECURITY.md) · [원래 요구사항](docs/REQUIREMENTS.md)
