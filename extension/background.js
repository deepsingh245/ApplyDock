chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "capture-link",
    title: "Review this job or hiring link",
    contexts: ["link"],
    targetUrlPatterns: ["https://*/*"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "capture-link" || !info.linkUrl?.startsWith("https://")) return;
  if (tab?.windowId) chrome.sidePanel.open({windowId: tab.windowId}).catch(() => {});
  const pendingCapture = {
    url: info.linkUrl,
    title: info.selectionText || "",
    kind: /\/posts?\/|\/feed\/update\//i.test(info.linkUrl) ? "post" : "job"
  };
  await chrome.storage.session.set({pendingCapture});
  chrome.runtime.sendMessage({type: "review-link", pendingCapture}).catch(() => {});
});
