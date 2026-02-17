# UX Capture + AI Extension

Chrome extension for capturing and analyzing UX flows with AI assistance and MongoDB storage.

## Overview

브라우저 자동화 없이, **사용자가 실제로 탐색하는 웹페이지**에서 UI 구조를 캡처하고 AI가 다음 행동을 추천하는 크롬 확장입니다.

**v0.3.0의 주요 변경사항:**
- ✅ **Task 세션 관리**: 여러 캡처를 하나의 Task로 묶어 관리
- ✅ **MongoDB 통합**: 모든 캡처와 AI 응답을 데이터베이스에 저장
- ✅ **보안 강화**: API Key를 서버에서 관리 (확장에서 제거)
- ✅ **Side Panel UI**: 탐색 중 지속적으로 표시되는 UI

## Features

- **Task-based Session Management**: 여러 페이지 탐색을 하나의 Task로 그룹화
- **Real-time AI Analysis**: 각 페이지마다 UX 인사이트와 추천 액션 제공
- **MongoDB Integration**: 모든 데이터를 데이터베이스에 자동 저장
- **Secure API Key Management**: API Key를 서버에서만 관리하여 보안 강화
- **No Browser Automation**: 자동 클릭/타이핑 없이 관찰만 수행 (차단 리스크 최소화)

## Architecture

```
┌─────────────────┐
│  Chrome Extension│
│  (sidepanel.js)  │
└────────┬─────────┘
         │
         │ HTTP
         │
┌────────▼─────────┐      ┌──────────────┐
│  Express Server  │◄────►│   MongoDB    │
│   (server.js)    │      │   (Atlas)    │
└────────┬─────────┘      └──────────────┘
         │
         │ OpenAI API
         │
┌────────▼─────────┐
│   OpenAI API     │
│  (GPT-4.1-mini)  │
└──────────────────┘
```

## Installation

### 1. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the project root directory

### 2. Set up the Backend Server

See [server/README.md](server/README.md) for detailed instructions.

Quick start:
```bash
cd server
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and OpenAI API Key
npm start
```

## Usage

### Starting a Task

1. Click the extension icon to open the side panel
2. Enter a task name (e.g., "네이버쇼핑 노트북 검색 플로우")
3. Click "Task 시작"

### Capturing Pages

1. Navigate to the page you want to analyze
2. Click "현재 viewport 탐색"
3. Wait for AI analysis to complete
4. Read the recommendations
5. Manually navigate to the next page (based on recommendations)
6. Repeat step 2-5

### Ending a Task

1. Click "Task 종료" when you're done
2. View the summary showing total captures

### Viewing Data in MongoDB

All data is stored in MongoDB Atlas. You can:
- View tasks and captures in MongoDB Compass
- Query data using MongoDB queries
- Export data for further analysis

## Project Structure

```
UXAgent_Extension/
├── manifest.json          # Extension manifest (v3)
├── sidepanel.html         # Extension UI (side panel)
├── sidepanel.js          # Extension logic (Task management)
├── background.js         # Extension background worker
├── content.js            # DOM extraction script (no automation)
└── server/
    ├── server.js         # Express server + MongoDB
    ├── .env             # Environment variables (MongoDB URI, API Key)
    ├── models/
    │   ├── Task.js       # Task schema
    │   └── Capture.js    # Capture schema
    └── routes/
        └── api.js        # API endpoints
```

## How it Works

1. **User starts a Task**: Creates a new session in MongoDB
2. **User navigates normally**: No automation, just regular browsing
3. **User clicks "현재 viewport 탐색"**:
   - Extension extracts DOM elements (visible, interactive elements only)
   - Sends data to backend server
   - Server calls OpenAI API with structured prompt
   - Server saves capture + AI response to MongoDB
4. **User reads AI recommendations**: UI/UX insights and suggested next actions
5. **User manually performs actions**: Navigate to next page
6. **Repeat steps 3-5** until task is complete
7. **User ends Task**: Marks session as completed in MongoDB

## Development

### Key Changes from v0.2.0

- ✅ Removed API key storage from extension (security improvement)
- ✅ Added Task session management (better data organization)
- ✅ Integrated MongoDB for data persistence
- ✅ Moved AI logic to backend server
- ✅ Changed from popup to side panel UI
- ✅ Removed screenshot capture (not stored, per requirements)

### Testing

1. Start the server: `cd server && npm start`
2. Load the extension in Chrome (`chrome://extensions`)
3. Open an e-commerce site (e.g., Naver Shopping, Coupang)
4. Create a new task with a descriptive name
5. Click "현재 viewport 탐색" multiple times (3-5 times) as you navigate
6. End the task
7. Check MongoDB Atlas to verify data was saved

## Configuration

### Server Configuration

Edit `server/.env`:
- `MONGODB_URI`: Your MongoDB Atlas connection string
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_BASE_URL`: OpenAI-compatible endpoint (default: https://api.openai.com)
- `OPENAI_MODEL`: Model to use (default: gpt-4.1-mini)
- `PORT`: Server port (default: 3000)

### Extension Configuration

No configuration needed! API key is managed on the server.

## Security Notes

✅ **API Key Protection**: API keys are stored only on the server, never in the extension
✅ **No Browser Automation**: Only observes pages, doesn't click or type automatically
✅ **CORS Enabled**: Server allows requests from extension
✅ **MongoDB Atlas**: Free tier supports 512MB storage

## Roadmap (Next)

- [ ] Task history view (list all previous tasks)
- [ ] Capture replay (view previous captures from a task)
- [ ] Export task data (JSON/CSV)
- [ ] Enhanced PII masking (personal information in captured data)
- [ ] UX metrics extraction (element density, CTA positions, filter accessibility)
- [ ] Multi-site comparison (compare UX flows across different sites)

## License

MIT
