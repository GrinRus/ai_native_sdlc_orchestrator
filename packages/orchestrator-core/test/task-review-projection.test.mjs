import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTaskReviewPath, parseUnifiedTaskReviewDiff } from "../src/control-plane/task-review-projection.mjs";

test("Task review path normalization rejects absolute and traversal paths", () => {
  assert.equal(normalizeTaskReviewPath("docs/auth.md"), "docs/auth.md");
  assert.equal(normalizeTaskReviewPath("./docs/auth.md"), "docs/auth.md");
  assert.equal(normalizeTaskReviewPath("../secrets.txt"), null);
  assert.equal(normalizeTaskReviewPath("/etc/passwd"), null);
  assert.equal(normalizeTaskReviewPath("docs\\auth.md"), null);
});

test("Task review parser builds bounded semantic rows and file statistics", () => {
  const parsed = parseUnifiedTaskReviewDiff(`diff --git a/docs/auth.md b/docs/auth.md
index 1111111..2222222 100644
--- a/docs/auth.md
+++ b/docs/auth.md
@@ -1,3 +1,4 @@
 # Authentication
-Timeout is 10 minutes.
+Timeout is 15 minutes.
+Warn at 13 minutes.
 Existing note.
`);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.files.length, 1);
  assert.deepEqual(
    { path: parsed.files[0].path, additions: parsed.files[0].additions, deletions: parsed.files[0].deletions },
    { path: "docs/auth.md", additions: 2, deletions: 1 },
  );
  assert.deepEqual(parsed.files[0].hunks[0].rows.slice(1, 4), [
    { kind: "deletion", old_line: 2, new_line: null, text: "Timeout is 10 minutes." },
    { kind: "addition", old_line: null, new_line: 2, text: "Timeout is 15 minutes." },
    { kind: "addition", old_line: null, new_line: 3, text: "Warn at 13 minutes." },
  ]);
});

test("Task review parser reports binary changes without fabricated rows", () => {
  const parsed = parseUnifiedTaskReviewDiff(`diff --git a/assets/logo.png b/assets/logo.png
index 1111111..2222222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`);
  assert.equal(parsed.files[0].kind, "binary");
  assert.deepEqual(parsed.files[0].hunks, []);
});
