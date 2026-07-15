import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { validateContractDocument, validatePublicId } from "../../contracts/src/index.mjs";

const INTAKE_SOURCE_KIND_VALUES = Object.freeze(["local-issue", "local-prd", "local-rfc", "local-note", "local-mail"]);
const DELIVERY_MODE_VALUES = Object.freeze(["no-write", "patch-only", "local-branch", "fork-first-pr"]);

/**
 * @param {string} value
 * @returns {string}
 */
function requirePublicId(field, value) {
  const validation = validatePublicId(value);
  if (!validation.ok) {
    throw new Error(`Invalid ${field} ${JSON.stringify(value)} (${validation.value_class}). ${validation.migration}`);
  }
  return value;
}

function contentAddressedId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function buildPacketId(parts) {
  const candidate = parts.join(".");
  const validation = validatePublicId(candidate);
  if (validation.ok) return candidate;
  if (validation.value_class === "length") {
    return `packet-${crypto.createHash("sha256").update(candidate).digest("hex").slice(0, 32)}`;
  }
  return requirePublicId("packet_id", candidate);
}

/**
 * @param {string | null} requestFile
 * @returns {unknown}
 */
function loadRequestDocument(requestFile) {
  if (!requestFile || !fs.existsSync(requestFile)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(requestFile, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} field
 * @returns {string[]}
 */
function readOptionalStringArray(record, field) {
  const value = record[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Intake request field '${field}' must be an array of strings when provided.`);
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function readOptionalKpis(record) {
  const value = record.kpis;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Intake request field 'kpis' must be an array when provided.");
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Intake request field 'kpis[${index}]' must be an object.`);
    }
    const kpiId = typeof entry.kpi_id === "string" ? entry.kpi_id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const target = typeof entry.target === "string" ? entry.target.trim() : "";
    const measurement = typeof entry.measurement === "string" ? entry.measurement.trim() : "";
    if (!kpiId || !name || !target) {
      throw new Error(`Intake request field 'kpis[${index}]' must include kpi_id, name, and target.`);
    }
    return {
      kpi_id: kpiId,
      name,
      target,
      ...(measurement ? { measurement } : {}),
    };
  });
}

/**
 * @param {unknown} value
 * @returns {Array<{ kpi_id: string, name: string, target: string, measurement?: string }>}
 */
