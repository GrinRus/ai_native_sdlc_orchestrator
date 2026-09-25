/** @param {unknown} startedAt @param {unknown} finishedAt @returns {number | null} */
export function resolveDurationSeconds(startedAt, finishedAt) {
  if (typeof startedAt !== "string" || typeof finishedAt !== "string") return null;
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) return null;
  return Math.round(((finishedMs - startedMs) / 1000) * 1000) / 1000;
}
