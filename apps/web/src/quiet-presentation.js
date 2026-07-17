const QUIET_MODE_IDS = new Set(["cockpit", "attention", "journey", "evidence"]);

export function readQuietPresentation(search = "", stageIds = []) {
  const params = new URLSearchParams(search);
  const mode = params.get("mode"); const stage = params.get("stage");
  return { mode: QUIET_MODE_IDS.has(mode) ? mode : "cockpit", stage: stageIds.includes(stage) ? stage : null, attention: params.get("attention") || null, evidence: params.get("evidence") || null };
}

export function writeQuietPresentation(value, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of ["mode", "stage", "attention", "evidence"]) {
    const next = value?.[key];
    if (next) url.searchParams.set(key, next); else if (Object.prototype.hasOwnProperty.call(value ?? {}, key)) url.searchParams.delete(key);
  }
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}