function normalizeKpis(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Guided mission KPIs must be an array when provided.");
  }
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Guided mission KPI '${index}' must be an object.`);
    }
    const kpiId = typeof entry.kpi_id === "string" ? entry.kpi_id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const target = typeof entry.target === "string" ? entry.target.trim() : "";
    const measurement = typeof entry.measurement === "string" ? entry.measurement.trim() : "";
    if (!kpiId || !name || !target) {
      throw new Error(`Guided mission KPI '${index}' must include kpi_id, name, and target.`);
    }
    return {
      kpi_id: kpiId,
      name,
      target,
      ...(measurement ? { measurement } : {}),
    };
  });
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeDeliveryMode(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Delivery mode must be a string.");
  }
  const deliveryMode = value.trim();
  if (!DELIVERY_MODE_VALUES.includes(deliveryMode)) {
    throw new Error(`Unsupported delivery mode '${deliveryMode}'. Expected one of: ${DELIVERY_MODE_VALUES.join(", ")}.`);
  }
  return deliveryMode;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSourceKind(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Intake source kind must be a string.");
  }
  const sourceKind = value.trim();
  if (!INTAKE_SOURCE_KIND_VALUES.includes(sourceKind)) {
    throw new Error(
      `Intake source kind '${sourceKind}' is unsupported. Supported local source kinds: ${INTAKE_SOURCE_KIND_VALUES.join(", ")}. External SaaS connectors are out of scope.`,
    );
  }
  return sourceKind;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Array<{ source_id: string, source_kind: string, title: string, ref: string }>}
 */
function readOptionalSourceRefs(record) {
  const value = record.source_refs;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Intake request field 'source_refs' must be an array when provided.");
  }

  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(`Intake request field 'source_refs[${index}]' must be an object.`);
    }
    const sourceId = typeof entry.source_id === "string" ? entry.source_id.trim() : "";
    const sourceKind = normalizeSourceKind(entry.source_kind);
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const ref = typeof entry.ref === "string" ? entry.ref.trim() : "";
    if (!sourceId || !sourceKind || !title || !ref) {
      throw new Error(
        `Intake request field 'source_refs[${index}]' must include source_id, source_kind, title, and ref.`,
      );
    }
    return {
      source_id: sourceId,
      source_kind: sourceKind,
      title,
      ref,
    };
  });
}

/**
 * @param {Array<{ source_id: string, source_kind: string, title: string, ref: string }>} sourceRefs
 * @returns {Array<{ source_id: string, source_kind: string, title: string, ref: string }>}
 */
function dedupeSourceRefs(sourceRefs) {
  const seen = new Set();
  return sourceRefs.filter((entry) => {
    const key = `${entry.source_kind}\0${entry.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {{
 *   requestDocument: Record<string, unknown>,
 *   requestTitle: string,
 *   requestBrief: string,
 *   requestConstraints: string[],
 *   goals?: string[],
 *   kpis?: Array<{ kpi_id: string, name: string, target: string, measurement?: string }>,
 *   definitionOfDone?: string[],
 *   requestFile: string | null,
 *   sourceKind?: string | null,
 *   sourceRef?: string | null,
 * }} options
 */
function buildProductIntake(options) {
  const goals = [
    ...normalizeStringArray(options.goals),
    ...readOptionalStringArray(options.requestDocument, "goals"),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const constraints = [
    ...options.requestConstraints,
    ...readOptionalStringArray(options.requestDocument, "constraints"),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const kpis = [
    ...normalizeKpis(options.kpis),
    ...readOptionalKpis(options.requestDocument),
  ].filter((entry, index, entries) =>
    entries.findIndex((candidate) => candidate.kpi_id === entry.kpi_id) === index,
  );
  const guidedDefinitionOfDone = normalizeStringArray(options.definitionOfDone);
  const definitionOfDone =
    guidedDefinitionOfDone.length > 0
      ? guidedDefinitionOfDone
      : options.requestDocument.definition_of_done !== undefined
        ? readOptionalStringArray(options.requestDocument, "definition_of_done")
        : readOptionalStringArray(options.requestDocument, "dod");
  const requestedSourceKind = normalizeSourceKind(options.sourceKind) ?? "local-note";
  const sourceRefs = readOptionalSourceRefs(options.requestDocument);
  const sourceRef = typeof options.sourceRef === "string" && options.sourceRef.trim().length > 0
    ? options.sourceRef.trim()
    : options.requestFile;
  if (sourceRef) {
    sourceRefs.unshift({
      source_id: contentAddressedId("local-source", JSON.stringify([requestedSourceKind, sourceRef])),
      source_kind: requestedSourceKind,
      title: options.requestTitle,
      ref: sourceRef,
    });
  }
  if (sourceRefs.length === 0) {
    sourceRefs.push({
      source_id: "manual-request",
      source_kind: requestedSourceKind,
      title: options.requestTitle,
      ref: "runtime://manual-request",
    });
  }

  const productIntake = {
    goals: goals.length > 0 ? goals : [options.requestBrief],
    constraints,
    kpis,
    definition_of_done: definitionOfDone,
    source_refs: dedupeSourceRefs(sourceRefs),
  };
  const missingFields = [];
  if (productIntake.goals.length === 0) missingFields.push("goals");
  if (productIntake.constraints.length === 0) missingFields.push("constraints");
  if (productIntake.kpis.length === 0) missingFields.push("kpis");
  if (productIntake.definition_of_done.length === 0) missingFields.push("definition_of_done");
  if (productIntake.source_refs.length === 0) missingFields.push("source_refs");

  return {
    productIntake,
    completeness: {
      status: missingFields.length === 0 ? "complete" : "incomplete",
      missing_fields: missingFields,
    },
  };
}

/**
 * @param {{
 *  projectId: string,
 *  projectRoot: string,
 *  projectProfileRef: string,
 *  runtimeLayout: {
 *    projectRuntimeRoot: string,
 *    artifactsRoot: string,
 *    reportsRoot: string,
 *    stateRoot: string,
 *  },
 *  outputRuntimeLayout?: {
 *    artifactsRoot: string,
 *  },
 *  command: string,
 * }} options
 */
export function materializeBootstrapArtifactPacket(options) {
  requirePublicId("project_id", options.projectId);
  const packetId = buildPacketId([options.projectId, "artifact", "bootstrap", "v1"]);
  const packetFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.json`);
  const packetBodyFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.body.json`);
  const outputArtifactsRoot = options.outputRuntimeLayout?.artifactsRoot ?? options.runtimeLayout.artifactsRoot;
  const outputPacketFile = path.join(outputArtifactsRoot, `${packetId}.json`);
  const outputPacketBodyFile = path.join(outputArtifactsRoot, `${packetId}.body.json`);

  const packetBody = {
    generated_from: {
      command: options.command,
      project_root: options.projectRoot,
      project_profile_ref: options.projectProfileRef,
    },
    project_identity: {
      project_id: options.projectId,
    },
    evidence_roots: {
      reports_root: options.runtimeLayout.reportsRoot,
      state_root: options.runtimeLayout.stateRoot,
    },
  };

  fs.writeFileSync(outputPacketBodyFile, `${JSON.stringify(packetBody, null, 2)}\n`, "utf8");

  const packet = {
    packet_id: packetId,
    project_id: options.projectId,
    packet_type: "bootstrap",
    version: 1,
    status: "ready",
    summary: "Initial runtime bootstrap artifact packet.",
    body_ref: packetBodyFile,
    invocation_context: {
      command: options.command,
      project_root: options.projectRoot,
      project_profile_ref: options.projectProfileRef,
    },
    evidence_refs: [options.runtimeLayout.stateRoot, options.runtimeLayout.reportsRoot],
  };

  const validation = validateContractDocument({
    family: "artifact-packet",
    document: packet,
    source: "runtime://artifact-packet",
  });

  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated artifact packet failed contract validation: ${issueSummary}`);
  }

  fs.writeFileSync(outputPacketFile, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  return {
    packet,
    packetFile,
    packetBodyFile,
  };
}

/**
 * @param {{
 *  projectId: string,
 *  projectRoot: string,
 *  projectProfileRef: string,
 *  runtimeLayout: {
 *    projectRuntimeRoot: string,
 *    artifactsRoot: string,
 *    reportsRoot: string,
 *    stateRoot: string,
 *  },
 *  command: string,
 *  missionId?: string | null,
 *  requestTitle?: string | null,
 *  requestBrief?: string | null,
 *  requestConstraints?: string[],
 *  goals?: string[],
 *  kpis?: Array<{ kpi_id: string, name: string, target: string, measurement?: string }>,
 *  definitionOfDone?: string[],
 *  allowedPaths?: string[],
 *  forbiddenPaths?: string[],
 *  deliveryMode?: string | null,
 *  requestFile?: string | null,
 *  sourceKind?: string | null,
 *  sourceRef?: string | null,
 *  followUpSourceHandoffRef?: string | null,
 * }} options
 */
export function materializeIntakeArtifactPacket(options) {
  const requestTitle = typeof options.requestTitle === "string" && options.requestTitle.trim().length > 0
    ? options.requestTitle.trim()
    : "Catalog-backed feature mission request";
  const requestBrief = typeof options.requestBrief === "string" && options.requestBrief.trim().length > 0
    ? options.requestBrief.trim()
    : "Prepare one bounded feature mission request for full-journey execution.";
  const missionId =
    typeof options.missionId === "string" && options.missionId.trim().length > 0 ? options.missionId.trim() : null;
  requirePublicId("project_id", options.projectId);
  if (missionId) requirePublicId("mission_id", missionId);
  const requestConstraints = Array.isArray(options.requestConstraints)
    ? options.requestConstraints.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const requestFile =
    typeof options.requestFile === "string" && options.requestFile.trim().length > 0 ? options.requestFile.trim() : null;
  const packetIdSuffix = missionId ?? contentAddressedId("request", requestTitle);
  const packetId = buildPacketId([options.projectId, "artifact", "intake", packetIdSuffix, "v1"]);
  const packetFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.json`);
  const packetBodyFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.body.json`);

  const requestDocumentBody = loadRequestDocument(requestFile);
  const requestDocument =
    typeof requestDocumentBody === "object" && requestDocumentBody !== null && !Array.isArray(requestDocumentBody)
      ? /** @type {Record<string, unknown>} */ (requestDocumentBody)
      : {};
  const { productIntake, completeness } = buildProductIntake({
    requestDocument,
    requestTitle,
    requestBrief,
    requestConstraints,
    goals: options.goals,
    kpis: options.kpis,
    definitionOfDone: options.definitionOfDone,
    requestFile,
    sourceKind: options.sourceKind ?? null,
    sourceRef: options.sourceRef ?? null,
  });
  const allowedPaths = [
    ...normalizeStringArray(options.allowedPaths),
    ...readOptionalStringArray(requestDocument, "allowed_paths"),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const forbiddenPaths = [
    ...normalizeStringArray(options.forbiddenPaths),
    ...readOptionalStringArray(requestDocument, "forbidden_paths"),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  const deliveryMode =
    normalizeDeliveryMode(options.deliveryMode) ??
    normalizeDeliveryMode(requestDocument.delivery_mode) ??
    normalizeDeliveryMode(requestDocument.write_mode) ??
    "no-write";
  const requestCoverageFollowUp =
    typeof requestDocument.coverage_follow_up === "object" &&
    requestDocument.coverage_follow_up !== null &&
    !Array.isArray(requestDocument.coverage_follow_up)
      ? /** @type {Record<string, unknown>} */ (requestDocument.coverage_follow_up)
      : {};
  const followUpSourceHandoffRef =
    typeof options.followUpSourceHandoffRef === "string" && options.followUpSourceHandoffRef.trim().length > 0
      ? options.followUpSourceHandoffRef.trim()
      : null;
  const coverageFollowUp = {
    ...requestCoverageFollowUp,
    ...(followUpSourceHandoffRef
      ? {
          follow_up_source_handoff_ref: followUpSourceHandoffRef,
          source_handoff_ref: followUpSourceHandoffRef,
        }
      : {}),
  };

  const packetBody = {
    generated_from: {
      command: options.command,
      project_root: options.projectRoot,
      project_profile_ref: options.projectProfileRef,
    },
    project_identity: {
      project_id: options.projectId,
    },
    mission_traceability: {
      mission_id: missionId,
      source_kind: missionId ? "catalog-feature-mission" : "manual-request",
      scenario_family:
        typeof requestDocument.scenario_family === "string" ? requestDocument.scenario_family : null,
      provider_variant_id:
        typeof requestDocument.provider_variant_id === "string" ? requestDocument.provider_variant_id : null,
      feature_size: typeof requestDocument.feature_size === "string" ? requestDocument.feature_size : null,
      mission_type: typeof requestDocument.mission_type === "string" ? requestDocument.mission_type : null,
      delivery_mode: deliveryMode,
      matrix_cell:
        typeof requestDocument.matrix_cell === "object" &&
        requestDocument.matrix_cell !== null &&
        !Array.isArray(requestDocument.matrix_cell)
          ? requestDocument.matrix_cell
          : null,
      coverage_follow_up: Object.keys(coverageFollowUp).length > 0 ? coverageFollowUp : null,
    },
    product_intake: productIntake,
    product_intake_completeness: completeness,
    mission_scope: {
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
      delivery_mode: deliveryMode,
      writeback_policy: {
        mode: deliveryMode,
        upstream_writes_default: false,
        requires_explicit_review: deliveryMode !== "no-write",
      },
    },
    feature_request: {
      title: requestTitle,
      brief: requestBrief,
      constraints: requestConstraints,
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
      delivery_mode: deliveryMode,
      request_file: requestFile,
      request_document: requestDocumentBody,
    },
    evidence_roots: {
      reports_root: options.runtimeLayout.reportsRoot,
      state_root: options.runtimeLayout.stateRoot,
    },
  };

  const bodyValidation = validateContractDocument({
    family: "intake-request-body",
    document: packetBody,
    source: "runtime://intake-request-body",
  });

  if (!bodyValidation.ok) {
    const issueSummary = bodyValidation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated intake request body failed contract validation: ${issueSummary}`);
  }

  fs.writeFileSync(packetBodyFile, `${JSON.stringify(packetBody, null, 2)}\n`, "utf8");

  const packet = {
    packet_id: packetId,
    project_id: options.projectId,
    packet_type: "intake-request",
    version: 1,
    status: "ready",
    summary: requestTitle,
    body_ref: packetBodyFile,
    invocation_context: {
      command: options.command,
      project_root: options.projectRoot,
      project_profile_ref: options.projectProfileRef,
      mission_id: missionId,
    },
    evidence_refs: [
      options.runtimeLayout.stateRoot,
      options.runtimeLayout.reportsRoot,
      ...(requestFile ? [requestFile] : []),
    ],
  };

  const validation = validateContractDocument({
    family: "artifact-packet",
    document: packet,
    source: "runtime://artifact-packet",
  });

  if (!validation.ok) {
    const issueSummary = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Generated intake artifact packet failed contract validation: ${issueSummary}`);
  }

  fs.writeFileSync(packetFile, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  return {
    packet,
    packetBody,
    packetFile,
    packetBodyFile,
  };
}

/**
 * @param {string} packetFile
 */
export function loadArtifactPacket(packetFile) {
  return JSON.parse(fs.readFileSync(packetFile, "utf8"));
}
