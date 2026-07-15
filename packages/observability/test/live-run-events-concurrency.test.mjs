import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { acquireFileLock, appendLiveRunEvent, listLiveRunEvents, releaseFileLock } from "../src/index.mjs";

const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;

function runWorker(logFile, worker, count) {
  const source = `
    const { appendLiveRunEvent } = await import(process.argv[1]);
    const logFile = process.argv[2];
    const worker = Number(process.argv[3]);
    const count = Number(process.argv[4]);
    for (let index = 0; index < count; index += 1) {
      appendLiveRunEvent({
        logFile,
        runId: "run.concurrent.events",
        eventType: "step.updated",
        requestKey: \`worker-\${worker}-event-\${index}\`,
        payload: { worker, index },
      });
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source, moduleUrl, logFile, String(worker), String(count)], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker ${worker} exited ${code}: ${stderr}`)));
  });
}

test("event append assigns 1000 unique monotonic identities across processes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-event-concurrency-"));
  try {
    const logFile = path.join(root, "events.ndjson");
    await Promise.all(Array.from({ length: 10 }, (_, worker) => runWorker(logFile, worker, 100)));
    const events = listLiveRunEvents({ logFile, runId: "run.concurrent.events" });
    assert.equal(events.length, 1000);
    assert.equal(new Set(events.map((event) => event.event_id)).size, 1000);
    assert.deepEqual(events.map((event) => event.payload.sequence), Array.from({ length: 1000 }, (_, index) => index + 1));
    const cursor = JSON.parse(fs.readFileSync(`${logFile}.cursor.json`, "utf8"));
    assert.equal(cursor.sequence, 1000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("request keys are idempotent and stale owner-less locks are recovered", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-event-idempotency-"));
  try {
    const logFile = path.join(root, "events.ndjson");
    const input = { logFile, runId: "run.idempotent.events", eventType: "warning.raised", requestKey: "request.same", payload: { code: "retry" } };
    const first = appendLiveRunEvent(input);
    const retry = appendLiveRunEvent(input);
    assert.deepEqual(retry, first);
    assert.equal(listLiveRunEvents({ logFile }).length, 1);
    assert.throws(() => appendLiveRunEvent({ ...input, payload: { code: "changed" } }), { code: "event-request-conflict" });

    const lockDirectory = path.join(root, "stale.lock");
    fs.mkdirSync(lockDirectory);
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(lockDirectory, past, past);
    const lock = acquireFileLock(lockDirectory, { staleAfterMs: 1, timeoutMs: 100 });
    releaseFileLock(lock);
    assert.equal(fs.existsSync(lockDirectory), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
