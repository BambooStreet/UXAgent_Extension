chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(console.error);
  } else {
    console.log("sidePanel API not available (permission missing or unsupported Chrome).");
  }
});

// 허용된 액션 목록
const ALLOWED_ACTIONS = ["click", "type", "scroll", "navigate", "select", "hover"];

function validateCommand(command) {
  if (!command || typeof command !== "object") {
    return "command가 유효한 객체가 아닙니다.";
  }
  if (!ALLOWED_ACTIONS.includes(command.action)) {
    return `허용되지 않은 action: ${command.action}`;
  }
  // selector가 필요한 액션들
  const needsSelector = ["click", "type", "select", "hover"];
  if (needsSelector.includes(command.action) && !command.selector) {
    return `${command.action} 액션에는 selector가 필요합니다.`;
  }
  if (command.action === "navigate" && !command.url) {
    return "navigate 액션에는 url이 필요합니다.";
  }
  return null; // valid
}

// EXECUTE_ACTION 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "EXECUTE_ACTION") return false;

  const command = msg.command;
  console.log("[background] EXECUTE_ACTION received:", command);

  // 1. plan 검증
  const validationError = validateCommand(command);
  if (validationError) {
    console.warn("[background] validation failed:", validationError);
    sendResponse({ success: false, error: validationError });
    return false;
  }

  // 비동기 처리를 위해 true 반환
  (async () => {
    try {
      // 2. 활성 탭 확인
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ success: false, error: "활성 탭을 찾을 수 없습니다." });
        return;
      }

      // 3. 도메인 확인 (chrome:// 등 제한된 URL 차단)
      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        sendResponse({ success: false, error: "브라우저 내부 페이지에서는 실행할 수 없습니다." });
        return;
      }

      // 4. navigate는 chrome.tabs.update로 별도 처리
      if (command.action === "navigate") {
        await chrome.tabs.update(tab.id, { url: command.url });
        console.log("[background] navigated to:", command.url);
        sendResponse({ success: true, log: `${command.url}로 이동했습니다.` });
        return;
      }

      // 5. DOM 조작 액션: runner.js 주입 후 메시지 전달
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["runner.js"]
      });

      const response = await chrome.tabs.sendMessage(tab.id, {
        kind: "RUN_PLAN",
        plan: command
      });

      console.log("[background] runner response:", response);
      sendResponse(response || { success: false, error: "runner로부터 응답이 없습니다." });
    } catch (e) {
      console.error("[background] EXECUTE_ACTION error:", e);
      sendResponse({ success: false, error: e?.message || String(e) });
    }
  })();

  return true; // 비동기 sendResponse를 위해 true 반환
});
