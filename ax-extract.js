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

  // ── Accessible Name (simplified WAI-ARIA computation) ──
  function computeAccessibleName(el) {
    // 1. aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? (ref.textContent || "").trim() : "";
      }).filter(Boolean);
      if (parts.length) return parts.join(" ").slice(0, 200);
    }

    // 2. aria-label
    const ariaLabel = (el.getAttribute("aria-label") || "").trim();
    if (ariaLabel) return ariaLabel.slice(0, 200);

    // 3. <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const txt = (label.textContent || "").trim();
        if (txt) return txt.slice(0, 200);
      }
    }

    // 4. wrapping <label>
    const parentLabel = el.closest("label");
    if (parentLabel) {
      const txt = (parentLabel.textContent || "").trim();
      if (txt) return txt.slice(0, 200);
    }

    // 5. alt (img, area, input[type=image])
    const alt = (el.getAttribute("alt") || "").trim();
    if (alt) return alt.slice(0, 200);

    // 6. title
    const title = (el.getAttribute("title") || "").trim();
    if (title) return title.slice(0, 200);

    // 7. placeholder
    const placeholder = (el.getAttribute("placeholder") || "").trim();
    if (placeholder) return placeholder.slice(0, 200);

    // 8. textContent (for buttons, links, etc.)
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "summary"].includes(tag) || el.getAttribute("role") === "button" || el.getAttribute("role") === "link") {
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (txt) return txt.slice(0, 200);
    }

    // 9. value for submit/reset buttons
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["submit", "reset", "button"].includes(type)) {
        const val = (el.getAttribute("value") || "").trim();
        if (val) return val.slice(0, 200);
      }
    }

    return "";
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

  // ── Visibility check (reuse from content.js if available) ──
  function axIsVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    return true;
  }

  // ── Build Tree Summary ──
  function buildTreeSummary() {
    const counts = {
      nav: 0, main: 0, headings: 0,
      forms: 0, inputs: 0,
      buttons: 0, links: 0
    };

    // Landmarks
    counts.nav = document.querySelectorAll('nav, [role="navigation"]').length;
    counts.main = document.querySelectorAll('main, [role="main"]').length;

    // Headings
    counts.headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').length;

    // Forms & inputs
    counts.forms = document.querySelectorAll('form, [role="form"]').length;
    counts.inputs = document.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"], [role="searchbox"]').length;

    // Buttons & links
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
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));

    const elements = [];
    const eidCounts = {};  // for collision handling

    for (const el of nodes) {
      if (!axIsVisible(el)) continue;
      if (elements.length >= 200) break;

      const tag = el.tagName.toLowerCase();
      const role = getSemanticRole(el);
      const name = computeAccessibleName(el);
      const states = getElementStates(el);
      const rect = el.getBoundingClientRect();

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
      // Handle collisions: append -1, -2, etc.
      if (eidCounts[eid] === undefined) {
        eidCounts[eid] = 0;
      } else {
        eidCounts[eid]++;
        eid = `${eid}-${eidCounts[eid]}`;
      }

      // CSS selector (use content.js uniqueSelector if available)
      let selector = "";
      if (typeof uniqueSelector === "function") {
        try {
          selector = uniqueSelector(el);
        } catch {
          selector = buildBasicSelector(el);
        }
      } else {
        selector = buildBasicSelector(el);
      }

      elements.push({
        eid,
        tag,
        role,
        name,
        value,
        description,
        states,
        selector,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        },
        parent_context: getParentContext(el)
      });
    }

    const tree_summary = buildTreeSummary();

    return {
      mode: "dom_fallback",
      tree_summary,
      interactive_elements: elements,
      element_count: elements.length
    };
  }

  // ── Basic selector fallback (when content.js uniqueSelector not available) ──
  function buildBasicSelector(el) {
    const tag = el.tagName.toLowerCase();

    // id
    if (el.id) {
      try {
        const sel = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    // name
    const name = el.getAttribute("name");
    if (name) {
      try {
        const sel = `${tag}[name="${CSS.escape(name)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    // aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      try {
        const sel = `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch { /* skip */ }
    }

    // nth-of-type from parent
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
  // Recomputes the snapshot and finds the element with matching eid
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
        sendResponse({ mode: "dom_fallback", tree_summary: "", interactive_elements: [], element_count: 0, error: e.message });
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

  console.log("[ax-extract] installed");
}
