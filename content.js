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
  // 후보 선택자를 만들어 실제로 유일하게 매칭되는지 검증
  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch { return false; }
  }

  // 1. id
  if (el.id) {
    const sel = `#${CSS.escape(el.id)}`;
    if (isUnique(sel)) return sel;
  }

  // 2. data 속성
  const dataAttrs = ["data-testid", "data-test", "data-qa", "data-cy", "data-id", "data-item-id"];
  for (const a of dataAttrs) {
    const v = el.getAttribute(a);
    if (v) {
      const sel = `[${a}="${CSS.escape(v)}"]`;
      if (isUnique(sel)) return sel;
    }
  }

  const tag = el.tagName.toLowerCase();

  // 3. name 속성 (input, select, textarea)
  const name = el.getAttribute("name");
  if (name) {
    const sel = `${tag}[name="${CSS.escape(name)}"]`;
    if (isUnique(sel)) return sel;
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    const sel = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
    if (isUnique(sel)) return sel;
  }

  // 5. role + aria-label 조합
  const role = el.getAttribute("role");
  if (role && ariaLabel) {
    const sel = `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`;
    if (isUnique(sel)) return sel;
  }

  // 6. href (a 태그) — 경로만 사용, 쿼리 포함
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href && href.length < 200) {
      const sel = `a[href="${CSS.escape(href)}"]`;
      if (isUnique(sel)) return sel;
    }
  }

  // 7. type + placeholder (input)
  if (tag === "input") {
    const type = el.getAttribute("type") || "text";
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) {
      const sel = `input[type="${type}"][placeholder="${CSS.escape(placeholder)}"]`;
      if (isUnique(sel)) return sel;
    }
  }

  // 8. 고유 클래스 조합 — 짧은 클래스명만 사용
  if (el.classList.length > 0) {
    const classes = Array.from(el.classList)
      .filter(c => c.length > 1 && c.length < 50 && !/^[0-9]/.test(c));
    // 클래스 1~2개 조합으로 유일한 선택자 시도
    for (const c of classes) {
      const sel = `${tag}.${CSS.escape(c)}`;
      if (isUnique(sel)) return sel;
    }
    if (classes.length >= 2) {
      const sel = `${tag}.${CSS.escape(classes[0])}.${CSS.escape(classes[1])}`;
      if (isUnique(sel)) return sel;
    }
  }

  // 9. 부모 id + 자식 경로 (부모 중 id 있는 요소 탐색)
  let ancestor = el.parentElement;
  for (let depth = 1; depth <= 5 && ancestor; depth++) {
    if (ancestor.id) {
      const parentSel = `#${CSS.escape(ancestor.id)}`;
      // 부모 아래에서 같은 태그의 몇 번째인지
      const sibs = ancestor.querySelectorAll(`:scope ${tag}`);
      const idx = Array.from(sibs).indexOf(el);
      if (idx !== -1) {
        const sel = `${parentSel} ${tag}:nth-of-type(${idx + 1})`;
        if (isUnique(sel)) return sel;
      }
      // 부모 아래 직접 자손 경로
      const path = buildPathFromAncestor(el, ancestor);
      if (path && isUnique(`${parentSel} ${path}`)) {
        return `${parentSel} ${path}`;
      }
      break;
    }
    ancestor = ancestor.parentElement;
  }

  // 10. 최종 fallback: body부터의 전체 경로 (최대 8단계)
  return buildFullPath(el);
}

function buildPathFromAncestor(el, ancestor) {
  const parts = [];
  let cur = el;
  while (cur && cur !== ancestor && parts.length < 6) {
    const tag = cur.tagName.toLowerCase();
    const p = cur.parentElement;
    if (!p) break;
    const sibs = Array.from(p.children).filter(x => x.tagName === cur.tagName);
    if (sibs.length > 1) {
      parts.unshift(`${tag}:nth-of-type(${sibs.indexOf(cur) + 1})`);
    } else {
      parts.unshift(tag);
    }
    cur = p;
  }
  return parts.length > 0 ? parts.join(" > ") : null;
}

function buildFullPath(el) {
  const parts = [];
  let cur = el;
  for (let i = 0; i < 8 && cur && cur.nodeType === 1 && cur !== document.documentElement; i++) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;
    const p = cur.parentElement;
    if (!p) break;
    const sibs = Array.from(p.children).filter(x => x.tagName === cur.tagName);
    if (sibs.length > 1) {
      parts.unshift(`${tag}:nth-of-type(${sibs.indexOf(cur) + 1})`);
    } else {
      parts.unshift(tag);
    }
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

  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  // 뷰포트 내에 보이는지 + 최소 면적 충족하는지 확인
  function isOverlayVisible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity) === 0) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    // 뷰포트 안에 있어야 함
    if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) return false;
    return true;
  }

  // 뷰포트의 상당 부분을 가리는 모달/팝업인지 판별
  function coversViewport(el) {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const vpArea = vw * vh;
    // 뷰포트 면적의 10% 이상을 차지해야 팝업으로 인정
    return area >= vpArea * 0.1;
  }

  // 1. role="dialog" 또는 aria-modal="true" — 확실한 팝업
  const ariaOverlays = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');

  // 2. 클래스 패턴 — modal/popup/dialog만 (overlay는 오탐이 많아 제외)
  const classOverlays = document.querySelectorAll(
    '[class*="modal" i], [class*="popup" i], [class*="dialog" i], [class*="Modal"], [class*="Popup"], [class*="Dialog"]'
  );

  // 3. position: fixed + z-index >= 900 + 뷰포트 10% 이상 덮는 요소
  const allElements = document.querySelectorAll('*');
  const styleOverlays = [];
  for (const el of allElements) {
    const s = getComputedStyle(el);
    // fixed만 (absolute는 오탐이 너무 많음 — 일반 레이아웃 요소가 잡힘)
    if (s.position !== 'fixed') continue;
    const z = parseInt(s.zIndex) || 0;
    if (z < 900) continue;
    const tag = el.tagName.toLowerCase();
    if (['header', 'nav', 'footer', 'aside'].includes(tag)) continue;
    if (!coversViewport(el)) continue;
    styleOverlays.push(el);
  }

  const candidates = new Set([...ariaOverlays, ...classOverlays, ...styleOverlays]);

  for (const el of candidates) {
    if (seen.has(el)) continue;
    seen.add(el);

    const tag = el.tagName.toLowerCase();
    if (['header', 'nav', 'footer', 'aside'].includes(tag)) continue;

    if (!isOverlayVisible(el)) continue;

    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!text) continue;

    const s = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

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
