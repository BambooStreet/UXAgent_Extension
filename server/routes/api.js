const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Capture = require('../models/Capture');

// OpenAI API 호출 함수
async function callOpenAI(prompt, moduleLabel) {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

  const systemPrompts = {
    reasoning: "당신은 UX 리서치 분석가입니다. 현재 페이지 상태를 분석하고, 팝업/모달을 감지하며, 태스크 진행도를 평가하고, 전략을 수립하세요. 간결하고 구조적으로 한국어로 답변하세요.",
    action: "당신은 UX 액션 추천가입니다. 상황 분석을 바탕으로 정확히 하나의 구체적인 사용자 액션을 추천하세요. 페이지의 특정 인터랙티브 요소에 매칭하여 정확하게 안내하세요. 한국어로 답변하세요."
  };

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: systemPrompts[moduleLabel] || systemPrompts.reasoning
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  console.log(`[AI:${moduleLabel}] requesting`, url, "model=", model);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  console.log(`[AI:${moduleLabel}] status`, res.status);
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

// Reasoning 프롬프트 생성
function buildReasoningPrompt({ taskName, page, memoryStream }) {
  // 태그별 개수 요약
  const tagCounts = {};
  for (const el of page.elements) {
    tagCounts[el.tag] = (tagCounts[el.tag] || 0) + 1;
  }
  const tagSummary = Object.entries(tagCounts)
    .map(([tag, count]) => `${tag}: ${count}`)
    .join(', ');

  // 오버레이 텍스트
  let overlaySection = '';
  if (page.overlayTexts && page.overlayTexts.length > 0) {
    const overlayItems = page.overlayTexts.map((o, i) =>
      `  [Overlay ${i + 1}] <${o.tag}>${o.role ? ` role="${o.role}"` : ''} z-index:${o.zIndex} position:${o.position}\n    Text: "${o.text}"`
    ).join('\n');
    overlaySection = `\n\nDetected Popups/Modals/Overlays:\n${overlayItems}`;
  } else {
    overlaySection = '\n\nDetected Popups/Modals/Overlays: None';
  }

  // 메모리 스트림 (최근 10개)
  let memorySection = '';
  if (memoryStream && memoryStream.length > 0) {
    const recent = memoryStream.slice(-10);
    const memoryItems = recent.map(m =>
      `  Step ${m.step} (${m.url}): ${m.summary}`
    ).join('\n');
    memorySection = `\n\nPrevious Steps (Memory Stream):\n${memoryItems}`;
  } else {
    memorySection = '\n\nPrevious Steps: This is the first capture.';
  }

  return `
Task: ${taskName}

Current Page:
- URL: ${page.url}
- Title: ${page.title}
- Viewport: ${JSON.stringify(page.viewport)}
- Interactive Elements Summary: ${tagSummary} (total: ${page.elements.length})
${overlaySection}
${memorySection}

아래 형식으로 한국어로 분석해주세요:

**현재 상태**: 사용자가 현재 어떤 페이지/화면에 있는지, 무엇이 보이는지 설명

**팝업 분석**: 페이지를 가리는 팝업, 모달, 오버레이가 있는지? 있다면 내용과 목적을 설명. 없으면 "팝업 없음"

**진행도 평가**: 메모리 스트림을 바탕으로 태스크 완료까지 얼마나 진행되었는지, 무엇을 했고 무엇이 남았는지

**전략**: 태스크 목표를 향해 다음에 무엇을 해야 하는지. 팝업이 있다면 닫아야 하는지 상호작용해야 하는지

**주의사항**: 주의해야 할 점 (예: 최소주문금액, 로그인 필요, 품절 등)

**완료 여부**: 태스크가 완료되었으면 DONE, 아직 진행해야 하면 CONTINUE
  `.trim();
}

// Action 프롬프트 생성
function buildActionPrompt({ taskName, reasoningOutput, page }) {
  // interactive 요소 상위 60개
  const elementsPreview = page.elements
    .slice(0, 60)
    .map(e => {
      const styleInfo = `color:${e.style?.color || 'N/A'} bg:${e.style?.backgroundColor || 'N/A'} fontSize:${e.style?.fontSize || 'N/A'} position:${e.style?.position || 'static'} zIndex:${e.style?.zIndex || 'auto'}`;
      const interactionInfo = e.interaction
        ? `clickable:${e.interaction.clickable} disabled:${e.interaction.disabled}`
        : '';
      return `- ${e.id} ${e.tag}${e.role ? `[role=${e.role}]` : ""} selector="${e.selector || ''}" label="${e.label}" rect=${JSON.stringify(e.rect)} style={${styleInfo}} interaction={${interactionInfo}}`;
    })
    .join("\n");

  // 오버레이 텍스트
  let overlaySection = '';
  if (page.overlayTexts && page.overlayTexts.length > 0) {
    const overlayItems = page.overlayTexts.map((o, i) =>
      `  [Overlay ${i + 1}] <${o.tag}> z-index:${o.zIndex} position:${o.position}\n    Text: "${o.text}"`
    ).join('\n');
    overlaySection = `\nDetected Overlays:\n${overlayItems}\n`;
  }

  return `
Task: ${taskName}

Situation Analysis (from reasoning module):
${reasoningOutput}

Interactive Elements (top 60, sorted by z-index - modals/popups first):
${elementsPreview}
${overlaySection}
위 상황 분석을 바탕으로 정확히 하나의 액션을 추천하세요. 아래 형식으로 한국어로 출력:

**대상 요소**: 어떤 요소와 상호작용할지 (item ID 사용, 예: item3)

**액션 유형**: click / type / select / scroll / hover / navigate

**액션 상세**: 구체적인 지시 (예: "'장바구니 담기' 버튼을 클릭" 또는 "검색창에 '도넛' 입력")

**시각적 위치**: 화면에서 해당 요소의 위치 (예: "우측 상단, 파란색 버튼에 흰색 텍스트")

**근거**: 왜 이 액션이 태스크 목표를 향한 최선의 다음 단계인지

**다음 캡처 타이밍**: 다음 캡처를 언제 해야 하는지 (예: "검색 결과가 로드된 후" 또는 "팝업이 닫힌 후")

**단계 요약**: 이 단계가 무엇을 달성하는지 한 문장 요약 (예: "쿠팡에서 '도넛' 검색" 또는 "최소주문금액 팝업 닫기")

**실행 명령**: 아래 JSON 형식으로 브라우저가 자동 실행할 수 있는 명령을 출력하세요. 반드시 \`\`\`json 코드블록으로 감싸세요.
- click: \`{"action":"click","selector":"CSS 선택자"}\`
- type: \`{"action":"type","selector":"CSS 선택자","value":"입력할 텍스트"}\`
- scroll: \`{"action":"scroll","x":0,"y":500}\`
- navigate: \`{"action":"navigate","url":"https://..."}\`
- select: \`{"action":"select","selector":"CSS 선택자","value":"옵션값"}\`
- hover: \`{"action":"hover","selector":"CSS 선택자"}\`

selector는 반드시 대상 요소의 selector 필드 값을 그대로 사용하세요. 각 요소에 이미 고유한 CSS 선택자가 제공되어 있습니다. 직접 선택자를 만들지 마세요. 예: 요소 목록에 \`selector="#search-input"\`이 있으면 그대로 \`"selector":"#search-input"\`으로 사용.
  `.trim();
}

// Reasoning 출력에서 DONE 신호 추출
function extractDoneSignal(reasoningOutput) {
  const match = reasoningOutput.match(/\*\*완료 여부\*\*:\s*(DONE|CONTINUE)/i);
  if (match) {
    return match[1].toUpperCase() === 'DONE';
  }
  // fallback: 출력 어디서든 DONE이 단독으로 나오면 완료로 판단
  return /\bDONE\b/.test(reasoningOutput) && !/\bCONTINUE\b/.test(reasoningOutput);
}

// Action 출력에서 Step Summary 추출
function extractStepSummary(actionOutput) {
  // **단계 요약**: ... 또는 **Step Summary**: ... 패턴 매칭
  const summaryMatch = actionOutput.match(/\*\*(?:단계 요약|Step Summary)\*\*:\s*(.+)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim();
  }

  // fallback: **액션 상세**: ... 또는 **Action Detail**: ... 에서 추출
  const actionMatch = actionOutput.match(/\*\*(?:액션 상세|Action Detail)\*\*:\s*(.+)/i);
  if (actionMatch) {
    return actionMatch[1].trim();
  }

  return 'Action performed';
}

// Action 출력에서 실행 명령 JSON 추출
function extractActionCommand(actionOutput) {
  // ```json { ... } ``` 패턴 매칭
  const jsonBlockMatch = actionOutput.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed && parsed.action) {
        return parsed;
      }
    } catch (e) {
      console.warn('[extractActionCommand] JSON parse failed:', e.message);
    }
  }

  // fallback: 인라인 JSON 객체 매칭 {"action": ...}
  const inlineMatch = actionOutput.match(/\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*\}/);
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]);
      if (parsed && parsed.action) {
        return parsed;
      }
    } catch (e) {
      console.warn('[extractActionCommand] inline JSON parse failed:', e.message);
    }
  }

  return null;
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
      captureCount: 0,
      memoryStream: []
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

