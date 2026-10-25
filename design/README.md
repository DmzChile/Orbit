# Orbit UI 디자인 참조

- UI 및 모션: [orbit-ui-prototype.html](orbit-ui-prototype.html)
- 제품 요구사항: [docs/REQUIREMENTS.md](../docs/REQUIREMENTS.md)
- AI 개발 진입점: [AGENTS.md](../AGENTS.md)
- 편집 가능한 Figma 원본: https://www.figma.com/design/CqTx3gChx5Uok7QIeYrZde?node-id=2-8

## 실행

저장소를 clone하거나 ZIP으로 내려받고 `design/orbit-ui-prototype.html`을 Edge 또는 Chrome으로 열어보세요. 별도 설치·빌드·외부 이미지·폰트 다운로드 없이 실행되는 단일 HTML 파일입니다. GitHub의 파일 페이지에서는 소스가 표시되며 앱으로 실행되지는 않습니다.

## 포함된 디자인

오늘 대시보드, 뉴스 리더, 캘린더와 일정 입력, 위젯 라이브러리와 드래그 배치, GitHub 작업 요청·예약 화면, 결과함과 실패 상태를 포함합니다. 카드 등장, 위젯 배치 미리보기, 추상 궤도 움직임, 단계별 데모 진행, 완료 알림 및 모션 줄이기 설정을 제공합니다.

‘내 공간’에서 오른쪽 위젯을 끌거나 + 추가를 눌러 배치하세요. ‘배치 모션 보기’로 배치 애니메이션을 재생할 수 있습니다. 선택한 위젯은 Alt + 방향키로 순서를 바꿀 수 있습니다.

## 실제 구현과의 구분

이 파일은 UI 참조용 프로토타입입니다. 뉴스·시세·저장소·PR·산출물은 예시이며 외부 요청이나 실제 예약을 생성하지 않습니다. 일정과 배치는 현재 페이지 세션에서만 유지됩니다. 실제 제품에서는 요구사항 문서에 따라 인증·저장·실행·다운로드·복구를 구현해야 합니다.

Figma의 편집 가능한 노드는 Figma 링크에 보존되며 이 HTML은 `.fig` 파일 export가 아닙니다. Figma 도구 한도로 원본의 화면 클릭 연결과 모션은 미적용 상태이고, 캘린더 저장 버튼 잘림이 남아 있습니다. HTML을 상호작용/모션 참조로 함께 사용하세요.

원본 HTML SHA-256: `be739461d689d4d24532e70493226ed5987aa14df779028cddfdfbd4521f21e7`.
