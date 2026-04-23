import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";

import { resolveSkillsForStep } from "./skill-registry.mjs";

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
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
 * @param {string} source
 * @param {"wrapper-profile" | "prompt-bundle"} family
 * @returns {Record<string, unknown>}
 */
function loadProfileFromSource(source, family) {
  const loaded = loadContractFile({ filePath: source, family });
  if (!loaded.ok) {
    throw new Error(`Context compilation failed: ${family} '${source}' failed contract validation.`);
  }
  return asRecord(loaded.document);
}

/**
 * @param {string} packetRef
 * @returns {string | null}
 */
function packetNameFromRef(packetRef) {
  const match = /^packet:\/\/([^@\s/]+)(?:@[^\s]+)?$/u.exec(packetRef);
  if (!match) {
    return null;
  }
  return match[1];
}

/**
 * @param {string} value
 * @returns {string}
 */
function canonicalPacketRef(value) {
  if (value.startsWith("packet://")) {
    return value;
  }
  return `packet://${value}`;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isStableEvidenceReference(value) {
  return /^[a-z][a-z0-9+.-]*:\/\/.+/iu.test(value);
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      acc[key] = sortJson(record[key]);
      return acc;
    }, /** @type {Record<string, unknown>} */ ({}));
}

/**
 * @param {Record<string, unknown>} compiledContext
 * @returns {string}
 */
function fingerprintCompiledContext(compiledContext) {
  const serialized = JSON.stringify(sortJson(compiledContext));
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values)];
}

/**
 * @param {unknown} value
 * @param {"context_doc_refs" | "context_rule_refs" | "context_skill_refs"} field
 * @returns {string[]}
 */
function collectExpandedContextRefs(value, field) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === "object" && entry !== null)
    .flatMap((entry) => {
      const record = asRecord(entry);
      return asStringArray(record[field]);
    });
}

/**
 * @param {{
 *   required: string[],
 *   optional: string[],
 *   explicitPacketRefs: string[],
 *   bootstrapPackets: string[],
 *   runtimeEvidenceRefs: string[],
 * }} options
 */
function resolveRequiredPackets(options) {
  /** @type {Map<string, { ref: string, source: string }>} */
  const byPacketName = new Map();
  /** @type {Array<{ kind: string, value: string, reason: string }>} */
  const dropped = [];

  const register = (packetName, ref, source) => {
    const existing = byPacketName.get(packetName);
    if (existing) {
      dropped.push({
        kind: "packet-ref",
        value: ref,
        reason: `duplicate-of:${existing.ref}`,
      });
      return;
    }
    byPacketName.set(packetName, { ref, source });
  };

  for (const packetRef of options.explicitPacketRefs) {
    const packetName = packetNameFromRef(packetRef);
    if (!packetName) {
      dropped.push({
        kind: "packet-ref",
        value: packetRef,
        reason: "unsupported-format",
      });
      continue;
    }
    register(packetName, packetRef, "input-packet-refs");
  }

  for (const packetName of options.bootstrapPackets) {
    register(packetName, canonicalPacketRef(packetName), "wrapper.session_bootstrap.include_packets");
  }

  for (const evidenceRef of options.runtimeEvidenceRefs) {
    const packetName = packetNameFromRef(evidenceRef);
    if (!packetName) {
      continue;
    }
    register(packetName, evidenceRef, "runtime-evidence");
  }

  const resolveEntries = (names, required) =>
    names.map((name) => {
      const resolved = byPacketName.get(name);
      return {
        packet: name,
        required,
        found: Boolean(resolved),
        resolved_ref: resolved?.ref ?? null,
        source: resolved?.source ?? null,
      };
    });

  const requiredEntries = resolveEntries(options.required, true);
  const optionalEntries = resolveEntries(options.optional, false);
  const missingRequired = requiredEntries.filter((entry) => entry.found === false).map((entry) => entry.packet);

  return {
    required: requiredEntries,
    optional: optionalEntries,
    missing_required: missingRequired,
    dropped,
    resolved_input_packet_refs: uniqueStrings(
      requiredEntries
        .concat(optionalEntries)
        .map((entry) => entry.resolved_ref)
        .filter((entry) => typeof entry === "string")
        .concat(Array.from(byPacketName.values()).map((entry) => entry.ref)),
    ),
  };
}

