console.log("[sidepanel] loaded");

const $ = (id) => document.getElementById(id);

// 백엔드 서버 URL
const SERVER_URL = "http://localhost:3000";

// 전역 상태 관리
let currentTask = null; // { taskId, taskName, captureCount }
let pendingCommand = null; // actionCommand JSON from server
let lastCaptureId = null; // 마지막 캡처 ID (verify용)
let autoRunning = false; // auto-run loop flag

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("활성 탭을 찾지 못했습니다.");
  return tab;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

function setOut(txt) {
  $("out").textContent = txt;
}

function setReasoningOut(txt) {
  $("reasoningOut").textContent = txt;
}

function setActionOut(txt) {
  $("actionOut").textContent = txt;
}

function setPendingCommand(cmd) {
  pendingCommand = cmd || null;
  const btn = $("executeAction");
  btn.disabled = !pendingCommand;
  // Clear previous result
  const result = $("execResult");
  result.className = "exec-result";
  result.textContent = "";
}

function showExecResult(success, message) {
  const el = $("execResult");
  el.className = "exec-result " + (success ? "success" : "error");
  el.textContent = success ? `✓ ${message || "실행 완료"}` : `✗ ${message || "실행 실패"}`;
}

function setFlowText(id, txt) {
  const el = $(id);
  if (!el) return;
  const max = 30000;
  const s = String(txt || "");
  el.textContent = s.length > max ? s.slice(0, max) + "\n\n... (truncated)" : s;
}

function updateFlowUI(data) {
  setFlowText("reasoningInput", data.reasoningPrompt);
  setFlowText("reasoningOut", data.reasoningOutput);
  setFlowText("actionInput", data.actionPrompt);
  setFlowText("actionOut", data.actionOutput);
}

// Task 시작 플로우
$("startTask").addEventListener("click", async () => {
  try {
    const taskName = $("taskName").value.trim();
    if (!taskName) {
      alert("Task 이름을 입력하세요");
      return;
    }

    setOut("Task 시작 중...");

    // 백엔드에 Task 생성 요청
    const resp = await fetch(`${SERVER_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskName })
    });

    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || "Task 생성 실패");
    }

    const data = await resp.json();

    currentTask = { taskId: data.taskId, taskName, captureCount: 0 };

    // UI 상태 변경
    $("taskSection").style.display = "none";
    $("activeTaskSection").style.display = "block";
    $("currentTaskName").textContent = taskName;
    $("captureCount").textContent = "0";
    setOut(`Task 시작됨: ${taskName}`);
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
  }
});

// Capture 플로우
$("captureViewport").addEventListener("click", async () => {
  try {
    if (!currentTask) {
      alert("Task를 먼저 시작하세요");
      return;
    }

    setOut("Capturing...");

    // 1. content.js에서 DOM 추출
    const tab = await getActiveTab();
    await injectContentScript(tab.id);
    const extracted = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT" });

    // 2. 백엔드로 전송 (Reasoning → Action 2단계 AI 호출)
    setOut("Reasoning...");
    const resp = await fetch(`${SERVER_URL}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: currentTask.taskId,
        url: extracted.url,
        title: extracted.title,
        viewport: extracted.viewport,
        elements: extracted.elements,
        overlayTexts: extracted.overlayTexts || []
      })
    });

    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || "Capture 저장 실패");
    }

    const data = await resp.json();

    // UI 업데이트
    currentTask.captureCount++;
    $("captureCount").textContent = currentTask.captureCount;
    setOut(`Step ${currentTask.captureCount} complete.`);
    lastCaptureId = data.captureId;
    updateFlowUI(data);
    setPendingCommand(data.actionCommand);
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
    setPendingCommand(null);
  }
});

// Task 종료 플로우
$("endTask").addEventListener("click", async () => {
  try {
    if (!currentTask) return;

    setOut("Task 종료 중...");

    const captureCount = currentTask.captureCount;

    await fetch(`${SERVER_URL}/api/tasks/${currentTask.taskId}/end`, {
      method: "PUT"
    });

    // UI 초기화
    currentTask = null;
    $("taskSection").style.display = "block";
    $("activeTaskSection").style.display = "none";
    $("taskName").value = "";
    setOut(`Task 종료됨. 총 ${captureCount}개 캡처.`);
    setPendingCommand(null);
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
  }
});

