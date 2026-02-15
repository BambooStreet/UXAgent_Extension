# UX Capture Server

Backend server for UX Capture Extension with MongoDB integration.

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the `server/` directory:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# MongoDB connection string (get from MongoDB Atlas)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/uxcapture?retryWrites=true&w=majority

# OpenAI API Configuration
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4.1-mini

# Server Configuration
PORT=3000
```

### 3. MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account (if you don't have one)
3. Create a new cluster (free tier M0 is fine)
4. Go to Database Access → Add New Database User
5. Go to Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)
6. Go to Clusters → Connect → Connect your application
7. Copy the connection string and paste it in `.env` as `MONGODB_URI`
8. Replace `<password>` with your database user password

### 4. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Endpoints

### POST /api/tasks
Start a new task session.

**Request:**
```json
{
  "taskName": "네이버쇼핑 노트북 검색 플로우"
}
```

**Response:**
```json
{
  "taskId": "507f1f77bcf86cd799439011",
  "startTime": "2024-01-15T10:30:00.000Z"
}
```

### PUT /api/tasks/:taskId/end
End an active task session.

**Response:**
```json
{
  "taskId": "507f1f77bcf86cd799439011",
  "endTime": "2024-01-15T10:45:00.000Z",
  "captureCount": 5
}
```

### POST /api/captures
Save a capture and get AI analysis.

**Request:**
```json
{
  "taskId": "507f1f77bcf86cd799439011",
  "url": "https://example.com",
  "title": "Example Page",
  "viewport": {
    "w": 1920,
    "h": 1080,
    "dpr": 1
  },
  "elements": [...]
}
```

**Response:**
```json
{
  "captureId": "507f1f77bcf86cd799439012",
  "aiResponse": "UX analysis...",
  "debugPrompt": "Full prompt sent to AI..."
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "mongodb": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Database Schema

### Task Collection
```javascript
{
  _id: ObjectId,
  taskName: String,
  startTime: Date,
  endTime: Date,
  status: 'active' | 'completed',
  captureCount: Number,
  createdAt: Date,
  updatedAt: Date
}
```

### Capture Collection
```javascript
{
  _id: ObjectId,
  taskId: ObjectId,
  timestamp: Date,
  url: String,
  title: String,
  viewport: { w, h, dpr },
  elements: Array,
  aiPrompt: String,
  aiResponse: String,
  stepNumber: Number,
  createdAt: Date,
  updatedAt: Date
}
```

## Troubleshooting

### MongoDB connection error
- Check if your IP is whitelisted in MongoDB Atlas Network Access
- Verify the connection string is correct
- Make sure you replaced `<password>` with your actual password

### CORS errors
- The server allows all origins by default
- If you need to restrict origins, modify the CORS configuration in `server.js`

### API Key errors
- Make sure `OPENAI_API_KEY` is set in `.env`
- Check if the API key is valid and has credits
