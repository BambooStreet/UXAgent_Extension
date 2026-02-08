async function callOpenAICompatible({ baseUrl, apiKey, model, prompt }) {
  // OpenAI-compatible: POST {baseUrl}/v1/chat/completions
  // ※ 공급자마다 필드명이 조금씩 다를 수 있어. 안 맞으면 여기만 고치면 됨.
  const url = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

  const body = {
    model,
    messages: [
      { role: "system", content: "You are a UX research assistant. Recommend the next user action without controlling the browser." },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`AI API error ${res.status}: ${txt.slice(0, 400)}`);

  const json = JSON.parse(txt);
  const answer =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.text ??
    "(No content)";
  return String(answer);
}

function buildPrompt({ task, page }) {
  const elementsPreview = page.elements
    .slice(0, 60)
    .map(e => `- ${e.id} ${e.tag}${e.role ? `[role=${e.role}]` : ""} label="${e.label}" selector="${e.selector}" rect=${JSON.stringify(e.rect)}`)
    .join("\n");

  return `
Task:
${task}

Current page:
- url: ${page.url}
- title: ${page.title}
- viewport: ${JSON.stringify(page.viewport)}

Interactive elements (top 60):
${elementsPreview}

Simplified HTML (truncated):
${page.simpleHtml.slice(0, 12000)}

Please output:
1) UI/UX 특징(짧게) 5개
2) 다음으로 사용자가 해야 할 추천 액션 Top 3 (각각: 어떤 요소/왜/주의점)
3) 다음 캡처를 언제 해야 하는지(추천 액션 수행 후 어떤 상태에서 캡처할지)
  `.trim();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type !== "CAPTURE_AND_ASK") return;

    const { task, baseUrl, model, apiKey, page } = msg.payload;

    // 스크린샷(뷰포트)
    // 스크린샷(뷰포트) - sender.tab을 믿지 말고 직접 활성 탭을 찾는다
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.windowId) throw new Error("활성 탭/windowId를 찾지 못했습니다.");

    const pngDataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, { format: "png" });

    // 로컬 데모에서는 파일 저장까지는 생략 가능(원하면 downloads 권한 추가해 저장 가능)
    // 여기서는 AI 호출만

    const prompt = buildPrompt({ task, page });
    const answer = await callOpenAICompatible({ baseUrl, apiKey, model, prompt });

    sendResponse({ ok: true, answer });
  })().catch(e => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true;
});
