function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  return true;
}

function labelOf(el) {
  return (
    (el.getAttribute("aria-label") || "").trim() ||
    (el.getAttribute("alt") || "").trim() ||
    (el.getAttribute("title") || "").trim() ||
    (el.getAttribute("placeholder") || "").trim() ||
    (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160)
  );
}

function uniqueSelector(el) {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }
  const attrs = ["data-testid", "data-test", "data-qa", "data-cy"];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v) {
      const sel = `[${a}="${v}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }
  // 짧은 경로(최대 4단)
  let cur = el, parts = [];
  for (let i = 0; i < 4 && cur && cur.nodeType === 1; i++) {
    const tag = cur.tagName.toLowerCase();
    const p = cur.parentElement;
    if (!p) break;
    const sibs = Array.from(p.children).filter(x => x.tagName === cur.tagName);
    const idx = sibs.indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    cur = p;
  }
  return parts.join(" > ");
}

function simplifyHtml() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, style, noscript").forEach(n => n.remove());

  // 클래스/스타일 제거 + input value 마스킹
  clone.querySelectorAll("*").forEach(el => {
    el.removeAttribute("class");
    el.removeAttribute("style");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.getAttribute("value")) el.setAttribute("value", "__MASKED__");
    }
  });

  return "<!DOCTYPE html>\n" + clone.outerHTML;
}

function extractElements() {
  const nodes = Array.from(document.querySelectorAll(
    "a, button, input, select, textarea, [role='button'], [role='link']"
  ));

  const out = [];
  let n = 0;
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    if (n >= 180) break; // 너무 많으면 비용/토큰 폭발 방지

    const rect = el.getBoundingClientRect();
    out.push({
      id: `item${n++}`,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      label: labelOf(el),
      selector: uniqueSelector(el),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    });
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "EXTRACT") return;

  const payload = {
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    simpleHtml: simplifyHtml().slice(0, 120000), // 안전하게 길이 제한
    elements: extractElements()
  };

  sendResponse(payload);
});
