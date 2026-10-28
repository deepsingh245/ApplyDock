// Starts tests/ui/sandbox.py: the real helper on temporary data with a fake Codex and a seeded master resume
// plus one analyzed application (Initech). Never touches the real data/ folder.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const SANDBOX_KEY = "sandbox-key";

export interface Sandbox {
  base: string;
  origin: string;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("no port"))));
    });
  });
}

async function waitForReady(url: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`sandbox exited (${child.exitCode}):\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`sandbox did not start:\n${output()}`);
}

export async function startSandbox(): Promise<Sandbox> {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "applydock-e2e-"));
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python3");
  const args = [...(process.platform === "win32" && !process.env.PYTHON ? ["-3"] : []), join(repo, "tests", "ui", "sandbox.py"), dataDir, String(port)];
  const child = spawn(python, args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  let log = "";
  child.stdout?.on("data", (chunk) => (log = (log + chunk).slice(-4000)));
  child.stderr?.on("data", (chunk) => (log = (log + chunk).slice(-4000)));
  const origin = `http://127.0.0.1:${port}`;
  await waitForReady(`${origin}/`, child, () => log);
  return {
    base: origin,
    origin,
    stop: async () => {
      const exited = new Promise((done) => (child.exitCode !== null ? done(null) : child.once("exit", done)));
      // On Windows `py` is a launcher: killing it leaves the real Python server running (and holding the database).
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill();
      await exited;
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        // A lingering file handle only leaves a temp folder behind; it says nothing about the app under test.
      }
    },
  };
}
