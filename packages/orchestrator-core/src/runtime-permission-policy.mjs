import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INTERACTION_POLICIES = new Set(["fail-closed", "ask-all", "orchestrator-mediated"]);
const AUTO_APPROVAL_PROFILES = new Set(["none", "conservative", "auto-edit", "trusted-run"]);
const READ_OPERATIONS = new Set(["file_read", "file_search", "file_list", "file_stat"]);
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files"]);
const GIT_MUTATION_SUBCOMMANDS = new Set([
  "add", "commit", "checkout", "reset", "clean", "merge", "rebase", "tag", "config", "update-ref",
  "stash", "restore", "switch", "worktree", "push", "pull", "fetch",
]);
const UPSTREAM_GIT_SUBCOMMANDS = new Set(["push", "pull", "fetch"]);
const KNOWN_INTERPRETERS = new Set(["node", "nodejs", "python", "python3", "ruby", "perl"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "cmd", "powershell", "pwsh"]);
const WRAPPERS = new Set(["command", "env"]);
const PUBLIC_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const SECRET_PATH_PATTERN = /(^|\/)(?:\.env(?:[./-]|$)|id_rsa|id_dsa|id_ecdsa|id_ed25519|\.ssh(?:\/|$)|\.aws(?:\/|$)|\.config\/gh(?:\/|$)|\.npmrc$|\.pypirc$|credentials(?:\.json)?$|token|secret|keychain)/iu;
const RUNNER_AUTH_PATH_PATTERN = /(^|\/)(?:\.codex|\.claude|\.qwen|\.opencode)(?:\/|$)/iu;
const GIT_INTERNAL_PATH_PATTERN = /(^|\/)\.git(?:\/|$)/u;
const SHELL_CONTROL_OPERATORS = /(?:^|[^\\])(?:&&|\|\||;|\||>>?|<<?)|[`$]\(|\n|\r/u;

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime-permission";
}

function toEvidenceRef(projectRoot, filePath) {
  return `evidence://${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`;
}

function commandDigest(command) {
  return command ? `sha256:${crypto.createHash("sha256").update(command).digest("hex")}` : null;
}

export function normalizeRuntimeAgentInteractionPolicy(value) {
  const normalized = asString(value)?.toLowerCase() ?? "fail-closed";
  return INTERACTION_POLICIES.has(normalized) ? normalized : "fail-closed";
}

export function normalizeRuntimeAgentAutoApprovalProfile(value, interactionPolicy = "fail-closed") {
  const fallback = interactionPolicy === "orchestrator-mediated" ? "conservative" : "none";
  const normalized = asString(value)?.toLowerCase() ?? fallback;
  return AUTO_APPROVAL_PROFILES.has(normalized) ? normalized : fallback;
}

function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped || quote) return { tokens: [], parsed: false };
  if (current) tokens.push(current);
  return { tokens, parsed: tokens.length > 0 };
}

function executableName(value) {
  return path.basename(value ?? "").toLowerCase().replace(/\.exe$/u, "");
}

function unwrapCommand(tokens) {
  let index = 0;
  const wrappers = [];
  while (WRAPPERS.has(executableName(tokens[index]))) {
    const wrapper = executableName(tokens[index]);
    wrappers.push(wrapper);
    index += 1;
    if (wrapper === "env") {
      while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index]) || tokens[index] === "-i")) index += 1;
    }
  }
  return { tokens: tokens.slice(index), wrappers };
}

