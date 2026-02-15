const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Capture = require('../models/Capture');

// OpenAI API 호출 함수
async function callOpenAI(prompt) {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "You are a UX research assistant. Recommend the next user action without controlling the browser."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  console.log("[AI] requesting", url, "model=", model);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  console.log("[AI] status", res.status);
  const txt = await res.text();

  if (!res.ok) {
    throw new Error(`AI API error ${res.status}: ${txt.slice(0, 400)}`);
  }

  const json = JSON.parse(txt);
  const answer = json?.choices?.[0]?.message?.content ??
                 json?.choices?.[0]?.text ??
                 "(No content)";
  return String(answer);
}

// 프롬프트 생성 함수
function buildPrompt({ taskName, page }) {
  const elementsPreview = page.elements
    .slice(0, 60)
    .map(e => {
      const styleInfo = `color:${e.style?.color || 'N/A'} bg:${e.style?.backgroundColor || 'N/A'} fontSize:${e.style?.fontSize || 'N/A'}`;
      const interactionInfo = e.interaction
        ? `clickable:${e.interaction.clickable} disabled:${e.interaction.disabled}`
        : '';
      return `- ${e.id} ${e.tag}${e.role ? `[role=${e.role}]` : ""} label="${e.label}" rect=${JSON.stringify(e.rect)} style={${styleInfo}} interaction={${interactionInfo}}`;
    })
    .join("\n");

  return `
Task:
${taskName}

Current page:
- url: ${page.url}
- title: ${page.title}
- viewport: ${JSON.stringify(page.viewport)}

Interactive elements (top 60, with visual & interaction info):
${elementsPreview}

Please output:
1) UI/UX 특징(짧게) 3개 - 색상, 크기, 배치 등 시각적 특징 포함

2) 다음으로 사용자가 해야 할 추천 액션 1개만
   - 어떤 요소를 클릭하거나 입력해야 하는지
   - 해당 요소의 시각적 특징 (색상, 위치, 크기 등)
   - 왜 그 액션을 해야 하는지 (Task 목표와 연관)
   - 주의할 점이 있다면

3) 현재 뷰포트 분석
   - 만약 Task 목표를 달성하기 위한 적절한 요소를 찾을 수 없다면:
     * "스크롤을 내려서 더 많은 옵션/정보 확인"을 권장하거나
     * "뒤로가기하여 다른 경로 탐색"을 권장
   - 적절한 요소가 있다면 이 섹션은 생략

4) 다음 캡처 타이밍
   - 추천 액션 수행 후 어떤 상태에서 다음 캡처를 해야 하는지
  `.trim();
}

// POST /api/tasks - Task 시작
router.post('/tasks', async (req, res) => {
  try {
    const { taskName } = req.body;

    if (!taskName || !taskName.trim()) {
      return res.status(400).json({ error: 'Task name is required' });
    }

    const task = new Task({
      taskName: taskName.trim(),
      status: 'active',
      captureCount: 0
    });

    await task.save();

    res.json({
      taskId: task._id.toString(),
      startTime: task.startTime
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tasks/:taskId/end - Task 종료
router.put('/tasks/:taskId/end', async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    task.status = 'completed';
    task.endTime = new Date();
    await task.save();

    res.json({
      taskId: task._id.toString(),
      endTime: task.endTime,
      captureCount: task.captureCount
    });
  } catch (error) {
    console.error('Error ending task:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/captures - 캡처 데이터 저장 + AI 호출
router.post('/captures', async (req, res) => {
  try {
    const { taskId, url, title, viewport, elements } = req.body;

    // Task 확인
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'active') {
      return res.status(400).json({ error: 'Task is not active' });
    }

    // 프롬프트 생성
    const page = { url, title, viewport, elements };
    const prompt = buildPrompt({ taskName: task.taskName, page });

    // AI 호출
    const aiResponse = await callOpenAI(prompt);

    // stepNumber 계산 (현재 Task의 캡처 수 + 1)
    const stepNumber = task.captureCount + 1;

    // Capture 저장
    const capture = new Capture({
      taskId: task._id,
      url,
      title,
      viewport,
      elements,
      aiPrompt: prompt,
      aiResponse,
      stepNumber
    });

    await capture.save();

    // Task의 captureCount 증가
    task.captureCount += 1;
    await task.save();

    res.json({
      captureId: capture._id.toString(),
      aiResponse,
      debugPrompt: prompt
    });
  } catch (error) {
    console.error('Error creating capture:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
