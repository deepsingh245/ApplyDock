// Minimal Chrome DevTools Protocol driver using Node 22+'s built-in WebSocket (no npm packages).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(HERE, "output");   // screenshots (git-ignored)
const PORT = Number(process.env.CDP_PORT || 9333);

export function findChrome() {
  const candidates = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return candidates.find(path => path && existsSync(path)) || null;
}

export async function launch() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "applydock-ui-"));
  const proc = spawn(findChrome(), ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
    "--disable-gpu", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    // UI_DEBUG=1 prints errors and page navigations as they happen, to locate where a flow went wrong.
    if (process.env.UI_DEBUG && (msg.method === "Runtime.exceptionThrown" || msg.method === "Page.frameNavigated"))
      console.log("[debug]", msg.method, msg.method === "Page.frameNavigated" ? msg.params.frame.url : msg.params.exceptionDetails.exception?.description?.split("\n")[0]);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const api = {
    send, consoleErrors,
    async eval(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    // Wait for the new document to finish loading (a fixed delay let a slow first load overlap the next navigation).
    async goto(url) {
      await send("Page.navigate", { url });
      // Evaluating while the old document is torn down throws ("context destroyed"); keep polling through that.
      const ready = `document.readyState === "complete" && location.href.startsWith(${JSON.stringify(url.split("#")[0])})`;
      for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
        await api.sleep(150);
        if (await api.eval(ready).catch(() => false)) break;
      }
      await api.sleep(300);
    },
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    async waitFor(expression, timeout = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (await api.eval(expression)) return true; await api.sleep(250); }
      throw new Error("Timed out waiting for: " + expression);
    },
    async size(width, height, mobile = false) { await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }); },
    async shot(name, fullPage = false) {
      const params = { format: "png" };
      if (fullPage) {
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 4000), scale: 1 };
        params.captureBeyondViewport = true;
      }
      const { data } = await send("Page.captureScreenshot", params);
      writeFileSync(join(OUT, name + ".png"), Buffer.from(data, "base64"));
    },
    async click(selector) { const ok = await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`); if (!ok) throw new Error("No element: " + selector); },
    close() { ws.close(); proc.kill(); },
  };
  return api;
}
