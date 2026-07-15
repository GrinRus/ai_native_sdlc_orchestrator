import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const moduleUrl = new URL("../src/attempt-store.mjs", import.meta.url).href;

function worker(stateRoot, workerId) {
  const source = `
    const { reserveStepAttempt } = await import(process.argv[1]);
    for (let index = 0; index < 5; index += 1) {
      reserveStepAttempt({ stateRoot: process.argv[2], runId: "run.concurrent.attempts", stepId: "step.concurrent", stepClass: "implement", requestKey: \`worker-\${process.argv[3]}-request-\${index}\` });
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source, moduleUrl, stateRoot, String(workerId)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`attempt worker ${workerId} exited ${code}: ${stderr}`)));
  });
}

test("parallel attempt reservations never reuse or overwrite an attempt number", async () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-attempt-concurrency-"));
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => worker(stateRoot, index)));
    const files = fs.readdirSync(path.join(stateRoot, "step-attempts")).filter((entry) => entry.endsWith(".json"));
    assert.equal(files.length, 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(stateRoot, "step-attempts", files[0]), "utf8"));
    const attempts = Object.values(ledger.requests).map((entry) => entry.attempt);
    assert.equal(attempts.length, 100);
    assert.equal(new Set(attempts).size, 100);
    assert.deepEqual([...attempts].sort((a, b) => a - b), Array.from({ length: 100 }, (_, index) => index + 1));
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
