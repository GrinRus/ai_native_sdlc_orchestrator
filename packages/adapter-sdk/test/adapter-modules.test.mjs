import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSemanticEvents } from "../src/evidence-normalization.mjs";
import { isSupportedRequestTransport, resolveRequestTransport } from "../src/packet-transport.mjs";
import { runSupervisedProcessSync } from "../src/supervisor.mjs";

test("packet transport remains provider-neutral and fail-closed", () => {
  assert.equal(resolveRequestTransport({}, true), "stdin-json");
  assert.equal(resolveRequestTransport({ request_transport: "request-artifact" }, false), "request-artifact");
  assert.equal(isSupportedRequestTransport("file-attachment"), true);
  assert.equal(isSupportedRequestTransport("shell-eval"), false);
});

test("evidence normalization preserves structured provider semantics", () => {
  assert.deepEqual(normalizeSemanticEvents({ failure_kind: "edit-denied" }, "blocked"), [
    { event_type: "permission-denial", status: "blocked", failure_kind: "edit-denied" },
  ]);
  const explicit = [{ event_type: "provider.progress", status: "running" }];
  assert.deepEqual(normalizeSemanticEvents({ semantic_events: explicit }, "success"), explicit);
});

test("supervisor boundary normalizes a child result without adapter vocabulary", () => {
  const source = "process.stdout.write(JSON.stringify({status:0,signal:null,stdout:'ok',stderr:'',provider_progress_events:[]}));";
  const result = runSupervisedProcessSync({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    cwd: process.cwd(),
    env: process.env,
    input: "",
    timeout: 1000,
    maxBuffer: 1024 * 1024,
    supervisorSource: source,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.error, null);
});
