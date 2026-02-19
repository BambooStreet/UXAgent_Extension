const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Capture = require('../models/Capture');
const { buildObservation, pruneForPrompt, formatElementForPrompt, formatTreeSummaryForPrompt } = require('../lib/observation');

// OpenAI API 호출 함수
async function callOpenAI(prompt, moduleLabel) {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

  const systemPrompts = {
    observe: "당신은 웹 페이지 상태 관찰 전문가입니다. 현재 페이지 상태를 객관적으로 기술하고, 이전 액션이 있었다면 그 결과를 검증하세요. 사실만 기술하고, 전략이나 추천은 하지 마세요. 간결하고 구조적으로 한국어로 답변하세요.",
    reasoning: "당신은 UX 리서치 분석가입니다. Observe 모듈의 관찰 결과를 바탕으로 태스크 진행도를 평가하고 전략을 수립하세요. 간결하고 구조적으로 한국어로 답변하세요.",
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

// Observe 프롬프트 생성
function buildObservePrompt({ taskName, page, lastStep, observation }) {
  // AX tree summary (if available)
  const treeSummary = observation?.ax?.tree_summary
    ? formatTreeSummaryForPrompt(observation.ax.tree_summary)
    : '';

  // 오버레이 텍스트
  let overlaySection = '';
  if (page.overlayTexts && page.overlayTexts.length > 0) {
    const overlayItems = page.overlayTexts.map((o, i) =>
      `  [Overlay ${i + 1}] <${o.tag}>${o.role ? ` role="${o.role}"` : ''} z-index:${o.zIndex} position:${o.position}\n    Text: "${o.text}"`
    ).join('\n');
    overlaySection = `\nDetected Popups/Modals/Overlays:\n${overlayItems}`;
  } else {
    overlaySection = '\nDetected Popups/Modals/Overlays: None';
  }

  // 이전 액션 정보 (eid 기반)
  let prevActionSection = '';
  if (lastStep) {
    const eidInfo = lastStep.eid ? ` (eid: ${lastStep.eid})` : '';
    prevActionSection = `
Previous Action (Step ${lastStep.step}):
- Summary: ${lastStep.summary}${eidInfo}
- Status: ${lastStep.status}
- Target URL at that time: ${lastStep.url}${lastStep.error ? `\n- Error: ${lastStep.error}` : ''}`;
  } else {
    prevActionSection = '\nPrevious Action: None (this is the first step)';
  }

  return `
Task: ${taskName}

Current Page State:
- URL: ${page.url}
- Title: ${page.title}
- Viewport: ${JSON.stringify(page.viewport)}
- AX Tree Summary: ${treeSummary}
${overlaySection}
${prevActionSection}

아래 형식으로 한국어로 관찰 결과를 작성하세요. 사실만 기술하고 전략/추천은 하지 마세요:

**페이지 상태**: 현재 URL, 페이지 제목, 화면에 보이는 주요 콘텐츠를 객관적으로 기술

**화면 요소**: 주요 인터랙티브 요소들의 현황 (입력창, 버튼, 링크 등)

**팝업/오버레이**: 현재 페이지를 가리는 팝업, 모달, 오버레이가 있는지 사실적으로 기술

**이전 액션 검증**: 이전 액션이 있었다면, 현재 페이지 상태를 보고 그 액션이 실제로 성공했는지 판단. 아래 중 하나로 결론:
- PREV_ACTION_VERIFIED: 이전 액션이 의도대로 수행됨 (예: 검색어 입력 후 검색 결과 페이지로 이동됨)
- PREV_ACTION_FAILED: 이전 액션이 실패했거나 기대한 결과가 아님 (예: 클릭했는데 페이지가 변하지 않음). 실패 이유를 구체적으로 설명
- NO_PREV_ACTION: 이전 액션 없음 (첫 번째 단계)

**변화 감지**: 이전 단계와 비교하여 URL, 페이지 내용, 화면 구성에서 변화가 있는지 기술
  `.trim();
}

// Observe 출력에서 이전 액션 검증 결과 추출
function extractObserveVerification(observeOutput) {
  if (/PREV_ACTION_VERIFIED/.test(observeOutput)) return 'verified';
  if (/PREV_ACTION_FAILED/.test(observeOutput)) return 'failed';
  return 'none';
}

// Reasoning 프롬프트 생성
function buildReasoningPrompt({ taskName, observeOutput, memoryStream }) {
  // 메모리 스트림 (최근 10개)
  let memorySection = '';
  if (memoryStream && memoryStream.length > 0) {
    const recent = memoryStream.slice(-10);
    const memoryItems = recent.map(m => {
      const statusTag = m.status === 'success' ? '✓' : m.status === 'failed' ? '✗ FAILED' : '⏳ PENDING';
      const errorInfo = m.status === 'failed' && m.error ? ` (error: ${m.error})` : '';
      return `  Step ${m.step} [${statusTag}] (${m.url}): ${m.summary}${errorInfo}`;
    }).join('\n');
    memorySection = `\n\nPrevious Steps (Memory Stream):\n${memoryItems}`;
  } else {
    memorySection = '\n\nPrevious Steps: This is the first step.';
  }

  return `
Task: ${taskName}

Observation (from observe module):
${observeOutput}
${memorySection}

Observe 모듈의 관찰 결과와 메모리 스트림을 바탕으로, 아래 형식으로 한국어로 분석해주세요:

**이전 액션 평가**: Observe의 이전 액션 검증 결과를 반영. VERIFIED면 다음 단계로 진행, FAILED면 실패 원인을 분석하고 재시도 또는 대안 전략 제시

**진행도 평가**: 태스크 완료까지 얼마나 진행되었는지 평가. 메모리 스트림의 실행 상태(✓/✗/⏳)를 확인

**전략**: 태스크 목표를 향해 다음에 무엇을 해야 하는지. 팝업이 있다면 닫아야 하는지 상호작용해야 하는지. 이전 액션이 실패했다면 같은 방법을 반복하지 말고 대안을 제시

**주의사항**: 주의해야 할 점 (예: 최소주문금액, 로그인 필요, 품절 등)

**완료 여부**: 태스크가 완료되었으면 DONE, 아직 진행해야 하면 CONTINUE
  `.trim();
}

// Action 프롬프트 생성
function buildActionPrompt({ taskName, reasoningOutput, page, observation }) {
  // AX elements (pruned, eid-based)
  let elementsPreview = '';
  if (observation?.ax?.interactive_elements?.length > 0) {
    const pruned = pruneForPrompt(observation.ax.interactive_elements, 50);
    elementsPreview = pruned.map(el => `- ${formatElementForPrompt(el)}`).join("\n");
  } else {
    // Fallback to legacy elements if no AX data
    elementsPreview = page.elements
      .slice(0, 60)
      .map(e => {
        const interactionInfo = e.interaction
          ? `clickable:${e.interaction.clickable} disabled:${e.interaction.disabled}`
          : '';
        return `- ${e.id} ${e.tag}${e.role ? `[role=${e.role}]` : ""} selector="${e.selector || ''}" label="${e.label}" rect=${JSON.stringify(e.rect)} interaction={${interactionInfo}}`;
      })
      .join("\n");
  }

  // 오버레이 텍스트
  let overlaySection = '';
  if (page.overlayTexts && page.overlayTexts.length > 0) {
    const overlayItems = page.overlayTexts.map((o, i) =>
      `  [Overlay ${i + 1}] <${o.tag}> z-index:${o.zIndex} position:${o.position}\n    Text: "${o.text}"`
    ).join('\n');
    overlaySection = `\nDetected Overlays:\n${overlayItems}\n`;
  }

  const useEid = observation?.ax?.interactive_elements?.length > 0;

  return `
Task: ${taskName}

Situation Analysis (from reasoning module):
${reasoningOutput}

Interactive Elements (top 50, AX tree based):
${elementsPreview}
${overlaySection}
위 상황 분석을 바탕으로 정확히 하나의 액션을 추천하세요. 아래 형식으로 한국어로 출력:

**대상 요소**: 어떤 요소와 상호작용할지 (${useEid ? 'eid 사용, 예: e-a3f2b1c0' : 'item ID 사용, 예: item3'})

**액션 유형**: click / type / select / scroll / hover / navigate / press_enter / keypress / back

**액션 상세**: 구체적인 지시 (예: "'장바구니 담기' 버튼을 클릭" 또는 "검색창에 '도넛' 입력")

**시각적 위치**: 화면에서 해당 요소의 위치 (예: "우측 상단, 파란색 버튼에 흰색 텍스트")

**근거**: 왜 이 액션이 태스크 목표를 향한 최선의 다음 단계인지

**다음 캡처 타이밍**: 다음 캡처를 언제 해야 하는지 (예: "검색 결과가 로드된 후" 또는 "팝업이 닫힌 후")

**단계 요약**: 이 단계가 무엇을 달성하는지 한 문장 요약 (예: "쿠팡에서 '도넛' 검색" 또는 "최소주문금액 팝업 닫기")

**실행 명령**: 아래 JSON 형식으로 브라우저가 자동 실행할 수 있는 명령을 출력하세요. 반드시 \`\`\`json 코드블록으로 감싸세요.
${useEid ? `- click: \`{"action":"click","eid":"e-..."}\`
- type: \`{"action":"type","eid":"e-...","value":"입력할 텍스트"}\` — 입력 후 바로 검색/제출하려면 \`"pressEnter":true\` 추가
- type+Enter: \`{"action":"type","eid":"e-...","value":"검색어","pressEnter":true}\` — 검색창 입력 후 바로 검색 실행
- scroll: \`{"action":"scroll","x":0,"y":500}\`
- navigate: \`{"action":"navigate","url":"https://..."}\`
- select: \`{"action":"select","eid":"e-...","value":"옵션값"}\`
- hover: \`{"action":"hover","eid":"e-..."}\`
- press_enter: \`{"action":"press_enter","eid":"e-..."}\` — 이미 입력된 필드에서 Enter 키만 전송
- keypress: \`{"action":"keypress","key":"Escape"}\` — 특수 키 전송 (Escape, Tab, ArrowDown, ArrowUp, Space, Backspace, Delete). 모달/팝업 닫기에는 Escape 사용
- back: \`{"action":"back"}\` — 브라우저 뒤로가기

eid는 반드시 대상 요소의 eid 값을 그대로 사용하세요. 요소 목록에서 [e-abc123]과 같이 표시된 값입니다. 직접 eid를 만들지 마세요.
검색창에 텍스트를 입력하고 검색을 실행해야 할 때는 반드시 \`"pressEnter":true\`를 함께 사용하세요.` : `- click: \`{"action":"click","selector":"CSS 선택자"}\`
- type: \`{"action":"type","selector":"CSS 선택자","value":"입력할 텍스트"}\` — 입력 후 바로 검색/제출하려면 \`"pressEnter":true\` 추가
- type+Enter: \`{"action":"type","selector":"CSS 선택자","value":"검색어","pressEnter":true}\` — 검색창 입력 후 바로 검색 실행
- scroll: \`{"action":"scroll","x":0,"y":500}\`
- navigate: \`{"action":"navigate","url":"https://..."}\`
- select: \`{"action":"select","selector":"CSS 선택자","value":"옵션값"}\`
- hover: \`{"action":"hover","selector":"CSS 선택자"}\`
- press_enter: \`{"action":"press_enter","selector":"CSS 선택자"}\` — 이미 입력된 필드에서 Enter 키만 전송
- keypress: \`{"action":"keypress","key":"Escape"}\` — 특수 키 전송 (Escape, Tab, ArrowDown, ArrowUp, Space, Backspace, Delete). 모달/팝업 닫기에는 Escape 사용
- back: \`{"action":"back"}\` — 브라우저 뒤로가기

selector는 반드시 대상 요소의 selector 필드 값을 그대로 사용하세요.
검색창에 텍스트를 입력하고 검색을 실행해야 할 때는 반드시 \`"pressEnter":true\`를 함께 사용하세요.`}
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

// Action 출력에서 실행 명령 JSON 추출 (eid + selector 모두 지원)
function extractActionCommand(actionOutput) {
  // ```json { ... } ``` 패턴 매칭
  const jsonBlockMatch = actionOutput.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed && parsed.action) {
        return parsed; // may contain eid or selector
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
    const { taskId, url, title, viewport, elements, overlayTexts, axData } = req.body;

    // Task 확인
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'active') {
      return res.status(400).json({ error: 'Task is not active' });
    }

    const page = { url, title, viewport, elements, overlayTexts: overlayTexts || [] };
    const memoryStream = task.memoryStream || [];

    // 이전 step 정보 (observe에서 검증용)
    const lastStep = memoryStream.length > 0 ? memoryStream[memoryStream.length - 1] : null;

    // stepNumber 계산
    const stepNumber = task.captureCount + 1;

    // Build observation object
    const observation = buildObservation({
      step: stepNumber,
      page,
      lastAction: lastStep ? {
        type: lastStep.summary,
        params: { eid: lastStep.eid || null },
        status: lastStep.status
      } : null,
      axData: axData || null,
      errors: []
    });

    // 1. Observe 모듈 호출
    const observePrompt = buildObservePrompt({
      taskName: task.taskName,
      page,
      lastStep,
      observation
    });

    const observeOutput = await callOpenAI(observePrompt, 'observe');

    // 1-1. Observe 결과로 이전 step의 memoryStream 상태 업데이트
    if (lastStep && lastStep.status === 'pending') {
      const verification = extractObserveVerification(observeOutput);
      if (verification === 'verified') {
        lastStep.status = 'success';
      } else if (verification === 'failed') {
        lastStep.status = 'failed';
        lastStep.error = 'Observe에서 페이지 레벨 검증 실패';
      }
      task.markModified('memoryStream');
      await task.save();
    }

    // 2. Reasoning 모듈 호출 (observe 결과 기반)
    const reasoningPrompt = buildReasoningPrompt({
      taskName: task.taskName,
      observeOutput,
      memoryStream: task.memoryStream || []
    });

    const reasoningOutput = await callOpenAI(reasoningPrompt, 'reasoning');

    // 3. Action 모듈 호출
    const actionPrompt = buildActionPrompt({
      taskName: task.taskName,
      reasoningOutput,
      page,
      observation
    });

    const actionOutput = await callOpenAI(actionPrompt, 'action');

    // 4. Step Summary + Action Command 추출
    const stepSummary = extractStepSummary(actionOutput);
    const actionCommand = extractActionCommand(actionOutput);

    // Extract eid from action command for memoryStream tracking
    const actionEid = actionCommand?.eid || null;

    // 5. Capture 저장
    const capture = new Capture({
      taskId: task._id,
      url,
      title,
      viewport,
      elements,
      overlayTexts: page.overlayTexts,
      observePrompt,
      observeOutput,
      reasoningPrompt,
      reasoningOutput,
      actionPrompt,
      actionOutput,
      stepNumber,
      observation,
      axMode: axData?.mode || null
    });

    await capture.save();

    // 6. Task 업데이트: captureCount 증가 + memoryStream에 pending 상태로 추가
    task.captureCount += 1;
    task.memoryStream.push({
      step: stepNumber,
      url,
      summary: stepSummary,
      status: 'pending',
      eid: actionEid
    });
    await task.save();

    // 8. 태스크 완료 여부 판단
    const done = extractDoneSignal(reasoningOutput);

    // 9. 응답
    res.json({
      captureId: capture._id.toString(),
      observePrompt,
      observeOutput,
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

// PUT /api/captures/:captureId/verify - 액션 실행 결과 검증
router.put('/captures/:captureId/verify', async (req, res) => {
  try {
    const { captureId } = req.params;
    const { success, error } = req.body;

    const capture = await Capture.findById(captureId);
    if (!capture) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    // Task의 memoryStream에서 해당 step 업데이트
    const task = await Task.findById(capture.taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const memEntry = task.memoryStream.find(m => m.step === capture.stepNumber);
    if (memEntry) {
      memEntry.status = success ? 'success' : 'failed';
      if (!success && error) {
        memEntry.error = String(error).slice(0, 200);
      }
      task.markModified('memoryStream');
      await task.save();
      console.log(`[verify] Step ${capture.stepNumber} → ${memEntry.status}`);
    }

    res.json({ verified: true, step: capture.stepNumber, status: memEntry?.status });
  } catch (error) {
    console.error('Error verifying capture:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
