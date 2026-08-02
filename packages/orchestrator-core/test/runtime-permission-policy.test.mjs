import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateRuntimePermissionRequest,
  normalizeRuntimePermissionRequest,
} from "../src/runtime-permission-policy.mjs";
import { runtimePermissionGrantMatches } from "../src/step-execution-engine.mjs";

function withExecutionRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aor-runtime-permission-"));
  fs.mkdirSync(path.join(root, "src"));
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function decide(executionRoot, runtimePermissionRequest, extra = {}) {
  return evaluateRuntimePermissionRequest({
    runtimePermissionRequest,
    context: {
      execution_root: executionRoot,
      project_id: "project-one",
      run_id: "run-one",
      step_id: "step-one",
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
      ...extra,
    },
  });
}

test("structural policy canonicalizes resources and auto-approves bounded reads", () => withExecutionRoot((executionRoot) => {
  const readDecision = decide(executionRoot, {
    operation_type: "file_read",
    target: "src/index.ts",
    tool_call_id: "read-one",
  });
  assert.equal(readDecision.decision, "auto_approve");
  assert.equal(readDecision.rule_id, "runtime-permission.auto-approve.safe-read");
  assert.equal(readDecision.approval_resume_mode, null);
  assert.equal(readDecision.normalized_request.resource_type, "filesystem");
  assert.equal(readDecision.normalized_request.relative_resource, "src/index.ts");
  assert.equal(readDecision.normalized_request.requested_scope.operation_id, "read-one");
  assert.equal(readDecision.normalized_request.command, null);

  for (const [index, command] of ["git status --short", "git -C . diff", "command git log -1", "env LC_ALL=C git show HEAD"].entries()) {
    const decision = decide(executionRoot, { operation_type: "shell_command", command, tool_call_id: `git-read-${index}` });
    assert.equal(decision.decision, "auto_approve", command);
    assert.equal(decision.rule_id, "runtime-permission.auto-approve.safe-git-read", command);
    assert.equal(decision.normalized_request.capabilities.upstream_write, false);
  }

  const declared = decide(
    executionRoot,
    { operation_type: "shell_command", command: "pnpm test", tool_call_id: "verify-one" },
    { declared_verification_commands: ["pnpm test"], approval_resume_mode: "restricted" },
  );
  assert.equal(declared.decision, "auto_approve");
  assert.equal(declared.approval_resume_mode, "restricted");
  assert.equal(declared.rule_id, "runtime-permission.auto-approve.declared-verification-command");
}));

test("structural policy denies aliases, interpreter escape, composition, and every upstream-write form", () => withExecutionRoot((executionRoot) => {
  const deniedCommands = [
    "git push origin main",
    "git -C . push origin main",
    "git -c credential.helper= push origin main",
    "command git push origin main",
    "env TOKEN=secret git push origin main",
    "git publish",
    "sh -c 'git status'",
    "bash -lc 'git status'",
    "node -e 'require(\"https\").get(\"https://example.com\")'",
    "python3 -c 'import urllib.request'",
    "git status && touch src/generated.js",
    "git diff > patch.diff",
    "vercel deploy --prod",
    "npm publish",
    "curl -X post https://example.com/api",
    "curl --data=payload https://example.com/api",
    "gh pr create --title release",
    "psql database",
  ];
  for (const command of deniedCommands) {
    const decision = decide(
      executionRoot,
      { operation_type: "shell_command", command, tool_call_id: `op-${deniedCommands.indexOf(command)}` },
      { runtime_agent_auto_approval_profile: "trusted-run" },
    );
    assert.equal(decision.decision, "auto_deny", command);
    assert.equal(decision.approval_resume_mode, null, command);
  }

  const packageRead = decide(executionRoot, { operation_type: "shell_command", command: "pnpm install", tool_call_id: "install" });
  assert.equal(packageRead.decision, "ask_user");
  assert.equal(packageRead.rule_id, "runtime-permission.ask-user.package-or-network-read");

  const digestA = normalizeRuntimePermissionRequest(
    { operation_type: "shell_command", command: "env TOKEN=first git status", tool_call_id: "one" },
    { execution_root: executionRoot },
  ).legacy_diagnostic.command_digest;
  const digestB = normalizeRuntimePermissionRequest(
    { operation_type: "shell_command", command: "env TOKEN=second git status", tool_call_id: "one" },
    { execution_root: executionRoot },
  ).legacy_diagnostic.command_digest;
  assert.notEqual(digestA, digestB);
  assert.equal(JSON.stringify(decide(executionRoot, { operation_type: "shell_command", command: "env TOKEN=secret git push", tool_call_id: "secret" })).includes("TOKEN=secret"), false);

  const granted = normalizeRuntimePermissionRequest(
    { operation_type: "file_write", target: "src/index.ts", tool_call_id: "edit-one" },
    { execution_root: executionRoot, project_id: "project-one", run_id: "run-one", step_id: "step-one" },
  );
  assert.equal(runtimePermissionGrantMatches(granted, granted), true);
  for (const scopeChange of [
    { project_id: "project-two" },
    { run_id: "run-two" },
    { step_id: "step-two" },
    { operation_id: "edit-two" },
  ]) {
    assert.equal(
      runtimePermissionGrantMatches(
        { ...granted, requested_scope: { ...granted.requested_scope, ...scopeChange } },
        granted,
      ),
      false,
    );
  }
  assert.equal(runtimePermissionGrantMatches({ ...granted, canonical_resource: path.join(executionRoot, "src", "other.ts") }, granted), false);
}));

test("canonical containment rejects outside paths, protected state, and symlink escapes", () => withExecutionRoot((executionRoot) => {
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aor-runtime-outside-"));
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret\n");
  fs.symlinkSync(outsideRoot, path.join(executionRoot, "src", "escape"));
  try {
    const cases = [
      [{ operation_type: "file_read", target: "/etc/passwd", tool_call_id: "outside" }, "runtime-permission.deny.outside-execution-root"],
      [{ operation_type: "file_write", target: ".git/config", tool_call_id: "git-internal" }, "runtime-permission.deny.git-internal-mutation"],
      [{ operation_type: "file_read", target: "src/escape/secret.txt", tool_call_id: "symlink" }, "runtime-permission.deny.outside-execution-root"],
      [{ operation_type: "file_read", target: ".ssh/id_ed25519", tool_call_id: "credential" }, "runtime-permission.deny.secret-or-runner-auth-path"],
    ];
    for (const [request, rule] of cases) {
      const decision = decide(executionRoot, request, { runtime_agent_auto_approval_profile: "trusted-run" });
      assert.equal(decision.decision, "auto_deny");
      assert.equal(decision.rule_id, rule);
    }

    const network = decide(executionRoot, { operation_type: "network_access", target: "https://user:password@example.com/api", tool_call_id: "network" });
    assert.equal(network.decision, "ask_user");
    assert.equal(network.normalized_request.canonical_resource.includes("password"), false);
  } finally {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
}));
