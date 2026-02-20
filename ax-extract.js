// ax-extract.js — AX Tree extraction via DOM fallback
// Injected dynamically by sidepanel.js via chrome.scripting.executeScript

if (!window.__axExtractInstalled) {
  window.__axExtractInstalled = true;

  // ── Hash ──
  function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  // ── Accessible Name with Source (simplified WAI-ARIA computation) ──
  function computeAccessibleNameWithSource(el) {
    // 1. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.textContent || "").trim() : "";
      }).filter(Boolean);
      if (parts.length) return { name: parts.join(" ").slice(0, 200), labelSource: "aria-labelledby" };
    }

    // 2. aria-label
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel) return { name: ariaLabel.slice(0, 200), labelSource: "aria-label" };

    // 3. <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const txt = (label.textContent || "").trim();
        if (txt) return { name: txt.slice(0, 200), labelSource: "label-for" };
      }
    }

    // 4. wrapping <label>
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const txt = (parentLabel.textContent || "").trim();
      if (txt) return { name: txt.slice(0, 200), labelSource: "wrapping-label" };
    }

    // 5. alt (img, area, input[type=image])
    const alt = (el.getAttribute("alt") || "").trim();
    if (alt) return { name: alt.slice(0, 200), labelSource: "alt" };

    // 6. title
    const title = (el.getAttribute("title") || "").trim();
    if (title) return { name: title.slice(0, 200), labelSource: "title" };

    // 7. placeholder
    const placeholder = (el.getAttribute("placeholder") || "").trim();
    if (placeholder) return { name: placeholder.slice(0, 200), labelSource: "placeholder" };

    // 8. innerText (for buttons, links, etc.) — innerText skips hidden text, textContent does not
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "summary"].includes(tag) || el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
      const inner = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (inner) return { name: inner.slice(0, 200), labelSource: "innerText" };
      // textContent fallback (e.g. when innerText is unavailable in detached DOM)
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (txt) return { name: txt.slice(0, 200), labelSource: "textContent" };
    }

    // 9. value for submit/reset buttons
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["submit", "reset", "button"].includes(type)) {
        const val = (el.getAttribute("value") || "").trim();
        if (val) return { name: val.slice(0, 200), labelSource: "value" };
      }
    }

    return { name: "", labelSource: "unknown" };
  }

  // Backward-compatible wrapper
  function computeAccessibleName(el) {
    return computeAccessibleNameWithSource(el).name;
  }

  // ── Element States ──
  function getElementStates(el) {
    return {
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      checked: el.checked === true || el.getAttribute("aria-checked") === "true",
      expanded: el.getAttribute("aria-expanded") === "true" ? true :
                el.getAttribute("aria-expanded") === "false" ? false : undefined,
      selected: el.selected === true || el.getAttribute("aria-selected") === "true",
      required: el.required === true || el.getAttribute("aria-required") === "true",
      readonly: el.readOnly === true || el.getAttribute("aria-readonly") === "true"
    };
  }

  // ── Semantic Role ──
  const IMPLICIT_ROLES = {
    a: (el) => el.hasAttribute("href") ? "link" : undefined,
    button: () => "button",
    input: (el) => {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const map = {
        text: "textbox", search: "searchbox", email: "textbox", url: "textbox",
        tel: "textbox", password: "textbox", number: "spinbutton",
        range: "slider", checkbox: "checkbox", radio: "radio",
        submit: "button", reset: "button", button: "button",
        image: "button"
      };
      return map[type] || "textbox";
    },
    select: (el) => el.multiple ? "listbox" : "combobox",
    textarea: () => "textbox",
    summary: () => "button",
    img: () => "img",
    nav: () => "navigation",
    main: () => "main",
    header: () => "banner",
    footer: () => "contentinfo",
    aside: () => "complementary",
    form: () => "form",
    section: (el) => el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") ? "region" : undefined,
    ul: () => "list",
    ol: () => "list",
    li: () => "listitem",
    table: () => "table",
    h1: () => "heading", h2: () => "heading", h3: () => "heading",
    h4: () => "heading", h5: () => "heading", h6: () => "heading"
  };

  function getSemanticRole(el) {
    // Explicit role takes priority
    const explicit = (el.getAttribute("role") || "").trim();
    if (explicit) return explicit;

    // Implicit role from tag
    const tag = el.tagName.toLowerCase();
    const fn = IMPLICIT_ROLES[tag];
    return fn ? (fn(el) || "") : "";
  }

  // ── Stable Attribute for fingerprinting ──
  function getStableAttr(el) {
    // data-testid (most stable)
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
    if (testId) return `testid:${testId}`;

    // id (skip auto-generated patterns)
    const id = el.id;
    if (id && !/^(:|ember|react|vue|ng-|__)|^\d+$|^[a-f0-9-]{20,}$/i.test(id)) {
      return `id:${id}`;
    }

    // name attribute
    const name = el.getAttribute("name");
    if (name) return `name:${name}`;

    // aria-label
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel) return `aria:${ariaLabel.slice(0, 60)}`;

    // href (path only)
    const href = el.getAttribute("href");
    if (href) {
      try {
        const u = new URL(href, location.origin);
        return `href:${u.pathname}`;
      } catch {
        return `href:${href.slice(0, 60)}`;
      }
    }

    // placeholder
    const placeholder = (el.getAttribute("placeholder") || "").trim();
    if (placeholder) return `ph:${placeholder.slice(0, 40)}`;

    return "";
  }

  // ── Fingerprint → eid ──
  function fingerprintElement(el) {
    const role = getSemanticRole(el);
    const tag = el.tagName.toLowerCase();
    const name = computeAccessibleName(el);
    const stable = getStableAttr(el);
    const raw = `${role}|${tag}|${name}|${stable}`;
    return `e-${djb2Hash(raw)}`;
  }

  // ── Parent Context ──
  function getParentContext(el) {
    let cur = el.parentElement;
    for (let depth = 0; depth < 5 && cur; depth++) {
      const tag = cur.tagName.toLowerCase();
      if (["body", "html"].includes(tag)) break;

      const role = cur.getAttribute("role");
      const landmarks = ["form", "nav", "main", "header", "footer", "aside", "section", "article", "dialog"];

      if (role || landmarks.includes(tag) || cur.id || cur.classList.length > 0) {
        let ctx = tag;
        if (role) ctx += `[role=${role}]`;
        if (cur.id && cur.id.length < 40) ctx = `${tag}#${cur.id}`;
        else if (cur.classList.length > 0) {
          const cls = Array.from(cur.classList).filter(c => c.length < 30).slice(0, 2).join(".");
          if (cls) ctx = `${tag}.${cls}`;
        }
        return ctx.slice(0, 60);
      }
      cur = cur.parentElement;
    }
    return "";
  }

  // ── Nearest Landmark (for tier classification) ──
  const LANDMARK_ROLES = new Set(["banner", "contentinfo", "navigation", "complementary", "main", "search"]);

  function getNearestLandmark(el) {
    let cur = el.parentElement;
    while (cur) {
      const tag = cur.tagName.toLowerCase();
      if (tag === "body" || tag === "html") break;

      const role = (cur.getAttribute("role") || "").toLowerCase();
      if (LANDMARK_ROLES.has(role)) return role;

      if (tag === "nav") return "navigation";
      if (tag === "aside") return "complementary";
      if (tag === "main") return "main";
      if (tag === "header" && cur.parentElement === document.body) return "banner";
      if (tag === "footer" && cur.parentElement === document.body) return "contentinfo";

      cur = cur.parentElement;
    }
    return "";
  }

  // ── Visibility check ──
  function axIsVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    return true;
  }

  // CSS off-screen detection
  function isOffScreen(rect) {
    const threshold = -1000;
    return (rect.right < threshold || rect.bottom < threshold);
  }

  // Find visible proxy for hidden radio/checkbox inputs
  function findVisibleProxy(el) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "input") return null;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type !== "radio" && type !== "checkbox") return null;

    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && axIsVisible(label) && !isOffScreen(label.getBoundingClientRect())) {
        return label;
      }
    }

    const parentLabel = el.closest("label");
    if (parentLabel && axIsVisible(parentLabel) && !isOffScreen(parentLabel.getBoundingClientRect())) {
      return parentLabel;
    }

    const parentLi = el.closest("li");
    if (parentLi && axIsVisible(parentLi) && !isOffScreen(parentLi.getBoundingClientRect())) {
      return parentLi;
    }

    return null;
  }

  // ── Active Layer Detection ──
  // Detects modals/popups/overlays that should receive interaction priority.
  // Multiple modal tie-break: highest z-index wins, smallest area breaks ties (backdrop filter).
  function detectActiveLayer() {
    const vpArea = window.innerWidth * window.innerHeight;
    const candidates = [];

    // Shared full-DOM scan (used by both activeLayer + overlayTexts)
    const allElements = document.querySelectorAll('*');

    // 1. role="dialog" / aria-modal="true"
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const d of dialogs) {
      if (!axIsVisible(d)) continue;
      const s = getComputedStyle(d);
      const z = parseInt(s.zIndex) || 0;
      const rect = d.getBoundingClientRect();
      candidates.push({ el: d, type: "modal", z, area: rect.width * rect.height });
    }

    // 2. className patterns (modal/popup/dialog)
    const classModals = document.querySelectorAll(
      '[class*="modal" i], [class*="popup" i], [class*="dialog" i]'
    );
    for (const m of classModals) {
      if (!axIsVisible(m)) continue;
      if (candidates.some(c => c.el === m)) continue; // already in candidates
      const s = getComputedStyle(m);
      const z = parseInt(s.zIndex) || 0;
      if ((s.position === 'fixed' || s.position === 'absolute') && z >= 900) {
        const rect = m.getBoundingClientRect();
        if (rect.width * rect.height >= vpArea * 0.1) {
          candidates.push({ el: m, type: "modal", z, area: rect.width * rect.height });
        }
      }
    }

    // 3. position:fixed + high z-index + viewport 10%+
    for (const el of allElements) {
      if (candidates.some(c => c.el === el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== 'fixed') continue;
      const z = parseInt(s.zIndex) || 0;
      if (z < 900) continue;
      const tag = el.tagName.toLowerCase();
      if (['header', 'nav', 'footer', 'aside'].includes(tag)) continue;
      if (!axIsVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height >= vpArea * 0.1) {
        candidates.push({ el, type: "overlay", z, area: rect.width * rect.height });
      }
    }

    if (candidates.length === 0) {
      return { present: false, type: null, root: null, allElements };
    }

    // Multiple modal tie-break: highest z-index first, then smallest area (backdrop is larger than dialog)
    candidates.sort((a, b) => {
      if (b.z !== a.z) return b.z - a.z;
      return a.area - b.area; // smaller area = actual dialog (not backdrop)
    });

    // Backdrop vs Dialog tie-break:
    // Only swap to inner candidate when winner looks like a backdrop/overlay (not itself a dialog),
    // and the inner candidate is a "real" dialog element.
    let winner = candidates[0];
    const isRealDialog = (c) => {
      const el = c.el;
      return el.tagName.toLowerCase() === "dialog" ||
             el.getAttribute("role") === "dialog" ||
             el.getAttribute("aria-modal") === "true";
    };
    const isBackdrop = (c) => c.type === "overlay" && !isRealDialog(c);

    if (isBackdrop(winner)) {
      for (let i = 1; i < candidates.length; i++) {
        if (winner.el.contains(candidates[i].el) && isRealDialog(candidates[i])) {
          winner = candidates[i]; // genuine dialog inside backdrop wins
          break;
        }
      }
    }

    return { present: true, type: winner.type, root: winner.el, allElements };
  }

  // ── Block Building (hierarchical structure) ──
  const BLOCK_SELECTORS = 'dialog, form, section, article, main, nav, aside, [role="dialog"], [role="form"], [role="region"], [role="navigation"], [role="complementary"]';

  function getBlockTitle(el) {
    // 1. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.textContent || "").trim() : "";
      }).filter(Boolean);
      if (parts.length) return parts.join(" ").slice(0, 80);
    }

    // 2. aria-label
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel) return ariaLabel.slice(0, 80);

    // 3. First heading inside
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      const txt = (heading.textContent || "").trim().replace(/\s+/g, " ");
      if (txt) return txt.slice(0, 80);
    }

    return "";
  }

  function buildBlocks(elementDataList) {
    const blockContainers = Array.from(document.querySelectorAll(BLOCK_SELECTORS));
    const blocks = [];
    const blockMap = new Map(); // element DOM node → blockId

    for (const container of blockContainers) {
      if (!axIsVisible(container)) continue;
      const tag = container.tagName.toLowerCase();
      const role = (container.getAttribute("role") || "").trim() || tag;
      const stable = getStableAttr(container);
      const blockId = `b-${djb2Hash(role + (stable || tag + container.className))}`;
      const title = getBlockTitle(container);

      blocks.push({
        blockId,
        type: role,
        title,
        children: [] // will be filled with eids
      });

      blockMap.set(container, { blockId, title });
    }

    // For each element, find closest block ancestor and compute breadcrumbs
    for (const elData of elementDataList) {
      if (!elData._domEl) continue;
      let foundBlockId = "";
      const breadcrumbs = [];

      let cur = elData._domEl.parentElement;
      while (cur) {
        if (cur.tagName.toLowerCase() === "body") break;
        if (blockMap.has(cur)) {
          const info = blockMap.get(cur);
          foundBlockId = info.blockId;
          // Build breadcrumbs chain upward
          breadcrumbs.unshift(info.title || info.blockId);
          // Continue upward for nested blocks
          let upper = cur.parentElement;
          while (upper && upper.tagName.toLowerCase() !== "body") {
            if (blockMap.has(upper)) {
              breadcrumbs.unshift(blockMap.get(upper).title || blockMap.get(upper).blockId);
            }
            upper = upper.parentElement;
          }
          break;
        }
        cur = cur.parentElement;
      }

      elData.blockId = foundBlockId;
      elData.breadcrumbs = breadcrumbs.filter(Boolean);

      // Add eid to the block's children list
      if (foundBlockId) {
        const block = blocks.find(b => b.blockId === foundBlockId);
        if (block) block.children.push(elData.eid);
      }
    }

    return blocks;
  }

  // ── Overlay Text Extraction ──
  function extractOverlays(activeLayerResult) {
    const overlays = [];
    const seen = new Set();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    function isOverlayVisible(el) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (parseFloat(s.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw) return false;
      return true;
    }

    function coversViewport(el) {
      const rect = el.getBoundingClientRect();
      return (rect.width * rect.height) >= (vw * vh * 0.1);
    }

    // 1. role="dialog" / aria-modal="true"
    const ariaOverlays = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');

    // 2. Class pattern overlays
    const classOverlays = document.querySelectorAll(
      '[class*="modal" i], [class*="popup" i], [class*="dialog" i], [class*="Modal"], [class*="Popup"], [class*="Dialog"]'
    );

    // 3. position:fixed + high z-index — reuse the allElements from activeLayer scan
    const styleOverlays = [];
    const allElements = activeLayerResult?.allElements || document.querySelectorAll('*');
    for (const el of allElements) {
      const s = getComputedStyle(el);
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

  // ── Build Tree Summary ──
  function buildTreeSummary() {
    const counts = {
      nav: 0, main: 0, headings: 0,
      forms: 0, inputs: 0,
      buttons: 0, links: 0
    };

    counts.nav = document.querySelectorAll('nav, [role="navigation"]').length;
    counts.main = document.querySelectorAll('main, [role="main"]').length;
    counts.headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').length;
    counts.forms = document.querySelectorAll('form, [role="form"]').length;
    counts.inputs = document.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"], [role="searchbox"]').length;
    counts.buttons = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]').length;
    counts.links = document.querySelectorAll('a[href], [role="link"]').length;

    const title = document.title || "(no title)";
    return `Page: "${title}" | ${counts.nav} nav, ${counts.main} main | ${counts.headings} headings | ${counts.forms} form, ${counts.inputs} inputs | ${counts.buttons} buttons, ${counts.links} links`;
  }

  // ── Extract AX Snapshot (main) ──
  const INTERACTIVE_SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[role="menuitem"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
    '[role="switch"]', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]', 'summary'
  ].join(', ');

  function extractAXSnapshot() {
    // 1. Detect Active Layer
    const activeLayerResult = detectActiveLayer();
    const hasActiveLayer = activeLayerResult.present;
    const activeRoot = activeLayerResult.root;

    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));

    // Separate nodes into modal-inside vs background
    let modalNodes = [];
    let bgNodes = [];
    if (hasActiveLayer) {
      for (const el of nodes) {
        if (activeRoot.contains(el)) {
          modalNodes.push(el);
        } else {
          bgNodes.push(el);
        }
      }
    } else {
      bgNodes = nodes;
    }

    // Stable sort within each group: z-index desc, DOM order as tie-breaker
    // (Array.sort is stable in modern JS, so same-z elements keep original DOM order)
    function sortByZIndex(arr) {
      return arr.slice().sort((a, b) => {
        const za = parseInt(getComputedStyle(a).zIndex) || 0;
        const zb = parseInt(getComputedStyle(b).zIndex) || 0;
        return zb - za;
      });
    }
    if (hasActiveLayer) {
      modalNodes = sortByZIndex(modalNodes);
      bgNodes = sortByZIndex(bgNodes);
    }

    // Process nodes: modal-inside first, then background
    const orderedNodes = hasActiveLayer ? [...modalNodes, ...bgNodes] : bgNodes;

    const elements = [];
    const eidCounts = {};
    const proxySet = new Set();

    for (const el of orderedNodes) {
      if (!axIsVisible(el)) continue;
      if (elements.length >= 200) break;

      const rect = el.getBoundingClientRect();

      // Off-screen: find proxy
      let targetEl = el;
      let isProxied = false;
      if (isOffScreen(rect)) {
        const proxy = findVisibleProxy(el);
        if (!proxy) continue;
        if (proxySet.has(proxy)) continue;
        proxySet.add(proxy);
        targetEl = proxy;
        isProxied = true;
      }

      const targetRect = isProxied ? targetEl.getBoundingClientRect() : rect;
      const tag = el.tagName.toLowerCase();
      const role = getSemanticRole(el);
      const { name, labelSource } = computeAccessibleNameWithSource(el);
      const states = getElementStates(el);

      // Value for form controls
      let value = "";
      if (["input", "textarea", "select"].includes(tag)) {
        value = el.value || "";
      } else if (el.getAttribute("contenteditable") === "true") {
        value = (el.textContent || "").trim().slice(0, 200);
      }

      // Description (aria-describedby)
      let description = "";
      const describedBy = el.getAttribute("aria-describedby");
      if (describedBy) {
        description = describedBy.split(/\s+/).map(id => {
          const ref = document.getElementById(id);
          return ref ? (ref.textContent || "").trim() : "";
        }).filter(Boolean).join(" ").slice(0, 200);
      }

      // Compute eid
      let eid = fingerprintElement(el);
      if (eidCounts[eid] === undefined) {
        eidCounts[eid] = 0;
      } else {
        eidCounts[eid]++;
        eid = `${eid}-${eidCounts[eid]}`;
      }

      // CSS selector
      const selectorTarget = isProxied ? targetEl : el;
      let selector = "";
      if (typeof uniqueSelector === "function") {
        try {
          selector = uniqueSelector(selectorTarget);
        } catch {
          selector = buildBasicSelector(selectorTarget);
        }
      } else {
        selector = buildBasicSelector(selectorTarget);
      }

      // Mark if inside active layer
      const inActiveLayer = hasActiveLayer && activeRoot.contains(el);

      // For blocks/breadcrumbs: use proxy (visible UI element) when proxied,
      // so hierarchy reflects what the user actually sees, not the hidden input.
      const blockRefEl = isProxied ? targetEl : el;

      elements.push({
        eid,
        tag: isProxied ? targetEl.tagName.toLowerCase() : tag,
        role,
        name,
        labelSource,
        value,
        description,
        states,
        selector,
        rect: {
          x: Math.round(targetRect.x),
          y: Math.round(targetRect.y),
          w: Math.round(targetRect.width),
          h: Math.round(targetRect.height)
        },
        parent_context: getParentContext(targetEl),
        landmark: getNearestLandmark(targetEl),
        inActiveLayer,
        // Temporary ref for block building (removed from output)
        _domEl: blockRefEl
      });
    }

    // 2. Build Blocks
    const blocks = buildBlocks(elements);

    // 3. Compute activeLayer blockId and ensure it exists in blocks
    let activeLayerBlockId = null;
    let activeLayerTitle = null;
    if (hasActiveLayer) {
      const stable = getStableAttr(activeRoot);
      const tag = activeRoot.tagName.toLowerCase();
      const role = (activeRoot.getAttribute("role") || "").trim() || tag;
      const candidateId = `b-${djb2Hash(role + (stable || tag + activeRoot.className))}`;

      // Check if this blockId actually exists in the built blocks array
      if (blocks.some(b => b.blockId === candidateId)) {
        activeLayerBlockId = candidateId;
      } else {
        // activeRoot is not in BLOCK_SELECTORS — force-add it so rootBlockId is valid
        activeLayerTitle = getBlockTitle(activeRoot);
        blocks.unshift({
          blockId: candidateId,
          type: role,
          title: activeLayerTitle,
          children: elements.filter(e => e.inActiveLayer).map(e => e.eid),
          _forced: true
        });
        activeLayerBlockId = candidateId;
      }
    }

    // 4. Extract overlay texts (reuse allElements from activeLayer scan)
    const overlayTexts = extractOverlays(activeLayerResult);

    // 5. Clean up _domEl refs from output
    for (const el of elements) {
      delete el._domEl;
    }

    const tree_summary = buildTreeSummary();

    return {
      obsVersion: 2,
      mode: "dom_fallback",
      tree_summary,
      interactive_elements: elements,
      element_count: elements.length,
      activeLayer: {
        present: activeLayerResult.present,
        type: activeLayerResult.type,
        rootBlockId: activeLayerBlockId || null
      },
      blocks,
      overlayTexts
    };
  }

  // ── Basic selector fallback ──
  function buildBasicSelector(el) {
    const tag = el.tagName.toLowerCase();

    if (el.id) {
      try {
        const sel = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    const name = el.getAttribute("name");
    if (name) {
      try {
        const sel = `${tag}[name="${CSS.escape(name)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      try {
        const sel = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    const parent = el.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = sibs.indexOf(el) + 1;
      const parentTag = parent.tagName.toLowerCase();
      if (parent.id) {
        return `#${CSS.escape(parent.id)} > ${tag}:nth-of-type(${idx})`;
      }
      return `${parentTag} > ${tag}:nth-of-type(${idx})`;
    }

    return tag;
  }

  // ── Resolve eid → selector ──
  function resolveEid(eid) {
    const snapshot = extractAXSnapshot();
    const found = snapshot.interactive_elements.find(el => el.eid === eid);
    if (found) {
      return { found: true, selector: found.selector, eid: found.eid };
    }
    return { found: false, selector: null, eid };
  }

  // ── Message handlers ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "EXTRACT_AX") {
      try {
        const result = extractAXSnapshot();
        sendResponse(result);
      } catch (e) {
        console.error("[ax-extract] EXTRACT_AX error:", e);
        sendResponse({ obsVersion: 2, mode: "dom_fallback", tree_summary: "", interactive_elements: [], element_count: 0, activeLayer: { present: false, type: null, rootBlockId: null }, blocks: [], overlayTexts: [], error: e.message });
      }
      return false;
    }

    if (msg.type === "RESOLVE_EID") {
      try {
        const result = resolveEid(msg.eid);
        sendResponse(result);
      } catch (e) {
        console.error("[ax-extract] RESOLVE_EID error:", e);
        sendResponse({ found: false, selector: null, eid: msg.eid, error: e.message });
      }
      return false;
    }
  });

  console.log("[ax-extract] installed (v2)");
}
