import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readCanonicalContainedFile,
  removeCanonicalContainedPath,
  resolveCanonicalContainedPath,
} from "../src/shared/canonical-paths.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-path-owner-"));
  fs.mkdirSync(path.join(root, "docs", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "readme.md"), "inside\n", "utf8");
  return root;
}

test("canonical path ownership rejects traversal and sibling-prefix escapes", () => {
  const root = fixture();
  try {
    assert.equal(resolveCanonicalContainedPath({ root, relativePath: "docs/readme.md" }).ok, true);
    assert.equal(resolveCanonicalContainedPath({ root, relativePath: "../aor-path-owner-sibling/readme.md" }).reason, "non-canonical-relative-reference");
    assert.equal(resolveCanonicalContainedPath({ root, relativePath: "docs/../docs/readme.md" }).reason, "non-canonical-relative-reference");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonical reads reject nested and final symlinks while preserving external sentinels", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aor-path-owner-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.md"), "secret\n", "utf8");
    fs.symlinkSync(outside, path.join(root, "docs", "external"), "dir");
    fs.symlinkSync(path.join(root, "docs", "readme.md"), path.join(root, "docs", "alias.md"), "file");

    assert.equal(readCanonicalContainedFile({ root, relativePath: "docs/external/secret.md", maxBytes: 1024 }).reason, "symlink-escape");
    assert.equal(readCanonicalContainedFile({ root, relativePath: "docs/alias.md", maxBytes: 1024 }).reason, "final-symlink");
    const read = readCanonicalContainedFile({ root, relativePath: "docs/readme.md", maxBytes: 1024 });
    assert.equal(read.ok, true);
    assert.equal(read.bytes.toString("utf8"), "inside\n");
    assert.equal(fs.readFileSync(path.join(outside, "secret.md"), "utf8"), "secret\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("canonical reads distinguish missing paths and bind deletion to the owned root", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aor-path-owner-sentinel-"));
  try {
    assert.equal(readCanonicalContainedFile({ root, relativePath: "docs/missing.md" }).reason, "missing");
    fs.writeFileSync(path.join(root, "docs", "remove.tmp"), "owned\n", "utf8");
    assert.equal(removeCanonicalContainedPath({ root, target: path.join(root, "docs", "remove.tmp") }).status, "deleted");
    assert.equal(fs.existsSync(path.join(root, "docs", "remove.tmp")), false);
    assert.equal(removeCanonicalContainedPath({ root, target: outside }).reason, "lexical-escape");
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
