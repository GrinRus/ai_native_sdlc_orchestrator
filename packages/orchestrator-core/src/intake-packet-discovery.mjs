import { loadContractFile } from "../../contracts/src/index.mjs";

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
export function loadValidatedIntakePacket(filePath) {
  const loaded = loadContractFile({ filePath, family: "artifact-packet" });
  return loaded.ok && loaded.document?.packet_type === "intake-request"
    ? /** @type {Record<string, unknown>} */ (loaded.document)
    : null;
}