/**
 * @param {{
 *   projectRoot: string,
 *   required: string[],
 *   recommended: string[],
 *   bootstrapFiles: string[],
 * }} options
 */
function resolveRequiredFiles(options) {
  const requiredFiles = uniqueStrings(options.required);
  const recommendedFiles = uniqueStrings(options.recommended);
  const bootstrapFiles = new Set(options.bootstrapFiles);

  const toEntry = (relativePath, required) => {
    const absolutePath = path.resolve(options.projectRoot, relativePath);
    return {
      path: relativePath,
      required,
      found: fs.existsSync(absolutePath),
      source: bootstrapFiles.has(relativePath)
        ? "wrapper.session_bootstrap.include_files"
        : required
          ? "prompt.required_inputs.files.required"
          : "prompt.required_inputs.files.recommended",
    };
  };

  const requiredEntries = requiredFiles.map((relativePath) => toEntry(relativePath, true));
  const recommendedEntries = recommendedFiles.map((relativePath) => toEntry(relativePath, false));

  return {
    required: requiredEntries,
    recommended: recommendedEntries,
    missing_required: requiredEntries.filter((entry) => entry.found === false).map((entry) => entry.path),
  };
}

/**
 * @param {{
 *   projectRoot: string,
 *   projectProfilePath: string,
 *   stepClass: string,
 *   routeResolution: Record<string, unknown>,
 *   assetResolution: Record<string, unknown>,
 *   policyResolution: Record<string, unknown>,
 *   inputPacketRefs?: string[],
 *   runtimeEvidenceRefs?: string[],
 *   skillsRoot: string,
 *   skillOverrides?: Record<string, string[]>,
 * }} options
 */
