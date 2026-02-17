chrome.runtime.onInstalled.addListener(() => {
  // sidePanel 권한/지원 여부가 없는 환경에서도 안 죽게 방어
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(console.error);
  } else {
    console.log("sidePanel API not available (permission missing or unsupported Chrome).");
  }
});

// AI 호출 및 스크린샷 로직은 서버로 이동됨
// 이제 background.js는 sidepanel 초기화만 담당
