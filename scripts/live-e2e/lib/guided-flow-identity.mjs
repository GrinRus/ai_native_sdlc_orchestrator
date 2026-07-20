import { createHash } from "node:crypto";

import { asNonEmptyString, normalizeId } from "./common.mjs";

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function truncateToken(value, maximumLength) {
  return value.length <= maximumLength
    ? value
    : value.slice(0, maximumLength).replace(/[._-]+$/u, "");
}

/**
 * Keep private guided follow-up identity inside the public flow-id boundary.
 * The digest preserves uniqueness without exposing private run identity as an
 * unbounded suffix to product commands.
 *
 * @param {{ projectId: string, missionId?: string | null, runId: string }} options
 * @returns {string}
 */
export function deriveGuidedFollowUpMissionId(options) {
  const projectId = normalizeId(options.projectId);
  const sourceMissionId = normalizeId(asNonEmptyString(options.missionId) || "guided-flow");
  const maximumMissionLength = 128 - `flow.${projectId}.`.length;
  const digestSuffix = `-${shortHash(`${projectId}\n${sourceMissionId}\n${options.runId}`)}`;
  if (!projectId || maximumMissionLength <= digestSuffix.length) {
    throw new Error("Guided follow-up identity cannot fit inside the public 128-character flow-id boundary.");
  }
  const readablePrefix = truncateToken(`${sourceMissionId}-follow-up`, maximumMissionLength - digestSuffix.length);
  return `${readablePrefix || "follow-up"}${digestSuffix}`;
}
