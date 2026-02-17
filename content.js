function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  return true;
}

function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  // 요소가 뷰포트 내에 적어도 일부라도 보이는지 확인
  return (
    rect.top < viewportHeight &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.right > 0
  );
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

function getStyleInfo(el) {
  const style = getComputedStyle(el);
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    borderRadius: style.borderRadius,
    position: style.position,
    zIndex: style.zIndex
  };
}

function getInteractionInfo(el) {
  const tag = el.tagName.toLowerCase();
  const isDisabled = el.disabled || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
  const isReadonly = el.readOnly || el.hasAttribute('readonly');
  const tabIndex = el.tabIndex;

  // 클릭 가능 여부: button, a, role=button 등
  const clickable = ['button', 'a'].includes(tag) ||
                    el.getAttribute('role') === 'button' ||
                    el.onclick !== null ||
                    el.hasAttribute('onclick');

  // 포커스 가능 여부
  const focusable = tabIndex >= 0 || ['input', 'select', 'textarea', 'button', 'a'].includes(tag);

  return {
    clickable,
    focusable,
    disabled: isDisabled,
    readonly: isReadonly,
    tabIndex
  };
}


function extractElements() {
  const nodes = Array.from(document.querySelectorAll(
    "a, button, input, select, textarea, [role='button'], [role='link']"
  ));

  const candidates = [];
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    // viewport 제한 제거 - 페이지 전체 요소 추출
    // if (!isInViewport(el)) continue;

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    candidates.push({
      element: el,
      rect,
      style,
      // 모달/팝업 우선순위 계산
      zIndex: parseInt(style.zIndex) || 0,
      isFixed: style.position === 'fixed' || style.position === 'absolute'
    });
  }

  // z-index 높은 순으로 정렬 (팝업/모달 우선)
  candidates.sort((a, b) => {
    // position fixed/absolute이면서 z-index 높은 것 우선
    if (a.isFixed && !b.isFixed) return -1;
    if (!a.isFixed && b.isFixed) return 1;
    return b.zIndex - a.zIndex;
  });

  const out = [];
  for (let i = 0; i < candidates.length && i < 180; i++) {
    const { element: el, rect, style } = candidates[i];
    out.push({
      id: `item${i}`,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      label: labelOf(el),
      selector: uniqueSelector(el),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      style: getStyleInfo(el),
      interaction: getInteractionInfo(el)
    });
  }
  return out;
}

function extractOverlayText() {
  const overlays = [];
  const seen = new Set();

  // 1. role="dialog" 또는 aria-modal="true" 요소
  const ariaOverlays = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');

  // 2. 클래스 패턴으로 매칭
  const classOverlays = document.querySelectorAll(
    '[class*="modal"], [class*="popup"], [class*="dialog"], [class*="overlay"], [class*="Modal"], [class*="Popup"], [class*="Dialog"], [class*="Overlay"]'
  );

  // 3. position: fixed/absolute + z-index >= 100 + 크기 조건으로 감지
  const allElements = document.querySelectorAll('*');
  const styleOverlays = [];
  for (const el of allElements) {
    const s = getComputedStyle(el);
    const pos = s.position;
    if (pos !== 'fixed' && pos !== 'absolute') continue;
    const z = parseInt(s.zIndex) || 0;
    if (z < 100) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 100 || rect.height <= 50) continue;
    // header, nav, footer 태그 제외 (sticky header 오탐 방지)
    const tag = el.tagName.toLowerCase();
    if (['header', 'nav', 'footer'].includes(tag)) continue;
    styleOverlays.push(el);
  }

  const candidates = new Set([...ariaOverlays, ...classOverlays, ...styleOverlays]);

  for (const el of candidates) {
    if (seen.has(el)) continue;
    seen.add(el);

    const tag = el.tagName.toLowerCase();
    if (['header', 'nav', 'footer'].includes(tag)) continue;

    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!text) continue;

    overlays.push({
      tag,
      role: el.getAttribute('role') || '',
      className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 100) : '',
      text,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      zIndex: parseInt(s.zIndex) || 0,
      position: s.position
    });

    if (overlays.length >= 5) break;
  }

  return overlays;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "EXTRACT") return;

  const payload = {
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    elements: extractElements(),
    overlayTexts: extractOverlayText()
  };

  sendResponse(payload);
});
