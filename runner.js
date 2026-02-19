// runner.js — 동적 주입 content script
// background.js가 chrome.scripting.executeScript로 주입한 뒤
// chrome.tabs.sendMessage({ kind: "RUN_PLAN", plan }) 로 실행 요청

if (!window.__uxAgentRunnerInstalled) {
  window.__uxAgentRunnerInstalled = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.kind !== "RUN_PLAN") return false;

    const plan = msg.plan;
    console.log("[runner] RUN_PLAN received:", plan);

    try {
      const result = executePlan(plan);
      sendResponse(result);
    } catch (e) {
      console.error("[runner] execution error:", e);
      sendResponse({ success: false, error: e?.message || String(e) });
    }

    return false; // 동기 응답
  });

  function executePlan(plan) {
    switch (plan.action) {
      case "click":
        return doClick(plan.selector);
      case "type":
        return doType(plan.selector, plan.value);
      case "scroll":
        return doScroll(plan.x, plan.y);
      case "select":
        return doSelect(plan.selector, plan.value);
      case "hover":
        return doHover(plan.selector);
      default:
        return { success: false, error: `알 수 없는 action: ${plan.action}` };
    }
  }

  function findElement(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      console.warn(`[runner] invalid selector: ${selector}`, e);
      return null;
    }
  }

  function doClick(selector) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector}` };

    // 요소가 뷰포트에 보이도록 스크롤
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // 약간의 딜레이 후에도 클릭이 필요할 수 있으므로 바로 클릭
    el.click();
    return { success: true, log: `클릭 완료: ${selector} (label: "${(el.textContent || '').trim().slice(0, 50)}")` };
  }

  function doType(selector, value) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector}` };

    el.focus();
    // 기존 값 초기화 후 새 값 설정
    el.value = "";
    el.value = value || "";

    // React/Vue 등 프레임워크 호환을 위해 다양한 이벤트 발생
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, log: `입력 완료: ${selector} → "${value}"` };
  }

  function doScroll(x, y) {
    window.scrollBy(x || 0, y || 0);
    return { success: true, log: `스크롤 완료: (${x || 0}, ${y || 0})` };
  }

  function doSelect(selector, value) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector}` };

    el.value = value || "";
    el.dispatchEvent(new Event("change", { bubbles: true }));

    return { success: true, log: `선택 완료: ${selector} → "${value}"` };
  }

  function doHover(selector) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector}` };

    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    return { success: true, log: `호버 완료: ${selector}` };
  }
}
