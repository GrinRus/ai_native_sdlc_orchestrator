import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedNodeVersion,
  nodeVersionSatisfiesRequiredRange,
  SUPPORTED_NODE_ENGINE,
  unsupportedNodeVersionMessage,
} from "../src/node-runtime.mjs";
import { inspectReadiness } from "../src/operator-cli/command-handlers/guided.mjs";

test("runtime contract accepts only the certified Node 22 and Node 26 majors", () => {
  assert.equal(SUPPORTED_NODE_ENGINE, ">=22 <23 || >=26 <27");
  for (const version of ["22.0.0", "22.22.3", "26.0.0", "26.8.2"]) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
  for (const version of ["21.9.0", "23.0.0", "25.9.0", "27.0.0", "not-a-version"]) {
    assert.equal(isSupportedNodeVersion(version), false, version);
  }
  assert.equal(nodeVersionSatisfiesRequiredRange("26.8.2", ">=26 <27"), true);
});

test("guided doctor reports an actionable blocker instead of a false ready state", () => {
  const readiness = inspectReadiness("/tmp/aor-runtime-test-project", "/tmp/aor-runtime-test-home", "25.9.0");
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.blockers[0].code, "node-version-unsupported");
  assert.match(readiness.blockers[0].summary, /22\.x or 26\.x/u);
  assert.match(readiness.blockers[0].next_command, /Install Node\.js 22\.x or 26\.x/u);
});

test("unsupported runtime message names the cause and recovery", () => {
  assert.match(unsupportedNodeVersionMessage("v25.9.0"), /cannot run on Node\.js v25\.9\.0/u);
  assert.match(unsupportedNodeVersionMessage("v25.9.0"), />=22 <23 \|\| >=26 <27/u);
});
