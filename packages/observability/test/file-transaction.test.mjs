import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  readJsonState,
  updateJsonState,
  writeJsonAtomic,
} from "../src/index.mjs";

const moduleUrl = new URL("../src/index.mjs", import.meta.url).href;

function runCounterWorker(file, count) {
  const source = `
    const { updateJsonState } = await import(process.argv[1]);
    const file = process.argv[2];
    for (let i = 0; i < Number(process.argv[3]); i += 1) {
      updateJsonState(file, current => ({ ...current, count: Number(current?.count ?? 0) + 1 }));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source, moduleUrl, file, String(count)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)));
  });
}

test("state transactions fence revisions and preserve the complete document", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-state-transaction-"));
  try {
    const file = path.join(root, "state.json");
    writeJsonAtomic(file, { revision: 1, status: "running", operator: { paused: false } });
    const next = updateJsonState(file, (current) => ({ ...current, status: "paused" }), { expectedRevision: 1 });
    assert.equal(next.revision, 2);
    assert.equal(next.status, "paused");
    assert.deepEqual(next.operator, { paused: false });
    assert.throws(() => updateJsonState(file, (current) => current, { expectedRevision: 1 }), (error) => error.code === "state-revision-conflict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt state is quarantined and never treated as an empty object", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-state-corrupt-"));
  try {
    const file = path.join(root, "state.json");
    fs.writeFileSync(file, "{not-json\n", "utf8");
    assert.throws(() => readJsonState(file), (error) => error.code === "state-corrupt" && error.state_file === file && typeof error.recovery_ref === "string");
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readdirSync(root).filter((entry) => entry.includes(".corrupt-")).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("multi-process state transitions have one ordered owner and no lost updates", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-state-stress-"));
  try {
    const file = path.join(root, "state.json");
    writeJsonAtomic(file, { revision: 0, count: 0 });
    await Promise.all(Array.from({ length: 6 }, () => runCounterWorker(file, 25)));
    const state = readJsonState(file);
    assert.equal(state.count, 150);
    assert.equal(state.revision, 150);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("atomic state writes leave the previous version recoverable at crash boundaries", () => {
  for (const boundary of ["before-write", "after-write", "before-rename", "after-rename"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `aor-state-fault-${boundary}-`));
    try {
      const file = path.join(root, "state.json");
      writeJsonAtomic(file, { revision: 1, status: "old" });
      assert.throws(
        () => updateJsonState(file, (current) => ({ ...current, status: "new" }), { faultInjectionBoundary: boundary }),
        (error) => error.code === "state-transaction-fault-injected" && error.boundary === boundary,
      );
      if (boundary === "after-rename") assert.equal(readJsonState(file).status, "new");
      else assert.equal(readJsonState(file).status, "old");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
