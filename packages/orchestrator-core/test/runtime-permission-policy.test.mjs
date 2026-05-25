import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRuntimePermissionRequest } from "../src/runtime-permission-policy.mjs";

const executionRoot = "/tmp/aor-runtime-target";

test("conservative runtime permission policy auto-approves safe reads and safe git commands", () => {
  const readDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "file_read",
      target: "src/index.ts",
      evidence_refs: ["evidence://adapter/raw"],
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
      approval_grant_scope: "step-coarse",
      approval_resume_mode: "full-bypass",
    },
  });

  assert.equal(readDecision.decision, "auto_approve");
  assert.equal(readDecision.rule_id, "runtime-permission.auto-approve.safe-read");
  assert.equal(readDecision.approval_resume_mode, "full-bypass");

  const gitDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "git status --short",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
    },
  });

  assert.equal(gitDecision.decision, "auto_approve");
  assert.equal(gitDecision.rule_id, "runtime-permission.auto-approve.safe-git-read");

  const declaredTestDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "pnpm test",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
      declared_verification_commands: ["pnpm test"],
    },
  });

  assert.equal(declaredTestDecision.decision, "auto_approve");
  assert.equal(declaredTestDecision.rule_id, "runtime-permission.auto-approve.declared-verification-command");
});

test("runtime permission policy asks for ambiguous writes and package updates", () => {
  const writeDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "file_write",
      target: "src/index.ts",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
    },
  });

  assert.equal(writeDecision.decision, "ask_user");

  const packageDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "pnpm install",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(packageDecision.decision, "ask_user");
  assert.equal(packageDecision.rule_id, "runtime-permission.ask-user.package-or-network-read");

  const networkReadDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "network_access",
      target: "https://example.com/api",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(networkReadDecision.decision, "ask_user");
  assert.equal(networkReadDecision.rule_id, "runtime-permission.ask-user.sensitive-or-unknown");

  const compoundGitDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "git status --short && touch src/generated.js",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
    },
  });

  assert.equal(compoundGitDecision.decision, "ask_user");
  assert.equal(compoundGitDecision.rule_id, "runtime-permission.ask-user.sensitive-or-unknown");

  const redirectedGitDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "git diff > patch.diff",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "conservative",
    },
  });

  assert.equal(redirectedGitDecision.decision, "ask_user");
  assert.equal(redirectedGitDecision.rule_id, "runtime-permission.ask-user.sensitive-or-unknown");
});

test("runtime permission policy denies hard-risk requests", () => {
  const outsideDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "file_read",
      target: "/etc/passwd",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(outsideDecision.decision, "auto_deny");
  assert.equal(outsideDecision.rule_id, "runtime-permission.deny.outside-execution-root");

  const destructiveDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "sudo rm -rf /tmp/example",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(destructiveDecision.decision, "auto_deny");
  assert.equal(destructiveDecision.rule_id, "runtime-permission.deny.high-risk-command");

  const secretCommandDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "cat ~/.ssh/id_ed25519",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(secretCommandDecision.decision, "auto_deny");
  assert.equal(secretCommandDecision.rule_id, "runtime-permission.deny.secret-or-runner-auth-path");

  const gitInternalWriteDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "file_write",
      target: ".git/config",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(gitInternalWriteDecision.decision, "auto_deny");
  assert.equal(gitInternalWriteDecision.rule_id, "runtime-permission.deny.git-internal-mutation");

  const deployDecision = evaluateRuntimePermissionRequest({
    runtimePermissionRequest: {
      operation_type: "shell_command",
      command: "vercel deploy --prod",
    },
    context: {
      execution_root: executionRoot,
      runtime_agent_interaction_policy: "orchestrator-mediated",
      runtime_agent_auto_approval_profile: "trusted-run",
    },
  });

  assert.equal(deployDecision.decision, "auto_deny");
  assert.equal(deployDecision.rule_id, "runtime-permission.deny.high-risk-command");
});
