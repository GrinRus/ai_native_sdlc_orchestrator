export const CONTROL_PLANE_LIMITS = Object.freeze({
  list: Object.freeze({ default: 200, maximum: 1000 }),
  sse_replay: Object.freeze({ default: 0, maximum: 1000 }),
});

export function resolveBoundedInteger(value, bounds) {
  if (value === undefined || value === null || value === "") return bounds.default;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return Math.min(parsed, bounds.maximum);
}
