// Zero-dependency contract check (mirrors the run_all.gd non-zero-exit
// convention): spawns `npm run serve` on an ephemeral port, asserts
// GET /health returns {"status":"ok"} and GET / contains #ui + <canvas>,
// then kills the child. Any failed assertion exits non-zero with the
// reason on stderr.

import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = "8931";
const HOST = "127.0.0.1";
const TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 250;

function fail(reason, child) {
  console.error(`smoke: ${reason}`);
  child.kill("SIGKILL");
  process.exit(1);
}

async function waitForHealth(child) {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/health`);
      const body = await res.text();
      if (res.status === 200 && body.includes('{"status":"ok"}')) {
        return;
      }
    } catch {
      // Server not up yet; keep polling.
    }
    if (Date.now() > deadline) {
      fail(`/health did not return {"status":"ok"} within ${TIMEOUT_MS}ms`, child);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function main() {
  const child = spawn(
    "npm",
    ["run", "serve", "--", "--port", PORT, "--host", HOST, "--strictPort"],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  child.on("error", (err) => {
    console.error(`smoke: failed to spawn serve: ${err.message}`);
    process.exit(1);
  });

  await waitForHealth(child);

  const pageRes = await fetch(`http://${HOST}:${PORT}/`);
  const page = await pageRes.text();
  if (pageRes.status !== 200) {
    fail(`GET / returned status ${pageRes.status}, expected 200`, child);
  }
  if (!page.includes('id="ui"')) {
    fail('GET / body does not contain id="ui"', child);
  }
  if (!page.includes("<canvas")) {
    fail("GET / body does not contain <canvas>", child);
  }

  console.log("smoke: ok");
  child.kill("SIGKILL");
  await once(child, "exit").catch(() => undefined);
  process.exit(0);
}

await main();