export function compileStepContext(options) {
  const routeResolution = asRecord(options.routeResolution);
  const routeProfile = asRecord(routeResolution.route_profile);
  const assetResolution = asRecord(options.assetResolution);
  const wrapperResolution = asRecord(assetResolution.wrapper);
  const promptResolution = asRecord(assetResolution.prompt_bundle);
  const contextBundleResolution = asRecord(assetResolution.context_bundles);
  const policyResolution = asRecord(options.policyResolution);
  const policy = asRecord(policyResolution.policy);

  const wrapperProfileSource = wrapperResolution.profile_source;
  if (typeof wrapperProfileSource !== "string" || wrapperProfileSource.length === 0) {
    throw new Error(
      `Context compilation failed for step '${options.stepClass}': wrapper profile source is missing from asset resolution.`,
    );
  }
  const promptProfileSource = promptResolution.profile_source;
  if (typeof promptProfileSource !== "string" || promptProfileSource.length === 0) {
    throw new Error(
      `Context compilation failed for step '${options.stepClass}': prompt bundle source is missing from asset resolution.`,
    );
  }

  const wrapperProfile = loadProfileFromSource(wrapperProfileSource, "wrapper-profile");
  const promptBundle = loadProfileFromSource(promptProfileSource, "prompt-bundle");

  const contextBundleRefs = uniqueStrings(asStringArray(contextBundleResolution.bundle_refs));
  if (contextBundleRefs.length === 0) {
    throw new Error(
      `Context compilation failed for step '${options.stepClass}': asset resolution did not include any context bundle refs.`,
    );
  }
  const expandedRefs = asRecord(contextBundleResolution.expanded_refs);
  const contextDocRefs = uniqueStrings(
    asStringArray(expandedRefs.context_doc_refs).concat(
      collectExpandedContextRefs(contextBundleResolution.bundles, "context_doc_refs"),
    ),
  );
  const contextRuleRefs = uniqueStrings(
    asStringArray(expandedRefs.context_rule_refs).concat(
      collectExpandedContextRefs(contextBundleResolution.bundles, "context_rule_refs"),
    ),
  );
  const contextSkillRefs = uniqueStrings(
    asStringArray(expandedRefs.context_skill_refs).concat(
      collectExpandedContextRefs(contextBundleResolution.bundles, "context_skill_refs"),
    ),
  );
  const contextBundleSources = Array.isArray(contextBundleResolution.bundles)
    ? contextBundleResolution.bundles
        .map((entry) => asRecord(entry).profile_source)
        .filter((entry) => typeof entry === "string")
    : [];

  const routeClass = typeof routeProfile.route_class === "string" ? routeProfile.route_class : null;
  if (!routeClass) {
    throw new Error(
      `Context compilation failed for step '${options.stepClass}': route_resolution.route_profile.route_class is required.`,
    );
  }

  const skillResolution = resolveSkillsForStep({
    projectProfilePath: options.projectProfilePath,
    stepClass: options.stepClass,
    routeClass,
    skillsRoot: options.skillsRoot,
    skillOverrides: options.skillOverrides,
  });

  const sessionBootstrap = asRecord(wrapperProfile.session_bootstrap);
  const includeFiles = uniqueStrings(asStringArray(sessionBootstrap.include_files));
  const includePackets = uniqueStrings(asStringArray(sessionBootstrap.include_packets));

  const requiredInputs = asRecord(promptBundle.required_inputs);
  const packetInputs = asRecord(requiredInputs.packets);
  const fileInputs = asRecord(requiredInputs.files);

  const requiredPackets = uniqueStrings(asStringArray(packetInputs.required));
  const optionalPackets = uniqueStrings(asStringArray(packetInputs.optional));
  const requiredFiles = uniqueStrings(asStringArray(fileInputs.required));
  const recommendedFiles = uniqueStrings(asStringArray(fileInputs.recommended));

  const explicitPacketRefs = uniqueStrings(asStringArray(options.inputPacketRefs));
  const runtimeEvidenceRefs = uniqueStrings(asStringArray(options.runtimeEvidenceRefs));
  const stableRuntimeEvidenceRefs = [];
  const droppedRuntimeEvidenceRefs = [];
  for (const runtimeRef of runtimeEvidenceRefs) {
    if (isStableEvidenceReference(runtimeRef)) {
      stableRuntimeEvidenceRefs.push(runtimeRef);
      continue;
    }
    droppedRuntimeEvidenceRefs.push({
      kind: "runtime-evidence-ref",
      value: runtimeRef,
      reason: "volatile-local-path",
    });
  }

  const packetResolution = resolveRequiredPackets({
    required: requiredPackets,
    optional: optionalPackets,
    explicitPacketRefs,
    bootstrapPackets: includePackets,
    runtimeEvidenceRefs,
  });
  const fileResolution = resolveRequiredFiles({
    projectRoot: options.projectRoot,
    required: requiredFiles,
    recommended: recommendedFiles,
    bootstrapFiles: includeFiles,
  });

  const missingRequiredInputs = [
    ...packetResolution.missing_required.map((packet) => `packet:${packet}`),
    ...fileResolution.missing_required.map((filePath) => `file:${filePath}`),
  ];
  if (missingRequiredInputs.length > 0) {
    throw new Error(
      `Context compilation failed for step '${options.stepClass}': missing required inputs [${missingRequiredInputs.join(
        ", ",
      )}].`,
    );
  }

  const instructionSet = {
    objective: typeof promptBundle.objective === "string" ? promptBundle.objective : null,
    instructions: asRecord(promptBundle.instructions),
    output_contract_hints: asRecord(promptBundle.output_contract_hints),
    stop_conditions: asStringArray(promptBundle.stop_conditions),
    redaction_expectations: asStringArray(promptBundle.redaction_expectations),
    skills: skillResolution.skills.map((entry) => ({
      skill_ref: entry.skill_ref,
      summary: entry.profile.summary,
      workflow: entry.profile.workflow,
      expected_outputs: entry.profile.expected_outputs,
    })),
  };

  const requiredInputsResolved = {
    packets: {
      required: packetResolution.required,
      optional: packetResolution.optional,
      missing_required: packetResolution.missing_required,
    },
    files: {
      required: fileResolution.required,
      recommended: fileResolution.recommended,
      missing_required: fileResolution.missing_required,
    },
    status: "ready",
  };

  const guardrails = {
    policy_id: typeof policy.policy_id === "string" ? policy.policy_id : null,
    approval_required: policyResolution.guardrails?.approval_required ?? null,
    provider_allowlist_enforced: policyResolution.guardrails?.provider_allowlist_enforced ?? null,
    redact_secrets: policyResolution.guardrails?.redact_secrets ?? null,
    blocking_rules: asStringArray(policyResolution.guardrails?.blocking_rules),
    quality_gate: asRecord(policy.profile?.quality_gate),
    command_constraints: asRecord(policyResolution.resolved_bounds?.command_constraints),
    writeback_mode: asRecord(policyResolution.resolved_bounds?.writeback_mode),
  };

  const contextCompilation = {
    included_sources: [
      {
        kind: "project-profile",
        reference: options.projectProfilePath,
      },
      {
        kind: "route-profile",
        reference:
          typeof routeResolution.resolved_route_id === "string" ? routeResolution.resolved_route_id : null,
        source: routeResolution.route_profile_source ?? null,
      },
      {
        kind: "wrapper-profile",
        reference: wrapperResolution.wrapper_ref ?? null,
        source: wrapperProfileSource,
      },
      {
        kind: "prompt-bundle",
        reference: promptResolution.prompt_bundle_ref ?? null,
        source: promptProfileSource,
      },
      {
        kind: "context-bundles",
        reference: contextBundleRefs,
        source: contextBundleSources,
      },
      {
        kind: "step-policy-profile",
        reference: policy.policy_id ?? null,
        source: policy.profile_source ?? null,
      },
      {
        kind: "skill-profiles",
        reference: skillResolution.skill_refs,
        source: skillResolution.provenance.skill_profile_sources,
      },
    ],
    dropped_sources: packetResolution.dropped,
    dropped_runtime_evidence_refs: droppedRuntimeEvidenceRefs,
    missing_required_inputs: [],
    required_inputs_status: "ready",
  };

  const compiledContext = {
    instruction_set: instructionSet,
    session_bootstrap: {
      include_files: includeFiles,
      include_packets: includePackets,
    },
    required_inputs_resolved: requiredInputsResolved,
    guardrails,
    context_refs: {
      context_bundle_refs: contextBundleRefs,
      context_doc_refs: contextDocRefs,
      context_rule_refs: contextRuleRefs,
      context_skill_refs: contextSkillRefs,
    },
    skill_refs: skillResolution.skill_refs,
    provenance: {
      project_profile_path: options.projectProfilePath,
      route_profile_source: routeResolution.route_profile_source ?? null,
      wrapper_profile_source: wrapperProfileSource,
      prompt_bundle_source: promptProfileSource,
      policy_profile_source: policy.profile_source ?? null,
      context_bundle_sources: contextBundleSources,
      skill_profile_sources: skillResolution.provenance.skill_profile_sources,
      route_resolution_source: asRecord(routeResolution.resolution_source),
      wrapper_resolution_source: asRecord(wrapperResolution.resolution_source),
      prompt_bundle_resolution_source: asRecord(promptResolution.resolution_source),
      policy_resolution_source: asRecord(policy.resolution_source),
      skill_resolution_source: asRecord(skillResolution.resolution_source),
      input_packet_refs: packetResolution.resolved_input_packet_refs,
      runtime_evidence_refs: stableRuntimeEvidenceRefs,
    },
  };

  const compiledContextFingerprint = fingerprintCompiledContext(compiledContext);

  return {
    compiled_context: {
      ...compiledContext,
      compiled_context_fingerprint: compiledContextFingerprint,
    },
    context_compilation: {
      ...contextCompilation,
      dropped_sources: [...packetResolution.dropped, ...droppedRuntimeEvidenceRefs],
      compiled_context_fingerprint: compiledContextFingerprint,
      resolved_input_packet_refs: packetResolution.resolved_input_packet_refs,
      skill_refs: skillResolution.skill_refs,
    },
  };
}
