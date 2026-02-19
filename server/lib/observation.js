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
      mode: axData?.mode || "dom_fallback",
      tree_summary: axData?.tree_summary || "",
      interactive_elements: axData?.interactive_elements || []
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
 * Classification uses HTML5/ARIA landmarks — no site-specific patterns or coordinates.
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
 * Example: [e-abc123] button "Add to cart" disabled=false (340,520)
 */
function formatElementForPrompt(el) {
  const parts = [`[${el.eid}]`];
  parts.push(el.tag);
  if (el.role && el.role !== el.tag) parts.push(`role=${el.role}`);
  if (el.name) parts.push(`"${el.name.slice(0, 60)}"`);
  if (el.value) parts.push(`value="${el.value.slice(0, 40)}"`);

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

  // Landmark region
  if (el.landmark) parts.push(`@${el.landmark}`);

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
