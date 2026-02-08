console.log("[sidepanel] loaded");

const $ = (id) => document.getElementById(id);

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

async function loadSettings() {
  const s = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  if (s.apiKey) $("apiKey").value = s.apiKey;
  if (s.baseUrl) $("baseUrl").value = s.baseUrl;
  if (s.model) $("model").value = s.model;
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim()
  });
}

function setOut(txt) {
  $("out").textContent = txt;
}

loadSettings();

$("captureAsk").addEventListener("click", async () => {
  try {
    setOut("Capturing...");
    await saveSettings();

    const task = $("task").value.trim() || "Untitled task";
    const apiKey = $("apiKey").value.trim();
    const baseUrl = $("baseUrl").value.trim();
    const model = $("model").value.trim();

    if (!apiKey) throw new Error("API Key를 입력하세요.");

    const tab = await getActiveTab();
    await injectContentScript(tab.id);

    // 1) 페이지에서 DOM/요소맵 추출
    const extracted = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT" });

    // 2) background로 보내서 스크린샷 + AI 호출
    setOut("Calling AI...");
    const resp = await chrome.runtime.sendMessage({
      type: "CAPTURE_AND_ASK",
      payload: {
        task,
        baseUrl,
        model,
        apiKey,
        page: extracted
      }
    });

    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");

    setOut(resp.answer || "(no answer)");
  } catch (e) {
    setOut(`Error: ${e?.message || e}`);
  }
});
