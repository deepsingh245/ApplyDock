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

// ---- WhatsApp outreach sender -------------------------------------------------------------------------------
// Every minute, ask the local helper for a due outreach message. The helper paces messages, caps a day, and never
// hands out missed ones. We open the chat in WhatsApp Web (the user's own logged-in session), the content script
// attaches the pinned resume with the message, and presses Send only if the user opted that message in.
const HELPER = "http://127.0.0.1:8765";
const WHATSAPP = "https://web.whatsapp.com/";
const BUSY_MS = 3 * 60 * 1000;
// Parked for later (see docs/whatsapp-outreach/NEXT_STEPS.md): the sender is built but untested against a live
// WhatsApp Web session, so it stays off until this is switched on deliberately.
const OUTREACH_SENDER_ENABLED = false;

if (OUTREACH_SENDER_ENABLED) {
  chrome.alarms.create("outreach-poll", {periodInMinutes: 1});
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "outreach-poll") pollOutreach().catch(() => {}); });
} else {
  chrome.alarms.clear("outreach-poll");
}

async function helperPost(path, body) {
  const {pairingKey} = await chrome.storage.local.get("pairingKey");
  if (!pairingKey) throw new Error("not paired");
  const response = await fetch(HELPER + path, {method: "POST", headers: {"X-Local-Key": pairingKey, "Content-Type": "application/json"}, body: JSON.stringify(body || {})});
  if (!response.ok) throw new Error(`helper ${response.status}`);
  return response.json();
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function waitForReload(tabId) {
  return new Promise(resolve => {
    let started = false;
    const finish = () => { chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") started = true;
      if (info.status === "complete" && started) finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, 45000);
  });
}

async function setBusy(until) { await chrome.storage.session.set({outreachBusyUntil: until}); }

async function pollOutreach() {
  const {outreachBusyUntil = 0} = await chrome.storage.session.get("outreachBusyUntil");
  if (outreachBusyUntil > Date.now()) return;
  const {item} = await helperPost("/api/outreach/extension/claim");
  if (!item) return;
  await setBusy(Date.now() + BUSY_MS);
  const fail = async detail => { await helperPost("/api/outreach/extension/report", {id: item.id, outcome: "failed", detail}).catch(() => {}); await setBusy(0); };
  let fileBase64 = "";
  try {
    const file = await fetch(item.resume_file_url);
    if (!file.ok) throw new Error("file");
    fileBase64 = toBase64(await file.arrayBuffer());
  } catch { return fail("The resume file could not be loaded."); }

  const url = `${WHATSAPP}send?phone=${encodeURIComponent(item.phone.replace(/\D/g, ""))}`;
  const [existing] = await chrome.tabs.query({url: WHATSAPP + "*"});
  let tab;
  if (existing) {
    // The old page's script would still answer; wait for the navigation to /send to finish before handing over the job.
    const loaded = waitForReload(existing.id);
    tab = await chrome.tabs.update(existing.id, {url, active: true});
    await loaded;
  } else tab = await chrome.tabs.create({url, active: true});
  const job = {id: item.id, message: item.message, autoSend: item.auto_send, filename: item.resume_filename, fileBase64};
  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {type: "outreach-job", job});
      if (reply?.ok) return;
    } catch { /* the page is still loading */ }
  }
  await fail("WhatsApp Web did not load. Check that it is logged in.");
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== "outreach-result") return false;
  helperPost("/api/outreach/extension/report", {id: message.id, outcome: message.outcome, detail: message.detail}).catch(() => {}).finally(() => setBusy(0));
  return false;
});
