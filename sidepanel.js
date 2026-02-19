console.log("[sidepanel] loaded");

const $ = (id) => document.getElementById(id);

// 백엔드 서버 URL
const SERVER_URL = "http://localhost:3000";

// 전역 상태 관리
let currentTask = null; // { taskId, taskName, captureCount }
let pendingCommand = null; // actionCommand JSON from server

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

function setDebugPrompt(txt) {
  const el = $("debugPrompt");
  if (!el) return;
  const max = 30000;
  const s = String(txt || "");
  el.textContent = s.length > max ? s.slice(0, max) + "\n\n... (truncated)" : s;
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
    setReasoningOut("Ready.");
    setActionOut("Ready.");
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
    setReasoningOut("...");
    setActionOut("...");

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
    setReasoningOut(data.reasoningOutput);
    setActionOut(data.actionOutput);
    setDebugPrompt(data.debugPrompt);
    setPendingCommand(data.actionCommand);
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
    setReasoningOut("Error occurred.");
    setActionOut("Error occurred.");
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
    setReasoningOut("Ready.");
    setActionOut("Ready.");
    setDebugPrompt("(empty)");
    setPendingCommand(null);
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
  }
});

// 액션 실행 버튼
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
    } else {
      showExecResult(false, response?.error || "알 수 없는 오류");
      setOut("액션 실행 실패.");
    }
  } catch (e) {
    showExecResult(false, e?.message || String(e));
    setOut(`Error: ${e?.message || e}`);
  } finally {
    btn.textContent = "액션 실행";
    btn.disabled = !pendingCommand;
  }
});
