import fs from "node:fs";
import path from "node:path";

const INTERACTION_POLICIES = new Set(["fail-closed", "ask-all", "orchestrator-mediated"]);
const AUTO_APPROVAL_PROFILES = new Set(["none", "conservative", "auto-edit", "trusted-run"]);
const SAFE_GIT_COMMANDS = /^(?:git\s+)?(?:status|diff|log|show)(?:\s|$)/u;
const DECLARED_VERIFICATION_COMMANDS = /\b(?:lint|test|build|check|typecheck|verify)\b/u;
const PACKAGE_INSTALL_UPDATE_COMMANDS = /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade|ci)\b/u;
const PACKAGE_PUBLISH_COMMANDS = /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|bun\s+publish)\b/u;
const NETWORK_READ_COMMANDS = /\b(?:curl|wget|http|httpie)\b/u;
const NETWORK_WRITE_COMMANDS = /\b(?:curl|wget|http|httpie)\b[\s\S]*(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--request\s*(?:POST|PUT|PATCH|DELETE)|-d\s|--data\b|--upload-file\b|-T\s)|\b(?:git\s+push|gh\s+pr\s+create|gh\s+release)\b/u;
const DB_MUTATION_COMMANDS = /\b(?:prisma\s+migrate\s+deploy|drizzle-kit\s+push|supabase\s+db\s+push|psql\b[\s\S]*\b(?:insert|update|delete|drop|alter|truncate)\b|mysql\b[\s\S]*\b(?:insert|update|delete|drop|alter|truncate)\b|sqlite3\b[\s\S]*\b(?:insert|update|delete|drop|alter|truncate)\b)/iu;
const DESTRUCTIVE_COMMANDS = /\b(?:sudo|rm\s+-rf|chmod\s+(?:-R\s+)?777|chown\s+-R|mkfs|dd\s+if=|shutdown|reboot)\b/u;
const SHELL_CONTROL_OPERATORS = /(?:^|[^\\])(?:&&|\|\||;|\||>>?|<<?)|[`$]\(|\n|\r/u;
const GIT_OUTPUT_WRITE_OPTION = /\s--output(?:=|\s)/u;
const DEPLOY_OR_INFRA_WRITE_COMMANDS = /\b(?:vercel|netlify|fly|railway|wrangler|firebase)\s+(?:deploy|publish|up)\b|\b(?:kubectl|helm)\s+(?:apply|delete|patch|scale|rollout|create|replace)\b|\bterraform\s+(?:apply|destroy)\b|\bgh\s+(?:pr\s+merge|issue\s+create|release\s+(?:create|upload))\b/iu;
const GIT_MUTATION_COMMANDS = /\bgit\s+(?:add|commit|checkout|reset|clean|merge|rebase|tag|config|update-ref|stash|restore|switch|worktree|push|pull|fetch)\b/u;
const SECRET_PATH_PATTERN = /(^|\/)(?:\.env(?:[./-]|$)|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/gh(?:\/|$)|\.npmrc$|\.pypirc$|credentials(?:\.json)?$|token|secret|keychain)/iu;
const RUNNER_AUTH_PATH_PATTERN = /(^|\/)(?:\.codex|\.claude|\.qwen|\.opencode)(?:\/|$)/iu;
const GIT_INTERNAL_PATH_PATTERN = /(^|\/)\.git(?:\/|$)/u;
const ABSOLUTE_COMMAND_PATH_PATTERN = /(?:^|[\s"'=])((?:\/|~\/)[^\s"';|&]+)/gu;

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime-permission";
}

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

/**
 * @param {unknown} value
 * @returns {"fail-closed" | "ask-all" | "orchestrator-mediated"}
 */
export function normalizeRuntimeAgentInteractionPolicy(value) {
  const normalized = asString(value)?.toLowerCase() ?? "fail-closed";
  return INTERACTION_POLICIES.has(normalized)
    ? /** @type {"fail-closed" | "ask-all" | "orchestrator-mediated"} */ (normalized)
    : "fail-closed";
}

/**
 * @param {unknown} value
 * @param {string} interactionPolicy
 * @returns {"none" | "conservative" | "auto-edit" | "trusted-run"}
 */
export function normalizeRuntimeAgentAutoApprovalProfile(value, interactionPolicy = "fail-closed") {
  const fallback = interactionPolicy === "orchestrator-mediated" ? "conservative" : "none";
  const normalized = asString(value)?.toLowerCase() ?? fallback;
  return AUTO_APPROVAL_PROFILES.has(normalized)
    ? /** @type {"none" | "conservative" | "auto-edit" | "trusted-run"} */ (normalized)
    : fallback;
}

/**
 * @param {string} executionRoot
 * @param {string | null} target
 * @returns {{ path: string | null, insideExecutionRoot: boolean, relativePath: string | null }}
 */
function resolveTargetPath(executionRoot, target) {
  if (!target) {
    return { path: null, insideExecutionRoot: false, relativePath: null };
  }
  if (isUriTarget(target)) {
    return { path: null, insideExecutionRoot: false, relativePath: null };
  }
  const absoluteTarget = path.isAbsolute(target) ? path.normalize(target) : path.resolve(executionRoot, target);
  const relative = path.relative(executionRoot, absoluteTarget);
  const insideExecutionRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return {
    path: absoluteTarget,
    insideExecutionRoot,
    relativePath: insideExecutionRoot ? relative || "." : null,
  };
}

/**
 * @param {string} target
 * @returns {boolean}
 */
function isUriTarget(target) {
  return /^[a-z]+:\/\//iu.test(target);
}

/**
 * @param {string | null} target
 * @returns {boolean}
 */
function isPreflightProbeTarget(target) {
  return typeof target === "string" && target.includes(".aor/preflight/");
}

/**
 * @param {string} command
 * @returns {string}
 */
function normalizeCommand(command) {
  return command.trim().replace(/\s+/gu, " ");
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isSafeGitReadCommand(command) {
  const normalized = normalizeCommand(command);
  return !SHELL_CONTROL_OPERATORS.test(command) && !GIT_OUTPUT_WRITE_OPTION.test(normalized) && SAFE_GIT_COMMANDS.test(normalized);
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isHardDeniedCommand(command) {
  const normalized = normalizeCommand(command);
  return (
    DESTRUCTIVE_COMMANDS.test(normalized) ||
    NETWORK_WRITE_COMMANDS.test(normalized) ||
    PACKAGE_PUBLISH_COMMANDS.test(normalized) ||
    DB_MUTATION_COMMANDS.test(normalized) ||
    DEPLOY_OR_INFRA_WRITE_COMMANDS.test(normalized) ||
    GIT_MUTATION_COMMANDS.test(normalized)
  );
}

/**
 * @param {string} command
 * @returns {boolean}
 */
function isForcedAskCommand(command) {
  const normalized = normalizeCommand(command);
  return PACKAGE_INSTALL_UPDATE_COMMANDS.test(normalized) || NETWORK_READ_COMMANDS.test(normalized);
}

/**
 * @param {string} command
 * @param {string} executionRoot
 * @returns {{ deny: boolean, ruleId: string | null, reason: string | null }}
 */
function resolveCommandPathDeny(command, executionRoot) {
  const normalized = normalizeCommand(command);
  if (SECRET_PATH_PATTERN.test(normalized) || RUNNER_AUTH_PATH_PATTERN.test(normalized)) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.secret-or-runner-auth-path",
      reason: "Runtime permission command references a secret or runner-auth path.",
    };
  }
  if (GIT_INTERNAL_PATH_PATTERN.test(normalized)) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.git-internal-mutation",
      reason: "Runtime permission command references git internal state.",
    };
  }

  for (const match of normalized.matchAll(ABSOLUTE_COMMAND_PATH_PATTERN)) {
    const rawPath = match[1];
    if (!rawPath || /^[a-z]+:\/\//iu.test(rawPath)) {
      continue;
    }
    const absolutePath = rawPath.startsWith("~/")
      ? path.join(process.env.HOME ?? "", rawPath.slice(2))
      : rawPath;
    const resolved = resolveTargetPath(executionRoot, absolutePath);
    if (!resolved.insideExecutionRoot) {
      return {
        deny: true,
        ruleId: "runtime-permission.deny.outside-execution-root",
        reason: "Runtime permission command references a path outside the execution root.",
      };
    }
  }

  return { deny: false, ruleId: null, reason: null };
}

/**
 * @param {string} command
 * @param {string[]} declaredCommands
 * @returns {boolean}
 */
function isDeclaredVerificationCommand(command, declaredCommands) {
  const normalized = normalizeCommand(command);
  return (
    DECLARED_VERIFICATION_COMMANDS.test(normalized) &&
    declaredCommands.some((declaredCommand) => normalizeCommand(declaredCommand) === normalized)
  );
}

/**
 * @param {{ operationType: string, target: string | null, command: string | null, executionRoot: string }} options
 * @returns {{ deny: boolean, ruleId: string | null, reason: string | null }}
 */
function resolveHardDeny(options) {
  const targetPath = resolveTargetPath(options.executionRoot, options.target);
  const targetText = options.target ?? "";
  if (
    options.target &&
    !isUriTarget(options.target) &&
    !targetPath.insideExecutionRoot &&
    !options.target.startsWith("packet://") &&
    !options.target.startsWith("evidence://")
  ) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.outside-execution-root",
      reason: "Runtime permission target is outside the execution root.",
    };
  }
  if (SECRET_PATH_PATTERN.test(targetText) || RUNNER_AUTH_PATH_PATTERN.test(targetText)) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.secret-or-runner-auth-path",
      reason: "Runtime permission target matches a secret or runner-auth path.",
    };
  }
  if (options.operationType === "file_write" && GIT_INTERNAL_PATH_PATTERN.test(targetText)) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.git-internal-mutation",
      reason: "Runtime permission target mutates git internal state.",
    };
  }
  if (options.command && isHardDeniedCommand(options.command)) {
    return {
      deny: true,
      ruleId: "runtime-permission.deny.high-risk-command",
      reason: "Runtime permission command is destructive, mutates upstream/network state, publishes packages, or mutates database state.",
    };
  }
  if (options.command) {
    const commandPathDeny = resolveCommandPathDeny(options.command, options.executionRoot);
    if (commandPathDeny.deny) {
      return commandPathDeny;
    }
  }
  return { deny: false, ruleId: null, reason: null };
}

/**
 * @param {{ runtimePermissionRequest: Record<string, unknown>, context?: Record<string, unknown> }} options
 * @returns {{ decision: "auto_approve" | "ask_user" | "auto_deny", rule_id: string, approval_scope: "none" | "step-coarse" | "tool-call-scoped", reason: string, profile: string, interaction_policy: string, approval_resume_mode: string | null }}
 */
export function evaluateRuntimePermissionRequest(options) {
  const request = asRecord(options.runtimePermissionRequest);
  const context = asRecord(options.context);
  const interactionPolicy = normalizeRuntimeAgentInteractionPolicy(
    context.runtime_agent_interaction_policy ?? process.env.AOR_RUNTIME_AGENT_INTERACTION_POLICY,
  );
  const autoApprovalProfile = normalizeRuntimeAgentAutoApprovalProfile(
    context.runtime_agent_auto_approval_profile ?? process.env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE,
    interactionPolicy,
  );
  const operationType = asString(request.operation_type) ?? "unknown";
  const target = asString(request.target) ?? asString(request.target_path);
  const command = asString(request.command);
  const executionRoot = asString(context.execution_root) ?? process.cwd();
  const grantScope = asString(context.approval_grant_scope) === "tool-call-scoped" ? "tool-call-scoped" : "step-coarse";
  const approvalResumeMode = asString(context.approval_resume_mode) ?? "full-bypass";
  const declaredVerificationCommands = asStringArray(context.declared_verification_commands);

  if (interactionPolicy === "fail-closed") {
    return {
      decision: "auto_deny",
      rule_id: "runtime-permission.fail-closed",
      approval_scope: "none",
      reason: "Runtime permission interaction policy is fail-closed.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: null,
    };
  }

  const hardDeny = resolveHardDeny({ operationType, target, command, executionRoot });
  if (hardDeny.deny) {
    return {
      decision: "auto_deny",
      rule_id: hardDeny.ruleId ?? "runtime-permission.deny",
      approval_scope: "none",
      reason: hardDeny.reason ?? "Runtime permission request is denied by policy.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: null,
    };
  }

  if (interactionPolicy === "ask-all" || autoApprovalProfile === "none") {
    return {
      decision: "ask_user",
      rule_id: "runtime-permission.ask-all",
      approval_scope: grantScope,
      reason: "Runtime permission request requires operator approval.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  const targetPath = resolveTargetPath(executionRoot, target);
  if (operationType === "shell_command" && command && isForcedAskCommand(command)) {
    return {
      decision: "ask_user",
      rule_id: "runtime-permission.ask-user.package-or-network-read",
      approval_scope: grantScope,
      reason: "Package install/update and network read commands require operator approval.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (
    ["file_read", "file_search", "file_list", "file_stat"].includes(operationType) &&
    (target?.startsWith("packet://") || target?.startsWith("evidence://") || targetPath.insideExecutionRoot)
  ) {
    return {
      decision: "auto_approve",
      rule_id: "runtime-permission.auto-approve.safe-read",
      approval_scope: grantScope,
      reason: "Safe read/search/list request is scoped to runtime evidence or the execution root.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (["file_read", "file_write"].includes(operationType) && isPreflightProbeTarget(target)) {
    return {
      decision: "auto_approve",
      rule_id: "runtime-permission.auto-approve.preflight-probe",
      approval_scope: grantScope,
      reason: "Preflight probe read/write is scoped to the preflight probe directory.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (operationType === "shell_command" && command && isSafeGitReadCommand(command)) {
    return {
      decision: "auto_approve",
      rule_id: "runtime-permission.auto-approve.safe-git-read",
      approval_scope: grantScope,
      reason: "Git read-only command is safe to execute in the current run.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (operationType === "shell_command" && command && isDeclaredVerificationCommand(command, declaredVerificationCommands)) {
    return {
      decision: "auto_approve",
      rule_id: "runtime-permission.auto-approve.declared-verification-command",
      approval_scope: grantScope,
      reason: "Declared lint/test/build verification command is allowed by the resolved step policy.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (
    ["auto-edit", "trusted-run"].includes(autoApprovalProfile) &&
    operationType === "file_write" &&
    targetPath.insideExecutionRoot
  ) {
    return {
      decision: "auto_approve",
      rule_id: `runtime-permission.auto-approve.${autoApprovalProfile}.file-write`,
      approval_scope: grantScope,
      reason: "File write is inside the execution root and the selected profile permits scoped edits.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  if (autoApprovalProfile === "trusted-run" && operationType === "shell_command" && command) {
    return {
      decision: "auto_approve",
      rule_id: "runtime-permission.auto-approve.trusted-run.shell-command",
      approval_scope: grantScope,
      reason: "Trusted run profile permits non-denied shell commands.",
      profile: autoApprovalProfile,
      interaction_policy: interactionPolicy,
      approval_resume_mode: approvalResumeMode,
    };
  }

  return {
    decision: "ask_user",
    rule_id: "runtime-permission.ask-user.sensitive-or-unknown",
    approval_scope: grantScope,
    reason: "Runtime permission request is sensitive, ambiguous, or outside conservative auto-approval rules.",
    profile: autoApprovalProfile,
    interaction_policy: interactionPolicy,
    approval_resume_mode: approvalResumeMode,
  };
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   projectRoot: string,
 *   runId: string,
 *   stepResultId: string,
 *   runtimePermissionRequest: Record<string, unknown>,
 *   runtimePermissionDecision: Record<string, unknown>,
 *   evidenceRefs?: string[],
 * }} options
 * @returns {{ auditFile: string, auditRef: string, auditRecord: Record<string, unknown> }}
 */
export function writeRuntimePermissionDecisionAudit(options) {
  const auditId = `runtime-permission-decision-${normalizeId(options.runId)}-${normalizeId(options.stepResultId)}-${Date.now()}`;
  const auditFile = path.join(options.runtimeLayout.reportsRoot, `${auditId}.json`);
  const auditRef = toEvidenceRef(options.projectRoot, auditFile);
  const auditRecord = {
    audit_id: auditId,
    created_at: new Date().toISOString(),
    run_id: options.runId,
    step_result_id: options.stepResultId,
    runtime_permission_request: options.runtimePermissionRequest,
    runtime_permission_decision: options.runtimePermissionDecision,
    evidence_refs: uniqueStrings([...(options.evidenceRefs ?? []), ...asStringArray(options.runtimePermissionRequest.evidence_refs)]),
  };
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.writeFileSync(auditFile, `${JSON.stringify(auditRecord, null, 2)}\n`, "utf8");
  return { auditFile, auditRef, auditRecord };
}
