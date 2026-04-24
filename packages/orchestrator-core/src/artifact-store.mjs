import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeId(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
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
 * }} options
 */
export function materializeBootstrapArtifactPacket(options) {
  const packetId = `${options.projectId}.artifact.bootstrap.v1`;
  const packetFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.json`);
  const packetBodyFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.body.json`);

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

  fs.writeFileSync(packetBodyFile, `${JSON.stringify(packetBody, null, 2)}\n`, "utf8");

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

  fs.writeFileSync(packetFile, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

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
 *  requestFile?: string | null,
 * }} options
 */
export function materializeIntakeArtifactPacket(options) {
  const requestTitle = typeof options.requestTitle === "string" && options.requestTitle.trim().length > 0
    ? options.requestTitle.trim()
    : "Catalog-backed feature mission request";
  const requestBrief = typeof options.requestBrief === "string" && options.requestBrief.trim().length > 0
    ? options.requestBrief.trim()
    : "Prepare one bounded feature mission request for full-journey live E2E.";
  const missionId =
    typeof options.missionId === "string" && options.missionId.trim().length > 0 ? options.missionId.trim() : null;
  const requestConstraints = Array.isArray(options.requestConstraints)
    ? options.requestConstraints.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const requestFile =
    typeof options.requestFile === "string" && options.requestFile.trim().length > 0 ? options.requestFile.trim() : null;
  const packetIdSuffix = missionId ? normalizeId(missionId) : normalizeId(requestTitle) || "request";
  const packetId = `${options.projectId}.artifact.intake.${packetIdSuffix}.v1`;
  const packetFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.json`);
  const packetBodyFile = path.join(options.runtimeLayout.artifactsRoot, `${packetId}.body.json`);

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
    },
    feature_request: {
      title: requestTitle,
      brief: requestBrief,
      constraints: requestConstraints,
      request_file: requestFile,
      request_document: loadRequestDocument(requestFile),
    },
    evidence_roots: {
      reports_root: options.runtimeLayout.reportsRoot,
      state_root: options.runtimeLayout.stateRoot,
    },
  };

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
