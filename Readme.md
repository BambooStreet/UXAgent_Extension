# UX Capture + AI (Local Demo)

브라우저 자동화(Playwright 등) 없이, **사용자가 실제로 보고 있는 웹페이지**(네이버쇼핑/쿠팡/11번가 등)에서  
**(1) UI 구조 데이터(simple HTML + 상호작용 요소 맵) + (2) 스크린샷**을 캡처하고,  
그 결과를 바탕으로 **AI가 다음 행동을 “추천”**하도록 만드는 크롬 확장 MVP입니다.

> 목표: 여러 이커머스 사이트에서 구매 플로우를 단계별로 관찰/기록하고, UX/UI 특징을 비교 분석하기 위한 데이터 수집 파이프라인 구축  
> 특징: **브라우저 조작(자동 클릭/타이핑) 없이 “관찰/기록”만** 수행 → 자동화 탐지/차단 리스크를 낮춤

---

## What it does (MVP Flow)

1. 사용자가 일반 크롬에서 원하는 사이트를 정상적으로 탐색한다.  
2. 확장 아이콘(팝업)에서 `Task`를 입력하고 `Capture & Ask`를 클릭한다.  
3. 확장이 현재 탭에서 아래를 수집한다.
   - **simpleHtml**: 분석용으로 정제된 HTML(스크립트/스타일 제거, 값 마스킹, 길이 제한)
   - **elements**: 클릭/입력 가능한 요소 목록(라벨/selector/좌표 등)
   - **screenshot**: 현재 보이는 화면(뷰포트) 스크린샷
4. AI API(OpenAI-compatible)에 요청하여
   - UI/UX 특징 요약
   - 다음 추천 액션 Top 3
   - 다음 캡처 타이밍
   을 받아 팝업에 출력한다.
5. 사용자는 추천을 참고해 직접 다음 페이지로 이동하고, 반복한다.

---

## Project Structure

- `manifest.json`  
  크롬 확장 설정 파일(MV3).  
  팝업 UI 연결, 권한(activeTab/storage/tabs), API 호출 대상 도메인(host_permissions) 등을 정의합니다.

- `popup.html`  
  확장 아이콘 클릭 시 뜨는 **팝업 UI**.  
  Task / API Base URL / Model / API Key 입력 및 결과 출력 영역을 포함합니다.

- `popup.js`  
  팝업 동작 로직.
  - 현재 활성 탭을 찾고
  - `content.js`를 주입(inject)한 뒤
  - 페이지에서 추출된 데이터(EXTRACT 결과)를 받아
  - `background.js`에 “캡처+AI 호출”을 요청합니다.
  - 입력값(API Key/Base/Model)은 `chrome.storage.local`에 저장합니다.

- `content.js`  
  **페이지 내부에서 실행되는 스크립트(Content Script)**로,
  - 현재 페이지의 DOM을 읽어 `simpleHtml`을 생성하고
  - 클릭/입력 가능한 요소 목록(`elements`)을 추출합니다.
  - 자동 클릭/조작은 하지 않고 **관찰만** 수행합니다.

- `background.js`  
  **서비스 워커(Background, MV3)**.
  - 활성 탭의 **뷰포트 스크린샷**을 캡처하고
  - OpenAI-compatible endpoint(`/v1/chat/completions`)로 AI 요청을 보낸 뒤
  - 응답을 popup에 반환합니다.

---

## Installation

1. 크롬에서 `chrome://extensions` 접속
2. 우측 상단 **Developer mode** ON
3. **Load unpacked** 클릭 → 이 프로젝트 폴더 선택
4. (선택) 확장 목록에서 핀(📌) 고정

---

## Usage

1. 네이버쇼핑 등 분석할 페이지를 **일반 크롬**에서 열기
2. 확장 팝업 열기 → `Task`, `API Base`, `Model`, `API Key` 입력
3. `Capture & Ask` 클릭
4. AI Output에 추천 액션이 출력되면, 사용자가 직접 수행 → 다음 페이지에서 반복

---

## Configuration

- **API Base**: 기본값 `https://api.openai.com`  
  OpenAI-compatible 서버를 쓰는 경우(예: LiteLLM 프록시) 해당 주소로 변경하면 됩니다.

- **Model**: 예) `gpt-4.1-mini`  
  사용 중인 API/계정에서 지원하는 모델명을 입력하세요.

---

## Security Notes (Important)

⚠️ **이 MVP는 로컬 데모 용도**입니다.  
현재 구조는 팝업에서 입력한 API Key를 `chrome.storage.local`에 저장하고, 확장이 직접 API를 호출합니다.

- 개인 테스트/로컬 데모엔 편하지만,
- 확장 배포/공유/팀 사용에는 부적합합니다(키 유출 위험).

✅ 다음 단계(권장): **서버 프록시 방식**으로 전환하여 API Key를 서버에만 보관하세요.

---

## Roadmap (Next)

- 팝업 대신 **Side Panel UI** 제공(탐색 중 지속 표시)
- 캡처 데이터(JSON/PNG)를 로컬 다운로드로 저장하거나 세션 단위로 묶기(Run/Step)
- PII(개인정보) 마스킹 강화(입력값/메일/전화/주소 등)
- 스크린샷/DOM 기반 UX 지표 추출(요소 밀도, CTA 위치, 필터 접근성 등)
- 서버 프록시 도입(키 보호 + 로그/데이터셋 자동 축적)

---
