import fs from "node:fs";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function readJsonRecord(filePath) {
  try {
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return {};
  }
}

function collectPrimaryVerificationCommands(value, commands, visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectPrimaryVerificationCommands(entry, commands, visited);
    return;
  }
  const record = asRecord(value);
  commands.push(...asStringArray(asRecord(record.verification_expectations).primary_commands));
  for (const entry of Object.values(record)) collectPrimaryVerificationCommands(entry, commands, visited);
}

function collectFailedRepairCommands(repairWorkContext) {
  const commands = [];
  const repairContext = asRecord(asRecord(repairWorkContext).repair_context);
  const findings = Array.isArray(repairContext.unresolved_finding_details)
    ? repairContext.unresolved_finding_details
    : [];
  for (const finding of findings) {
    const failures = asRecord(finding).verification_failure_details;
    for (const failure of Array.isArray(failures) ? failures : []) {
      const command = asString(asRecord(failure).command);
      if (command) commands.push(command);
    }
  }
  return [...new Set(commands)];
}

function commandIdentity(command) {
  const value = asString(command);
  if (!value) return null;
  const environmentPrefix = /^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/u;
  return value.replace(environmentPrefix, "").trim();
}

function resolveAllowlistedCommand(command, allowedCommands) {
  const exact = allowedCommands.find((allowedCommand) => allowedCommand === command);
  if (exact) return exact;
  const identity = commandIdentity(command);
  if (!identity) return null;
  return allowedCommands.find((allowedCommand) => commandIdentity(allowedCommand) === identity) || null;
}

export function resolveProviderCommandRoles(options) {
  const primaryCommands = [];
  const envelope = asRecord(options.envelope);
  collectPrimaryVerificationCommands({
    verification_expectations: envelope.verification_expectations,
  }, primaryCommands);
  collectPrimaryVerificationCommands({
    verification_expectations: asRecord(envelope.context).verification_expectations,
  }, primaryCommands);
  for (const ref of options.resolvedLocalRefs) {
    if (ref.kind === "input-packet") {
      collectPrimaryVerificationCommands(readJsonRecord(asString(ref.local_path)), primaryCommands);
    }
  }
  const requestedCommands = options.targetWriteAllowed
    ? [...new Set([...collectFailedRepairCommands(options.repairWorkContext), ...primaryCommands])]
    : [];
  const requiredCommands = [];
  const unlisted = [];
  for (const command of requestedCommands) {
    const allowlistedCommand = resolveAllowlistedCommand(command, options.allowedCommands);
    if (!allowlistedCommand) {
      unlisted.push(command);
      continue;
    }
    if (!requiredCommands.includes(allowlistedCommand)) requiredCommands.push(allowlistedCommand);
  }
  if (unlisted.length > 0) {
    throw new Error(
      `provider_work_packet_construction_failed: execution_contract.required_commands must be a subset of allowed_commands; unlisted commands: ${unlisted.join(", ")}`,
    );
  }
  return { requiredCommands };
}