// POST /api/captures - 캡처 데이터 저장 + AI 호출 (Reasoning → Action 2단계)
router.post('/captures', async (req, res) => {
  try {
    const { taskId, url, title, viewport, elements, overlayTexts } = req.body;

    // Task 확인
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'active') {
      return res.status(400).json({ error: 'Task is not active' });
    }

    const page = { url, title, viewport, elements, overlayTexts: overlayTexts || [] };

    // 1. Reasoning 모듈 호출
    const reasoningPrompt = buildReasoningPrompt({
      taskName: task.taskName,
      page,
      memoryStream: task.memoryStream || []
    });

    const reasoningOutput = await callOpenAI(reasoningPrompt, 'reasoning');

    // 2. Action 모듈 호출
    const actionPrompt = buildActionPrompt({
      taskName: task.taskName,
      reasoningOutput,
      page
    });

    const actionOutput = await callOpenAI(actionPrompt, 'action');

    // 3. Step Summary + Action Command 추출
    const stepSummary = extractStepSummary(actionOutput);
    const actionCommand = extractActionCommand(actionOutput);

    // 4. stepNumber 계산
    const stepNumber = task.captureCount + 1;

    // 5. Capture 저장
    const capture = new Capture({
      taskId: task._id,
      url,
      title,
      viewport,
      elements,
      overlayTexts: page.overlayTexts,
      reasoningPrompt,
      reasoningOutput,
      actionPrompt,
      actionOutput,
      stepNumber
    });

    await capture.save();

    // 6. Task 업데이트: captureCount 증가 + memoryStream에 step summary 추가
    task.captureCount += 1;
    task.memoryStream.push({
      step: stepNumber,
      url,
      summary: stepSummary
    });
    await task.save();

    // 7. 태스크 완료 여부 판단
    const done = extractDoneSignal(reasoningOutput);

    // 8. 응답
    res.json({
      captureId: capture._id.toString(),
      reasoningPrompt,
      reasoningOutput,
      actionPrompt,
      actionOutput,
      actionCommand,
      done
    });
  } catch (error) {
    console.error('Error creating capture:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
