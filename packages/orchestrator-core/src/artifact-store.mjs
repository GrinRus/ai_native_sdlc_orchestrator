import fs from "node:fs";
import path from "node:path";

import { validateContractDocument } from "../../contracts/src/index.mjs";

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
 * @param {string} packetFile
 */
export function loadArtifactPacket(packetFile) {
  return JSON.parse(fs.readFileSync(packetFile, "utf8"));
}
