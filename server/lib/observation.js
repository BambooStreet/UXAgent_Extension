// server/lib/observation.js — Observation assembly + prompt formatting

/**
 * Build the full observation object from capture data.
 */
function buildObservation({ step, page, lastAction, axData, errors }) {
  return {
    step,
    ts: new Date().toISOString(),
    page: {
      url: page.url,
      title: page.title
    },
    last_action: lastAction || null,
    ax: {
      obsVersion: axData?.obsVersion || 1,
      mode: axData?.mode || "dom_fallback",
      tree_summary: axData?.tree_summary || "",
      interactive_elements: axData?.interactive_elements || [],
      activeLayer: axData?.activeLayer || { present: false, type: null, rootBlockId: null },
      blocks: axData?.blocks || [],
      overlayTexts: axData?.overlayTexts || []
    },
    errors: errors || [],
    artifacts: {
      ax_json_path: null,
      dom_html_path: null,
      screenshot_path: null
    }
  };
}

/**
 * Select top K elements for prompt inclusion.
 * 3-tier strategy: chrome → filter → main content
 * When activeLayer is present, modal-inside elements get absolute priority.
 */

// ── Tier classification (landmark-based) ──

function classifyElement(el) {
  const lm = el.landmark || "";

  // Chrome: page-level navigation, banner (header), contentinfo (footer)
  if (lm === "navigation" || lm === "banner" || lm === "contentinfo") return "chrome";

  // Filter: complementary content (aside/sidebar)
  if (lm === "complementary") return "filter";

  // Main: main content, search regions, or elements without landmark
  return "main";
}

function scoreElement(el, idx) {
  let score = 0;
  if (el.states?.disabled) score -= 10;
  if (el.name) score += 3;
  if (["textbox", "searchbox", "combobox"].includes(el.role)) score += 2;
  if (el.role === "button") score += 1;
  // Document order bias
  score -= idx * 0.01;
  return score;
}

function pruneForPrompt(elements, topK = 50) {
  if (!elements || elements.length <= topK) return elements || [];

  // Separate modal-inside vs background elements
  const modalElements = elements.filter(el => el.inActiveLayer);
  const bgElements = elements.filter(el => !el.inActiveLayer);

  // If there's an active layer, modal elements get priority slots
  if (modalElements.length > 0) {
    const modalSlots = Math.min(modalElements.length, Math.ceil(topK * 0.7));
    const bgSlots = topK - modalSlots;

    const prunedModal = pruneGroup(modalElements, modalSlots);
    const prunedBg = pruneGroup(bgElements, bgSlots);
    return [...prunedModal, ...prunedBg];
  }

  return pruneGroup(elements, topK);
}

function pruneGroup(elements, topK) {
  if (!elements || elements.length <= topK) return elements || [];

  const buckets = { chrome: [], filter: [], main: [] };

  elements.forEach((el, idx) => {
    const score = scoreElement(el, idx);
    const tier = classifyElement(el);
    buckets[tier].push({ el, score });
  });

  // Sort each bucket by score
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => b.score - a.score);
  }

  // Slot allocation: main gets priority, chrome/filter get capped
  const chromeMax = 8;
  const filterMax = 7;
  const chromeSlots = Math.min(chromeMax, buckets.chrome.length);
  const filterSlots = Math.min(filterMax, buckets.filter.length);
  const mainSlots = topK - chromeSlots - filterSlots;

  const result = [
    ...buckets.main.slice(0, mainSlots).map(s => s.el),
    ...buckets.filter.slice(0, filterSlots).map(s => s.el),
    ...buckets.chrome.slice(0, chromeSlots).map(s => s.el)
  ];

  return result;
}

/**
 * Format a single element for prompt inclusion (one-line).
 * Example: [e-abc123] button "Add to cart" disabled=false (340,520) @modal > "옵션 선택"
 */
function formatElementForPrompt(el) {
  const parts = [`[${el.eid}]`];
  parts.push(el.tag);
  if (el.role && el.role !== el.tag) parts.push(`role=${el.role}`);
  if (el.name) parts.push(`"${el.name.slice(0, 60)}"`);
  if (el.value) parts.push(`value="${el.value.slice(0, 40)}"`);

  // Label source (only if not innerText/unknown — those are obvious)
  if (el.labelSource && !["innerText", "unknown"].includes(el.labelSource)) {
    parts.push(`src=${el.labelSource}`);
  }

  // Key states
  const statesParts = [];
  if (el.states) {
    if (el.states.disabled) statesParts.push("disabled");
    if (el.states.checked) statesParts.push("checked");
    if (el.states.expanded === true) statesParts.push("expanded");
    if (el.states.expanded === false) statesParts.push("collapsed");
    if (el.states.required) statesParts.push("required");
    if (el.states.readonly) statesParts.push("readonly");
  }
  if (statesParts.length > 0) parts.push(`[${statesParts.join(",")}]`);

  // Position
  if (el.rect) parts.push(`(${el.rect.x},${el.rect.y})`);

  // Breadcrumbs (block hierarchy)
  if (el.breadcrumbs && el.breadcrumbs.length > 0) {
    parts.push(`@${el.breadcrumbs.join(" > ")}`);
  } else if (el.landmark) {
    // Fallback to landmark if no breadcrumbs
    parts.push(`@${el.landmark}`);
  }

  // Active layer marker
  if (el.inActiveLayer) parts.push("[MODAL]");

  // Parent context
  if (el.parent_context) parts.push(`in:${el.parent_context}`);

  return parts.join(" ");
}

/**
 * Format tree summary for prompt.
 */
function formatTreeSummaryForPrompt(summary) {
  return summary || "(no tree summary)";
}

module.exports = {
  buildObservation,
  pruneForPrompt,
  formatElementForPrompt,
  formatTreeSummaryForPrompt
};