function parseGit(tokens) {
  let index = 1;
  let workingDirectory = null;
  while (index < tokens.length && tokens[index].startsWith("-")) {
    const option = tokens[index];
    if (option === "-C") {
      if (!tokens[index + 1]) return { parsed: false };
      workingDirectory = tokens[index + 1];
      index += 2;
      continue;
    }
    if (option === "-c") {
      if (!tokens[index + 1] || !tokens[index + 1].includes("=")) return { parsed: false };
      index += 2;
      continue;
    }
    if (option.startsWith("--git-dir") || option.startsWith("--work-tree") || option === "--exec-path") {
      return { parsed: false, unsafeGlobalOption: true };
    }
    if (["--no-pager", "--paginate", "--version", "--help"].includes(option)) {
      index += 1;
      continue;
    }
    return { parsed: false };
  }
  const subcommand = tokens[index]?.toLowerCase() ?? null;
  return { parsed: Boolean(subcommand), subcommand, workingDirectory };
}

function existingRealpath(filePath) {
  let cursor = filePath;
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const real = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : path.resolve(cursor);
  return path.join(real, ...suffix);
}

function normalizeFilesystemResource(target, executionRoot) {
  if (!target) return { canonicalResource: null, relativeResource: null, contained: false, unsafe: false };
  const root = existingRealpath(path.resolve(executionRoot));
  const candidate = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
  const canonical = existingRealpath(candidate);
  const relative = path.relative(root, canonical);
  const contained = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  const normalizedRelative = contained ? (relative || ".").replace(/\\/g, "/") : null;
  return {
    canonicalResource: canonical,
    relativeResource: normalizedRelative,
    contained,
    unsafe: SECRET_PATH_PATTERN.test(normalizedRelative ?? target) || RUNNER_AUTH_PATH_PATTERN.test(normalizedRelative ?? target),
  };
}

function capabilitySet(overrides = {}) {
  return {
    filesystem_read: false,
    filesystem_write: false,
    network_read: false,
    network_write: false,
    upstream_write: false,
    process_spawn: false,
    shell_composition: false,
    ...overrides,
  };
}

