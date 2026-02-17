# UX Capture + AI - 아키텍처 문서

## 이게 뭐하는 프로젝트야?

웹페이지를 캡처하면 AI가 "다음에 뭘 해야 하는지" 알려주는 Chrome 확장 프로그램.

예를 들어 "쿠팡에서 도넛 구매"라는 Task를 시작하고, 페이지를 캡처하면:
1. AI가 현재 상황을 분석하고 (Reasoning)
2. 구체적으로 어떤 버튼을 눌러야 하는지 추천해줌 (Action)

---

## 전체 흐름 (데이터가 어떻게 흘러가는지)

```
[사용자가 캡처 버튼 클릭]
        |
        v
  sidepanel.js          ← UI 담당
        |
        | chrome.tabs.sendMessage("EXTRACT")
        v
  content.js             ← 현재 페이지에서 데이터 추출
        |                   - interactive 요소 (버튼, 링크, 입력창 등)
        |                   - 팝업/모달 텍스트
        v
  sidepanel.js           ← 추출된 데이터를 서버로 전송
        |
        | POST /api/captures
        v
  server/routes/api.js   ← 핵심 로직
        |
        | 1) Reasoning AI 호출 (상황 분석)
        | 2) Action AI 호출 (액션 추천)
        | 3) DB 저장
        v
  MongoDB                ← Task, Capture 저장
        |
        v
  sidepanel.js           ← AI 결과를 화면에 표시
```

---

## 파일 구조

```
UXAgent_Extension/
├── manifest.json          # Chrome 확장 설정
├── background.js          # 확장 초기화 (sidePanel 열기만 담당)
├── content.js             # 페이지 DOM 추출 (브라우저 탭 안에서 실행됨)
├── sidepanel.html         # 사이드 패널 UI
├── sidepanel.js           # 사이드 패널 로직 (Task 관리, 캡처, AI 결과 표시)
└── server/
    ├── server.js           # Express 서버 진입점
    ├── routes/
    │   └── api.js          # API 라우트 + AI 호출 로직 (핵심!)
    └── models/
        ├── Task.js         # Task 스키마 (태스크 세션)
        └── Capture.js      # Capture 스키마 (캡처 1회 데이터)
```

---

## 각 파일이 하는 일

### content.js - 페이지 데이터 추출기

브라우저 탭 안에서 실행됨. 두 가지를 추출:

**1. `extractElements()` - 인터랙티브 요소 추출**
- `<a>`, `<button>`, `<input>`, `<select>` 등 사용자가 클릭/입력할 수 있는 요소
- z-index 높은 순으로 정렬 (팝업 안의 버튼이 먼저 옴)
- 최대 180개, 각 요소의 위치/스타일/클릭가능 여부 포함

**2. `extractOverlayText()` - 팝업/모달 텍스트 추출**

왜 필요? → 팝업에 "최소 주문금액은 19,800원입니다" 같은 텍스트가 있어도,
이게 `<span>`이나 `<div>`에 있으면 interactive 요소에 안 잡힘.
AI가 팝업 내용을 모르면 엉뚱한 추천을 함.

감지 방법 (3가지를 합쳐서 찾음):
```
1. role="dialog" 또는 aria-modal="true" 속성
2. 클래스명에 modal, popup, dialog, overlay 포함
3. position: fixed/absolute + z-index >= 100 + 크기 > 100x50
```

제외 대상: `<header>`, `<nav>`, `<footer>` (sticky header 오탐 방지)

최종 응답 형태:
```javascript
{
  url: "https://www.coupang.com/...",
  title: "쿠팡",
  viewport: { w: 1920, h: 1080, dpr: 1 },
  elements: [ ... ],       // 인터랙티브 요소 배열
  overlayTexts: [ ... ]    // 팝업 텍스트 배열
}
```

---

### server/routes/api.js - AI 두뇌 (가장 중요한 파일)

#### AI 2단계 파이프라인

왜 2단계? → 하나의 프롬프트로 "상황 분석 + 액션 추천"을 동시에 하면 정확도가 떨어짐.
역할을 분리하면 각 단계가 자기 일에 집중할 수 있음.

```
            페이지 데이터 + 팝업 텍스트 + 메모리
                        |
                        v
        ┌─────────────────────────────┐
        │     Reasoning 모듈           │
        │  "지금 어떤 상황이야?"        │
        │                             │
        │  입력: 태그별 요소 개수 요약,  │
        │        팝업 텍스트,           │
        │        이전 단계 기록         │
        │                             │
        │  출력: 현재 상태, 팝업 분석,   │
        │        진행도, 전략, 주의사항  │
        └──────────────┬──────────────┘
                       │
                       v
        ┌─────────────────────────────┐
        │      Action 모듈             │
        │  "구체적으로 뭘 눌러야 해?"   │
        │                             │
        │  입력: reasoning 결과,       │
        │        interactive 요소 60개, │
        │        팝업 텍스트            │
        │                             │
        │  출력: 대상 요소, 액션 유형,   │
        │        시각적 위치, 근거,      │
        │        단계 요약              │
        └──────────────┬──────────────┘
                       │
                       v
                  단계 요약 추출
                  → 메모리 스트림에 저장
```

