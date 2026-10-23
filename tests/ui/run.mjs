// Browser end-to-end tests. Usage: node tests/ui/run.mjs
// Each flow gets a fresh sandbox (temporary data folder, fake Codex) on port 8799; your data/ is never used.
// Requires Python with requirements.txt installed and Chrome or Edge (set CHROME=... to override the path).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./cdp.mjs";

const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORT = Number(process.env.UI_PORT || 8799);
const FLOWS = ["flow-resume-workflow.mjs", "flow-design-and-tabs.mjs", "flow-master-profile.mjs"];
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("sandbox did not start");
}

function run(command, args, env) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", code => resolve(code ?? 1));
  });
}

if (!findChrome()) {
  console.log("SKIPPED: Chrome or Edge not found (set CHROME to its path).");
  process.exit(0);
}
let failures = 0;
for (const flow of FLOWS) {
  const dataDir = mkdtempSync(join(tmpdir(), "applydock-sandbox-"));
  const sandbox = spawn(python, [join(HERE, "sandbox.py"), dataDir, String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/`);
    console.log(`\n== ${flow}`);
    const code = await run(process.execPath, [join(HERE, flow)], { UI_BASE: `http://127.0.0.1:${PORT}/` });
    if (code !== 0) failures++;
  } catch (error) {
    console.error(`${flow}: ${error.message}`);
    failures++;
  } finally {
    sandbox.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    rmSync(dataDir, { recursive: true, force: true });
  }
}
console.log(failures ? `\n${failures} UI flow(s) failed` : "\nAll UI flows passed");
process.exit(failures ? 1 : 0);