/** Normalize a legacy adapter request into the authoritative structural permission request. */
export function normalizeRuntimePermissionRequest(requestValue, contextValue = {}) {
  const request = asRecord(requestValue);
  const context = asRecord(contextValue);
  const operationType = asString(request.operation_type) ?? "unknown";
  const target = asString(request.relative_resource) ?? asString(request.target) ?? asString(request.target_path) ?? asString(request.canonical_resource);
  const command = asString(request.command);
  const executionRoot = asString(context.execution_root) ?? process.cwd();
  let resourceType = asString(request.resource_type) ?? "unknown";
  let canonicalResource = target;
  let relativeResource = asString(request.relative_resource);
  let capabilities = capabilitySet(asRecord(request.capabilities));
  let parser = { parsed: true, kind: "direct", reason: null, executable: null, subcommand: null, wrappers: [] };
  let interpreter = { name: null, known: true, inline_code: false };
  let contained = true;
  let unsafePath = false;

  if (READ_OPERATIONS.has(operationType) || operationType === "file_write") {
    resourceType = target?.startsWith("packet://") ? "packet" : target?.startsWith("evidence://") ? "evidence" : "filesystem";
    capabilities = capabilitySet(operationType === "file_write" ? { filesystem_write: true } : { filesystem_read: true });
    if (resourceType === "filesystem") {
      const normalized = normalizeFilesystemResource(target, executionRoot);
      canonicalResource = normalized.canonicalResource;
      relativeResource = normalized.relativeResource;
      contained = normalized.contained;
      unsafePath = normalized.unsafe || (operationType === "file_write" && GIT_INTERNAL_PATH_PATTERN.test(relativeResource ?? ""));
    }
  } else if (operationType === "network_access" || target && /^[a-z][a-z0-9+.-]*:\/\//iu.test(target)) {
    resourceType = "network";
    try {
      const url = new URL(target);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      canonicalResource = url.toString();
    } catch {
      parser = { ...parser, parsed: false, reason: "invalid-network-resource" };
    }
    capabilities = capabilitySet({ network_read: true });
  } else if (operationType === "shell_command") {
    resourceType = "process";
    capabilities = capabilitySet({ process_spawn: true });
    const composed = Boolean(command && SHELL_CONTROL_OPERATORS.test(command));
    const tokenized = command ? tokenize(command) : { tokens: [], parsed: false };
    const unwrapped = unwrapCommand(tokenized.tokens);
    const executable = executableName(unwrapped.tokens[0]);
    parser = {
      parsed: tokenized.parsed && unwrapped.tokens.length > 0 && !composed,
      kind: composed ? "shell-composition" : "argv",
      reason: composed ? "shell-composition" : tokenized.parsed ? null : "unparseable-command",
      executable,
      subcommand: unwrapped.tokens[1]?.toLowerCase() ?? null,
      wrappers: unwrapped.wrappers,
    };
    capabilities.shell_composition = composed;
    canonicalResource = executable || null;
    relativeResource = null;

    if (SHELLS.has(executable)) {
      parser.parsed = false;
      parser.reason = "shell-interpreter";
      interpreter = { name: executable, known: true, inline_code: true };
    } else if (KNOWN_INTERPRETERS.has(executable)) {
      const inlineCode = unwrapped.tokens.includes("-e") || unwrapped.tokens.includes("-c");
      interpreter = { name: executable, known: true, inline_code: inlineCode };
      if (inlineCode) {
        parser.parsed = false;
        parser.reason = "inline-interpreter-code";
      }
    } else {
      interpreter = { name: executable || null, known: Boolean(executable), inline_code: false };
    }

    if (executable === "git") {
      const git = parseGit(unwrapped.tokens);
      parser = { ...parser, parsed: parser.parsed && git.parsed, subcommand: git.subcommand ?? null, reason: git.parsed ? parser.reason : "unparsed-git-form" };
      if (git.workingDirectory) {
        const normalized = normalizeFilesystemResource(git.workingDirectory, executionRoot);
        contained = normalized.contained;
        canonicalResource = normalized.canonicalResource;
        relativeResource = normalized.relativeResource;
      } else {
        const normalized = normalizeFilesystemResource(".", executionRoot);
        canonicalResource = normalized.canonicalResource;
        relativeResource = normalized.relativeResource;
      }
      capabilities.filesystem_read = true;
      if (GIT_MUTATION_SUBCOMMANDS.has(git.subcommand)) capabilities.filesystem_write = true;
      if (UPSTREAM_GIT_SUBCOMMANDS.has(git.subcommand)) capabilities.network_read = true;
      if (git.subcommand === "push") {
        capabilities.network_write = true;
        capabilities.upstream_write = true;
      }
      if (!SAFE_GIT_SUBCOMMANDS.has(git.subcommand) && !GIT_MUTATION_SUBCOMMANDS.has(git.subcommand)) {
        parser.parsed = false;
        parser.reason = "unknown-git-subcommand-or-alias";
      }
    } else if (["curl", "wget", "http", "httpie"].includes(executable)) {
      const lowerTokens = unwrapped.tokens.map((token) => token.toLowerCase());
      capabilities.network_read = true;
      capabilities.network_write = lowerTokens.some((token, index) =>
        ["-d", "--data", "--data-raw", "--data-binary", "-t", "--upload-file"].includes(token) ||
        token.startsWith("--data=") ||
        token.startsWith("--upload-file=") ||
        /^-x(?:post|put|patch|delete)$/u.test(token) ||
        ["post", "put", "patch", "delete"].includes(token) ||
        ((token === "-x" || token === "--request") && ["post", "put", "patch", "delete"].includes(lowerTokens[index + 1])),
      );
    } else if (["npm", "pnpm", "yarn", "bun"].includes(executable) && ["publish"].includes(parser.subcommand)) {
      capabilities.network_write = true;
      capabilities.upstream_write = true;
    } else if (executable === "gh") {
      const nestedCommand = unwrapped.tokens[2]?.toLowerCase() ?? null;
      capabilities.network_read = true;
      if (
        (parser.subcommand === "pr" && ["create", "merge", "close", "edit", "reopen"].includes(nestedCommand)) ||
        (parser.subcommand === "release" && ["create", "upload", "delete", "edit"].includes(nestedCommand)) ||
        (parser.subcommand === "issue" && ["create", "close", "edit", "reopen"].includes(nestedCommand)) ||
        ["repo", "workflow", "run", "secret", "variable"].includes(parser.subcommand)
      ) {
        capabilities.network_write = true;
        capabilities.upstream_write = true;
      }
    } else if (["psql", "mysql", "sqlite3", "prisma", "drizzle-kit", "supabase"].includes(executable)) {
      parser.parsed = false;
      parser.reason = "unbounded-database-client";
    } else if (["vercel", "netlify", "fly", "railway", "wrangler", "firebase", "kubectl", "helm", "terraform"].includes(executable)) {
      if (["deploy", "publish", "up", "apply", "delete", "destroy", "create", "merge", "release"].includes(parser.subcommand)) {
        capabilities.network_write = true;
        capabilities.upstream_write = true;
      }
    } else if (["sudo", "rm", "chmod", "chown", "mkfs", "dd", "shutdown", "reboot"].includes(executable)) {
      capabilities.filesystem_write = true;
      parser.parsed = false;
      parser.reason = "destructive-process";
    }
  }

  const explicitOperationId = asString(asRecord(request.requested_scope).operation_id) ?? asString(request.tool_call_id);
  if (explicitOperationId && !PUBLIC_ID_PATTERN.test(explicitOperationId)) {
    parser.parsed = false;
    parser.reason = "invalid-operation-id";
  }
  const derivedOperationId = `operation-${crypto.createHash("sha256")
    .update(JSON.stringify([asString(request.tool_name), operationType, target, commandDigest(command)]))
    .digest("hex")
    .slice(0, 20)}`;
  const requestedScope = {
    project_id: asString(requestedScopeValue(request, context, "project_id")),
    run_id: asString(requestedScopeValue(request, context, "run_id")),
    step_id: asString(requestedScopeValue(request, context, "step_id")),
    operation_id: explicitOperationId ?? derivedOperationId,
  };
  return {
    ...request,
    operation_type: operationType,
    resource_type: resourceType,
    canonical_resource: canonicalResource,
    relative_resource: relativeResource,
    capabilities,
    interpreter,
    command_parser: parser,
    requested_scope: requestedScope,
    expires_at: asString(request.expires_at) ?? asString(context.expires_at),
    legacy_diagnostic: {
      tool_name: asString(request.tool_name),
      target_present: Boolean(target),
      command_digest: commandDigest(command),
    },
    containment: { execution_root: existingRealpath(path.resolve(executionRoot)), contained, unsafe_path: unsafePath },
    summary: "Normalized runtime permission request.",
    command: null,
    target: null,
    target_path: null,
  };
}