#### 메모리 스트림

왜 필요? → 캡처를 여러 번 하면서 진행하는데, 매번 "이전에 뭐 했는지" 모르면
AI가 같은 추천을 반복하거나 문맥을 놓침.

```javascript
// Task.memoryStream 예시
[
  { step: 1, url: "https://coupang.com",       summary: "쿠팡 메인에서 검색창에 '도넛' 입력" },
  { step: 2, url: "https://coupang.com/search", summary: "검색 결과에서 첫 번째 도넛 상품 클릭" },
  { step: 3, url: "https://coupang.com/product", summary: "장바구니 담기 버튼 클릭" }
]
```

Reasoning 프롬프트에 최근 10개까지 포함됨 → AI가 "아, 이미 검색하고 상품 골랐구나" 파악 가능.

#### 주요 함수들

| 함수 | 하는 일 |
|------|---------|
| `callOpenAI(prompt, moduleLabel)` | OpenAI API 호출. moduleLabel로 시스템 프롬프트 분리 (`"reasoning"` / `"action"`) |
| `buildReasoningPrompt(...)` | Reasoning용 프롬프트 생성 (요소 개수 요약 + 팝업 텍스트 + 메모리) |
| `buildActionPrompt(...)` | Action용 프롬프트 생성 (reasoning 결과 + 요소 상세 60개) |
| `extractStepSummary(output)` | Action 출력에서 `**단계 요약**: ...` 줄을 파싱 |

#### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/api/tasks` | Task 시작 → taskId 반환 |
| `PUT` | `/api/tasks/:taskId/end` | Task 종료 |
| `POST` | `/api/captures` | 캡처 저장 + AI 2단계 호출 + 메모리 업데이트 |
| `GET` | `/health` | 서버 상태 확인 |

---

### server/models/ - DB 스키마

**Task.js** - 하나의 태스크 세션
```javascript
{
  taskName: "도넛 구매",
  status: "active" | "completed",
  captureCount: 3,
  memoryStream: [              // 각 캡처의 한줄 요약
    { step: 1, url: "...", summary: "..." }
  ],
  startTime, endTime
}
```

**Capture.js** - 캡처 1회 데이터
```javascript
{
  taskId: ObjectId,            // 어떤 Task에 속하는지
  stepNumber: 1,
  url, title, viewport,
  elements: [ ... ],           // 인터랙티브 요소
  overlayTexts: [ ... ],       // 팝업 텍스트
  reasoningPrompt: "...",      // Reasoning에 보낸 프롬프트
  reasoningOutput: "...",      // Reasoning AI 응답
  actionPrompt: "...",         // Action에 보낸 프롬프트
  actionOutput: "..."          // Action AI 응답
}
```

---

### sidepanel.html + sidepanel.js - UI

사이드 패널에 3개 영역:

1. **상태 메시지** (`#out`) - "Capturing...", "Reasoning...", "Step 3 complete." 등
2. **AI 상황 분석** (`#reasoningOut`) - 접을 수 있는 `<details>` 안에 표시
3. **추천 액션** (`#actionOut`) - 녹색 강조 표시, 가장 눈에 띄게

캡처 플로우:
```
사용자가 "현재 viewport 탐색" 클릭
  → content.js에서 DOM 추출
  → overlayTexts 포함하여 서버로 POST
  → "Reasoning..." 상태 표시
  → 서버 응답 받으면 reasoning/action 분리 표시
```

---

## 로컬에서 실행하기

```bash
# 1. 서버 실행
cd server
npm install
# .env 파일에 MONGODB_URI, OPENAI_API_KEY 설정 필요
npm start

# 2. Chrome 확장 로드
# chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램을 로드합니다"
# → UXAgent_Extension 폴더 선택

# 3. 사용
# 아무 웹페이지에서 확장 아이콘 클릭 → 사이드 패널 열림
# Task 이름 입력 → "Task 시작" → "현재 viewport 탐색"
```

### 필요한 환경변수 (.env)

```
MONGODB_URI=mongodb://localhost:27017/uxcapture
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini          # 선택 (기본값: gpt-4.1-mini)
OPENAI_BASE_URL=https://api.openai.com  # 선택 (기본값)
```