// 서버에 액션 실행 결과 보고
async function verifyAction(captureId, success, error) {
  try {
    await fetch(`${SERVER_URL}/api/captures/${captureId}/verify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success, error })
    });
  } catch (e) {
    console.warn("[verify] failed:", e);
  }
}

// 액션 실행 버튼 (수동)
$("executeAction").addEventListener("click", async () => {
  if (!pendingCommand) return;

  const btn = $("executeAction");
  btn.disabled = true;
  btn.textContent = "실행 중...";
  setOut("액션 실행 중...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      command: pendingCommand
    });

    if (response?.success) {
      showExecResult(true, response.log || "액션이 성공적으로 실행되었습니다.");
      setOut("액션 실행 완료.");
      await verifyAction(lastCaptureId, true);
    } else {
      const errMsg = response?.error || "알 수 없는 오류";
      showExecResult(false, errMsg);
      setOut("액션 실행 실패.");
      await verifyAction(lastCaptureId, false, errMsg);
    }
  } catch (e) {
    showExecResult(false, e?.message || String(e));
    setOut(`Error: ${e?.message || e}`);
    await verifyAction(lastCaptureId, false, e?.message);
  } finally {
    btn.textContent = "액션 실행";
    btn.disabled = !pendingCommand;
  }
});

// ─── Auto Run ───

function setAutoRunUI(running) {
  autoRunning = running;
  $("autoRun").style.display = running ? "none" : "block";
  $("stopRun").style.display = running ? "block" : "none";
  $("stepCounter").style.display = running ? "block" : "none";
  $("captureViewport").disabled = running;
  $("endTask").disabled = running;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 단일 step 실행 (캡처 → AI → 액션) — 결과 반환
async function runOneStep() {
  // 1. DOM 추출
  const tab = await getActiveTab();
  await injectContentScript(tab.id);
  const extracted = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT" });

  // 2. 서버에 전송
  setOut("Reasoning...");
  const resp = await fetch(`${SERVER_URL}/api/captures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: currentTask.taskId,
      url: extracted.url,
      title: extracted.title,
      viewport: extracted.viewport,
      elements: extracted.elements,
      overlayTexts: extracted.overlayTexts || []
    })
  });

  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || "Capture 실패");
  }

  const data = await resp.json();

  // 3. UI 업데이트
  currentTask.captureCount++;
  $("captureCount").textContent = currentTask.captureCount;
  lastCaptureId = data.captureId;
  updateFlowUI(data);
  setPendingCommand(data.actionCommand);

  return data;
}

// 액션 실행 (자동) — 성공 여부 반환 + verify 호출
async function executeActionAuto(command, captureId) {
  const response = await chrome.runtime.sendMessage({
    type: "EXECUTE_ACTION",
    command
  });

  if (response?.success) {
    showExecResult(true, response.log || "실행 완료");
    await verifyAction(captureId, true);
    return true;
  } else {
    const errMsg = response?.error || "실행 실패";
    showExecResult(false, errMsg);
    await verifyAction(captureId, false, errMsg);
    return false;
  }
}

async function autoRunLoop() {
  if (!currentTask) {
    alert("Task를 먼저 시작하세요");
    return;
  }

  const maxSteps = parseInt($("maxSteps").value, 10) || 20;
  $("maxStepDisplay").textContent = maxSteps;
  setAutoRunUI(true);

  let step = 0;

  try {
    while (autoRunning && step < maxSteps) {
      step++;
      $("currentStep").textContent = step;
      setOut(`Auto Run — Step ${step}/${maxSteps}: 캡처 중...`);

      // 1. 캡처 + AI 호출
      const data = await runOneStep();
      if (!autoRunning) break;

      setOut(`Auto Run — Step ${step}/${maxSteps}: 분석 완료`);

      // 2. 태스크 완료 확인
      if (data.done) {
        setOut(`Auto Run 완료 — 태스크 종료 (Step ${step})`);
        break;
      }

      // 3. 액션 실행
      if (data.actionCommand) {
        setOut(`Auto Run — Step ${step}/${maxSteps}: 액션 실행 중...`);
        const success = await executeActionAuto(data.actionCommand, data.captureId);
        if (!success) {
          setOut(`Auto Run 중단 — 액션 실행 실패 (Step ${step})`);
          break;
        }
      } else {
        setOut(`Auto Run 중단 — 실행할 액션 없음 (Step ${step})`);
        break;
      }

      if (!autoRunning) break;

      // 4. 3초 대기
      setOut(`Auto Run — Step ${step}/${maxSteps}: 다음 캡처까지 3초 대기...`);
      await sleep(3000);
    }

    if (autoRunning && step >= maxSteps) {
      setOut(`Auto Run 종료 — 최대 스텝(${maxSteps}) 도달`);
    }
  } catch (e) {
    setOut(`Auto Run 오류: ${e?.message || e}`);
  } finally {
    setAutoRunUI(false);
  }
}

$("autoRun").addEventListener("click", () => autoRunLoop());
$("stopRun").addEventListener("click", () => {
  autoRunning = false;
  setOut("Auto Run 중지 요청됨...");
});
