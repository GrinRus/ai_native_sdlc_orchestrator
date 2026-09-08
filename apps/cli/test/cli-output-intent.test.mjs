import assert from "node:assert/strict";
import test from "node:test";

import { buildCliOutput } from "../src/cli-output.mjs";

test("CLI preserves intent-first task prepare and start payloads", () => {
  const output = buildCliOutput({
    command: "task prepare",
    resolvedFamilies: [],
    state: {
      intentSubmission: { submission_id: "submission.test", status: "prepared", revision: 1 },
      statusRef: "intent-submission://submission.test",
      intentNormalization: { status: "prepared", revision: 1 },
      prepareBlocker: null,
      taskStart: { flow_id: "flow.test" },
    },
  });

  assert.deepEqual(output.intent_submission, {
    submission_id: "submission.test",
    status: "prepared",
    revision: 1,
  });
  assert.equal(output.status_ref, "intent-submission://submission.test");
  assert.deepEqual(output.intent_normalization, { status: "prepared", revision: 1 });
  assert.equal(output.prepare_blocker, null);
  assert.deepEqual(output.task_start, { flow_id: "flow.test" });
});
