# Orbit

Apple에서 영감을 받은 기존 Orbit 디자인을 유지한 **Windows 11 x64 개인 워크스페이스 앱**입니다. 원본 디자인은 `design/`에 보존했습니다.

일정·반복·학습 기록·보드·메모는 로컬에 저장됩니다. 실제 Hacker News 기사 수집과 저장/검색/리더를 제공하며, 금융은 Alpha Vantage 키와 공급자 권한을 연결하면 조회합니다. GitHub 요청·기사/파일 참조와 예약은 Issue에 보관하고, 별도로 설치한 GitHub Actions 실행기가 공식 OpenAI Responses API의 제한된 파일 도구와 격리 검증을 실행합니다. PR과 PDF/텍스트/소스 파일은 결과함으로 수신합니다.

**외부 연결 전에도 로컬 기능을 사용할 수 있습니다.** ChatGPT 자체 예약 직접 연동은 확인된 외부 앱용 계약이 없어 미지원으로 표시합니다. API 실행은 별도 과금 경로이며 앱 안에서 동의 후 활성화합니다. 운영 연결과 출시 검증이 끝난 완제품이라고 표시하지 않습니다. 항목별 상태는 [구현 및 검증 현황](docs/IMPLEMENTATION_STATUS.md)을 참조하세요.

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

`npm run package`는 `release/Orbit Setup 0.1.0.exe`와 `release/win-unpacked/Orbit.exe`를 생성합니다. 현재 빌드는 서명되지 않았으며 자동 업데이트는 비활성입니다. 기본 설치는 사용자별 설치이며 사용자 데이터는 제거 후에도 유지됩니다. 설치/제거·업데이트/rollback의 실제 검증 여부는 상태 문서를 확인하세요.

개발/검증용 데이터 폴더를 분리하려면 `ORBIT_DATA_DIR` 환경 변수로 절대 경로를 지정할 수 있습니다. 비밀키를 환경 파일에 넣거나 저장소에 커밋하지 마세요. 원격 실행기 설정과 연결 권한은 [설치 안내](docs/SETUP.md)에 있습니다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/renderer` | 기존 토큰·카드 계층을 유지한 React 화면 |
| `src/domain` | 스키마, UTC/IANA 시간대, 반복, 상태 전이, 마이그레이션 |
| `src/main` | Electron 보안 경계, DPAPI, 원자적 저장, 공급자, 결과 수신 |
| `worker` | 영속 큐, 제한된 AI 도구, Git 동기화, 검증, PR, 실제 산출물 |
| `.github/workflows` | CI와 선택적으로 설치하는 원격 실행기 |
| `tests` | 도메인·저장·공급자·보안·파일 통합·Windows E2E |

[기술 결정](docs/decisions/0001-architecture.md) · [API 계약](docs/API.md) · [보안 경계](docs/SECURITY.md) · [원래 요구사항](docs/REQUIREMENTS.md)
