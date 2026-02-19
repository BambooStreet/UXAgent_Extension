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
        return doType(plan.selector, plan.value, plan.pressEnter);
      case "scroll":
        return doScroll(plan.x, plan.y);
      case "select":
        return doSelect(plan.selector, plan.value);
      case "hover":
        return doHover(plan.selector);
      case "press_enter":
        return doPressEnter(plan.selector);
      case "keypress":
        return doKeypress(plan.key, plan.selector);
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

  function doType(selector, value, pressEnter) {
    const el = findElement(selector);
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector}` };

    el.focus();
    // 기존 값 초기화 후 새 값 설정
    el.value = "";
    el.value = value || "";

    // React/Vue 등 프레임워크 호환을 위해 다양한 이벤트 발생
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // pressEnter 옵션: 입력 후 바로 Enter 키 전송
    if (pressEnter) {
      dispatchKey(el, "Enter", 13);
    }

    const enterLog = pressEnter ? " + Enter" : "";
    return { success: true, log: `입력 완료: ${selector} → "${value}"${enterLog}` };
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

  // ── 키보드 이벤트 헬퍼 ──
  const KEY_MAP = {
    Enter:     { code: "Enter",      keyCode: 13 },
    Tab:       { code: "Tab",        keyCode: 9 },
    Escape:    { code: "Escape",     keyCode: 27 },
    ArrowUp:   { code: "ArrowUp",    keyCode: 38 },
    ArrowDown: { code: "ArrowDown",  keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft",  keyCode: 37 },
    ArrowRight:{ code: "ArrowRight", keyCode: 39 },
    Backspace: { code: "Backspace",  keyCode: 8 },
    Space:     { code: "Space",      keyCode: 32, key: " " },
    Delete:    { code: "Delete",     keyCode: 46 }
  };

  function dispatchKey(el, key, keyCode) {
    const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));

    // Enter인 경우 가장 가까운 form 제출도 시도
    if (key === "Enter") {
      const form = el.closest("form");
      if (form) {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }
  }

  function doPressEnter(selector) {
    const el = selector ? findElement(selector) : document.activeElement;
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector || "(activeElement)"}` };

    el.focus();
    dispatchKey(el, "Enter", 13);
    return { success: true, log: `Enter 키 전송 완료: ${selector || "(activeElement)"}` };
  }

  function doKeypress(key, selector) {
    if (!key) return { success: false, error: "key가 지정되지 않았습니다." };

    const el = selector ? findElement(selector) : document.activeElement;
    if (!el) return { success: false, error: `요소를 찾을 수 없음: ${selector || "(activeElement)"}` };

    el.focus();

    const mapped = KEY_MAP[key];
    const actualKey = mapped?.key || key;
    const code = mapped?.code || key;
    const keyCode = mapped?.keyCode || 0;

    const opts = { key: actualKey, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));

    return { success: true, log: `키 전송 완료: ${key} → ${selector || "(activeElement)"}` };
  }
}
