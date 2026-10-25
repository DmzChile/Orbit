# 경계와 API 계약

## 앱 업데이트 (0.1.4)

`updates.state`, `updates.check`, `updates.online`, `updates.download`, `updates.install`은 data 없이만 호출한다. 기존 sender/frame 검증과 Reply 포맷을 적용한다. feed URL·토큰·경로·명령 인자를 renderer에서 받지 않는다. `updates.online`은 backoff를 지키고 직접 `check`는 즉시 확인한다. `install`은 다운로드 완료 상태와 native 확인 후에만 실행한다.

`orbit:update`/`OrbitAPI.onUpdate`는 `UpdateState`를 전달한다: status(idle/checking/available/downloading/downloaded/installing/error/unavailable/unsupported), currentVersion, version?, percent?, checkedAt?, message, retry?(check/download). 준비 완료 상태는 일반 확인으로 지우지 않는다. 내려받기/검증 오류 뒤에는 설치를 허용하지 않는다. 개발 실행은 unsupported다. 실제 업데이트 네트워크·검증·설치는 main의 electron-updater 경계가 수행한다.

전송은 샌드박스 renderer → contextBridge → 검증된 Electron IPC이다. 임의 HTTP 서버·공개 로컬 포트·임의 Node 호출은 제공하지 않는다. `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, CSP, navigation/window-open 거부 및 sender frame 확인을 적용한다. UI는 공급자 응답 객체를 직접 저장하지 않고 도메인 스키마를 사용한다.

응답은 `{ok:true,data}` 또는 `{ok:false,error:{code,message,correlationId}}`이다. Zod 입력 실패는 VALIDATION, 충돌은 CONFLICT, 인증은 NEEDS_AUTH, 권한은 FORBIDDEN, 한도는 RATE_LIMIT, 네트워크는 OFFLINE이다. 결과를 받지 못했다는 이유로 원격 모델 작업을 재시작하지 않는다.

| 명령 | 데이터 및 효과 |
|---|---|
| state / connection / diagnostics | 비밀키를 제외한 상태·연결 유무·진단 |
| settings.save | 검증된 Settings; 계정 식별자는 기존 연결에서 유지 |
| event.save / event.delete | 이벤트 version, UTC·지역 시각·IANA 시간대, all/this 범위, 발생 날짜 |
| board.save | Board version과 안정적 위젯 ID; 충돌은 저장 거부 |
| session.complete | 위젯·실제 일정 참조와 완료 기록 |
| news.refresh / news.more / news.save | 정치 포함 공식 분야별 RSS의 균형 페이지(24개)·중복 제거·저장 관계; refresh/more 응답은 count와 부분 실패 warning |
| quote | symbol + stock/index, 독립 캐시/인증/오류 |
| connect / disconnect | provider + 입력한 키; 암호문만 별도 저장, renderer에 키 반환 없음 |
| repos / branches / activity | 페이지 최대 100; 앱 허용 저장소 검사와 GitHub 권한 검증 |
| attachment.pick | 사용자 파일 대화상자에서 UTF-8 텍스트 선택 → 제한된 내용/실제 크기/SHA, 로컬 경로 반환 없음 |
| request.save | 로컬 초안; 저장소 미선택 허용 |
| request.publish | 유효한 저장소·공유 동의 후 추적 Issue 생성/수정; 외부 ChatGPT에는 workflow 불필요 |
| request.copyPrompt | 게시된 Issue의 외부 예약 프롬프트를 OS clipboard에 복사; ChatGPT 예약 생성 아님 |
| request.remove | 원격 Issue 닫기와 로컬 정의 제거; 기존 실행 이력 보존 |
| run.enqueue / run.retryDelivery | 로컬 run + 고정 스냅샷 + 같은 ID 영속 큐; 읽기 후 쓰기로 재전송 중복 방지 |
| run.cancel / run.read | 취소 댓글/Actions 취소, 별도 읽음 시각 |
| sync | 계정·저장소 범위의 커서+추적 Issue 복구, ETag, 30초~15분 backoff |
| download | run/artifact ID → 인증 archive → 크기/체크섬 → 실제 저장 |
| data.export / data.import / data.reset | 스키마 검증 백업·복원·로컬 데이터 및 키 폐기 |
| open | 자격증명 없는 HTTPS URL만 OS 브라우저로 열기 |

renderer 이벤트는 데이터 변경, 결과 알림 클릭 ID, 다운로드 바이트/전체 크기/실제 단계이다. UI의 화면 전환과 모션 타이머는 예약·작업 완료로 사용하지 않는다.

## 원격 레코드

파일 참조는 최대 2개, UTF-8 파일당 24KB/6,000자이며 요청과 함께 고정 스냅샷에 포함한다. 전체 원격 레코드가 GitHub 본문 한도를 넘으면 게시를 거부한다.

Request/Run/Artifact는 `src/domain/model.ts`가 실행 가능한 계약이다. UTC ISO 시각, IANA timezone, 반복 규칙, 스키마 버전, 요청 version, SHA, run ID를 분리한다. Issue와 댓글은 버전 마커와 JSON fenced block으로 직렬화한다. 기본 `chatgpt-external` 결과는 연결 GitHub 로그인 및 settings.resultAuthors의 명시적 허용 게시자 댓글만 수용한다. 이전 `github-actions-openai`만 `github-actions[bot]`을 수용한다. 요청 ID/사본 ID/저장소/공급자와 실제 PR 저장소를 검사하며 succeeded+실패 checks는 거부한다. [외부 예약 계약](EXTERNAL_CHATGPT.md)을 참조한다. 실행기에서는 OWNER/MEMBER/COLLABORATOR가 만든 허용 label의 요청과 큐만 실행한다.

예약 회차 idempotency key는 request ID + 예정 UTC 시각, 수동은 새 UUID이다. 댓글 100개씩 최대 100페이지, 발견 Issue 100개씩 최대 20페이지를 조회한다. 한도를 넘으면 커서를 진전시키지 않고 오류를 반환한다. 알려진 Issue는 커서와 무관하게 확인한다. 같은 ID의 오래된 결과가 최신 상태나 로컬 읽음을 덮어쓰지 않는다.

기사 검색은 로컬 캐시(최대 1,000개)이며 주제 분류는 제목 키워드이다. 보드는 최대 40개 위젯, 동일 종류 중복을 허용하며 순서 기반 CSS grid에 S/M/L 크기를 배치해 충돌 없이 재정렬한다. 대시보드와 편집기는 같은 board ID를 사용한다.

일정 DST 정책: 존재하지 않거나 중복되는 지역 시각의 직접 입력은 거부한다. 반복에서 그런 시각은 건너뛴다. 종료 일시는 exclusive이며 종일도 다음 날 자정을 종료로 사용한다. 반복 횟수는 예외/건너뛴 발생을 포함한 원래 발생 기준으로 센다.


정치 주제를 포함하는 로컬 스키마는3이다.1/2→3 이전 시 원본 버전 백업을 보존하며 과거 앱은 미래 스키마를 덮어쓰지 않는다. 메인 뉴스의8초 타이머는 표시 순환만 담당하며 원격 실행/예약/성공 상태를 만들지 않는다.