function requestedScopeValue(request, context, key) {
  const requestScope = asRecord(request.requested_scope);
  return requestScope[key] ?? context[key];
}

function decisionBase(normalized, interactionPolicy, profile, approvalResumeMode) {
  return {
    normalized_request: normalized,
    profile,
    interaction_policy: interactionPolicy,
    approval_resume_mode: approvalResumeMode,
  };
}

export function evaluateRuntimePermissionRequest(options) {
  const context = asRecord(options.context);
  const interactionPolicy = normalizeRuntimeAgentInteractionPolicy(context.runtime_agent_interaction_policy ?? process.env.AOR_RUNTIME_AGENT_INTERACTION_POLICY);
  const profile = normalizeRuntimeAgentAutoApprovalProfile(context.runtime_agent_auto_approval_profile ?? process.env.AOR_RUNTIME_AGENT_AUTO_APPROVAL_PROFILE, interactionPolicy);
  const normalized = normalizeRuntimePermissionRequest(options.runtimePermissionRequest, context);
  const parser = asRecord(normalized.command_parser);
  const capabilities = asRecord(normalized.capabilities);
  const containment = asRecord(normalized.containment);
  const grantScope = asString(context.approval_grant_scope) === "step-coarse" ? "step-coarse" : "tool-call-scoped";
  const resumeMode = asString(context.approval_resume_mode) === "restricted" ? "restricted" : null;
  const base = decisionBase(normalized, interactionPolicy, profile, resumeMode);
  const deny = (rule_id, reason) => ({ ...base, decision: "auto_deny", rule_id, approval_scope: "none", reason, approval_resume_mode: null });
  const ask = (rule_id, reason) => ({ ...base, decision: "ask_user", rule_id, approval_scope: grantScope, reason });
  const approve = (rule_id, reason) => ({ ...base, decision: "auto_approve", rule_id, approval_scope: grantScope, reason });

  if (interactionPolicy === "fail-closed") return deny("runtime-permission.fail-closed", "Runtime permission interaction policy is fail-closed.");
  if (containment.contained === false) return deny("runtime-permission.deny.outside-execution-root", "Canonical resource is outside the execution root.");
  if (containment.unsafe_path) return deny(GIT_INTERNAL_PATH_PATTERN.test(asString(normalized.relative_resource) ?? "") ? "runtime-permission.deny.git-internal-mutation" : "runtime-permission.deny.secret-or-runner-auth-path", "Canonical resource targets protected runtime, credential, or Git state.");
  if (parser.parsed === false) return deny("runtime-permission.deny.unparseable-or-composed-command", "Command composition, interpreter code, aliases, wrappers, or command form cannot be safely bounded.");
  if (capabilities.upstream_write || capabilities.network_write) return deny("runtime-permission.deny.upstream-or-network-write", "Upstream or network mutation is not permitted by runtime permission policy.");
  if (parser.reason === "destructive-process") return deny("runtime-permission.deny.destructive-process", "Destructive process execution is not permitted.");
  if (interactionPolicy === "ask-all" || profile === "none") return ask("runtime-permission.ask-all", "Runtime permission request requires operator approval.");

  if (READ_OPERATIONS.has(normalized.operation_type) && ["filesystem", "packet", "evidence"].includes(normalized.resource_type)) {
    return approve("runtime-permission.auto-approve.safe-read", "Canonical read resource is bounded to the execution root or runtime evidence.");
  }
  if (["file_read", "file_write"].includes(normalized.operation_type) && asString(normalized.relative_resource)?.includes(".aor/preflight/")) {
    return approve("runtime-permission.auto-approve.preflight-probe", "Preflight probe is bounded to the execution root.");
  }
  if (normalized.operation_type === "shell_command" && parser.executable === "git" && SAFE_GIT_SUBCOMMANDS.has(parser.subcommand)) {
    return approve("runtime-permission.auto-approve.safe-git-read", "Parsed Git operation is read-only and bound to the canonical execution root.");
  }
  const normalizedDeclared = asStringArray(context.declared_verification_commands).map((value) => commandDigest(value));
  if (normalized.operation_type === "shell_command" && normalizedDeclared.includes(asRecord(normalized.legacy_diagnostic).command_digest)) {
    return approve("runtime-permission.auto-approve.declared-verification-command", "Parsed command exactly matches a declared verification command.");
  }
  if (["npm", "pnpm", "yarn", "bun", "curl", "wget", "http", "httpie"].includes(parser.executable)) {
    return ask("runtime-permission.ask-user.package-or-network-read", "Package changes and network reads require operator approval.");
  }
  if (["auto-edit", "trusted-run"].includes(profile) && normalized.operation_type === "file_write" && containment.contained) {
    return approve(`runtime-permission.auto-approve.${profile}.file-write`, "Canonical write resource is inside the execution root.");
  }
  return ask("runtime-permission.ask-user.sensitive-or-unknown", "Structured request is sensitive or outside conservative auto-approval rules.");
}

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
