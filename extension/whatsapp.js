// Runs on web.whatsapp.com. Given a job from background.js, it attaches the pinned resume to the open chat with the
// message as its caption and, only when the user opted this message into auto-send, presses Send and verifies delivery.
// WhatsApp changes its markup without notice, so every lookup tries several selectors and failures are reported
// (never swallowed): the background script passes them on and the message stays in the user's queue.
(() => {
  if (window.__applydockOutreach) return;
  window.__applydockOutreach = true;

  const SELECTORS = {
    composer: ['footer div[contenteditable="true"]', '#main footer [contenteditable="true"]'],
    attach: ['[data-icon="plus-rounded"]', '[data-icon="attach-menu-plus"]', '[data-icon="clip"]', '[aria-label="Attach"]'],
    send: ['[data-icon="send"]', '[data-icon="wds-ic-send-filled"]', '[aria-label="Send"]'],
    ticks: '[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-icon="msg-dblcheck-light"]'
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const human = (min = 1200, max = 3200) => sleep(min + Math.random() * (max - min));
  const first = list => { for (const selector of list) { const found = document.querySelector(selector); if (found) return found; } return null; };
  const clickable = element => element.closest('button,[role="button"]') || element;

  async function waitFor(find, timeout, what) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = find();
      if (value) return value;
      await sleep(400);
    }
    throw new Error(`Could not find ${what} on WhatsApp Web.`);
  }

  function invalidNumberNotice() {
    for (const dialog of document.querySelectorAll('[role="dialog"], [data-animate-modal-popup="true"]')) {
      if (/invalid|not on whatsapp|isn.t on whatsapp|not registered/i.test(dialog.textContent || "")) return true;
    }
    return false;
  }

  function banner(text) {
    let element = document.getElementById("applydock-outreach-banner");
    if (!element) {
      element = document.createElement("div");
      element.id = "applydock-outreach-banner";
      element.style.cssText = "position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;padding:6px 14px;background:#0f766e;color:#fff;font:600 13px system-ui;border-radius:0 0 6px 6px";
      document.body.append(element);
    }
    element.textContent = text;
    return element;
  }

  function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function documentInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return inputs.find(input => input.accept === "*") || inputs.find(input => !/image|video/i.test(input.accept || "")) || null;
  }

  function captionBox() {
    const boxes = [...document.querySelectorAll('div[contenteditable="true"]')].filter(box => !box.closest("footer"));
    return boxes.find(box => /caption/i.test(box.getAttribute("aria-label") || "")) || boxes[0] || null;
  }

  function type(box, text) {
    box.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text);
    if (!(box.textContent || "").includes(text.slice(0, 20))) {
      box.textContent = text;
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  async function run(job) {
    const status = banner("ApplyDock is preparing your WhatsApp message…");
    let composer = null;
    try {
      composer = await waitFor(() => (invalidNumberNotice() ? (() => { throw new Error("WhatsApp says this number is invalid or not on WhatsApp."); })() : first(SELECTORS.composer)), 60000, "the chat (is WhatsApp Web logged in?)");
      await human();

      clickable(await waitFor(() => first(SELECTORS.attach), 15000, "the attach button")).click();
      const input = await waitFor(documentInput, 15000, "the document upload field");
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytesFromBase64(job.fileBase64)], job.filename || "resume.pdf", { type: "application/pdf" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));

      type(await waitFor(captionBox, 20000, "the caption box"), job.message);
      const sendButton = await waitFor(() => { const button = first(SELECTORS.send); return button && !button.closest("footer") ? button : first(SELECTORS.send); }, 15000, "the Send button");

      if (!job.autoSend) {
        status.textContent = "ApplyDock attached your resume. Press Send, then confirm in ApplyDock.";
        return { outcome: "attached" };
      }
      status.textContent = "ApplyDock is sending…";
      const before = document.querySelectorAll(SELECTORS.ticks).length;
      await human(1500, 3500);
      clickable(sendButton).click();
      const end = Date.now() + 45000;
      while (Date.now() < end) {
        if (document.querySelectorAll(SELECTORS.ticks).length > before) return { outcome: "sent" };
        await sleep(700);
      }
      return { outcome: "unverified" };
    } catch (error) {
      // Leave the message in the composer so the user can finish by hand.
      try { if (composer) type(composer, job.message); } catch { /* best effort */ }
      return { outcome: "failed", detail: error.message };
    } finally {
      setTimeout(() => status.remove(), 6000);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "outreach-job") return false;
    respond({ ok: true });
    run(message.job).then(result => chrome.runtime.sendMessage({ type: "outreach-result", id: message.job.id, ...result }));
    return false;
  });
})();
