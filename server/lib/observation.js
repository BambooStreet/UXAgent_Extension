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
 * Prioritizes: disabled=false, elements with names, higher z-index position.
 */
function pruneForPrompt(elements, topK = 50) {
  if (!elements || elements.length <= topK) return elements || [];

  // Score each element for relevance
  const scored = elements.map((el, idx) => {
    let score = 0;
    // Penalize disabled
    if (el.states?.disabled) score -= 10;
    // Boost elements with accessible names
    if (el.name) score += 3;
    // Boost form controls
    if (["textbox", "searchbox", "combobox", "checkbox", "radio"].includes(el.role)) score += 2;
    // Boost buttons
    if (el.role === "button") score += 1;
    // Preserve document order bias (earlier = slightly higher)
    score -= idx * 0.01;
    return { el, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.el);
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
