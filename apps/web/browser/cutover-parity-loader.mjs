import fs from "node:fs";

const REQUIRED_STATES = ["loading", "empty", "partial", "stale", "offline", "permission", "blocked", "error", "active", "completed"];

export function validateCutoverParityBaseline(value) {
  const errors = [];
  if (value?.schema_version !== 1) errors.push("schema_version must be 1");
  if (value?.selector?.authoritative !== false) errors.push("selector must be non-authoritative");
  if (value?.selector?.precedence?.join("|") !== "query|app-config|compiled-default") errors.push("selector precedence is invalid");
  for (const state of REQUIRED_STATES) if (!value?.states?.includes(state)) errors.push(`missing state ${state}`);
  const ids = new Set();
  for (const row of Array.isArray(value?.outcomes) ? value.outcomes : []) {
    if (ids.has(row.outcome_id)) errors.push(`duplicate outcome ${row.outcome_id}`);
    ids.add(row.outcome_id);
    for (const field of ["legacy_surface", "quiet_surface", "contract_owner", "read_route", "side_effect", "durable_readback", "recovery", "disposition"]) if (!String(row?.[field] ?? "").trim()) errors.push(`${row.outcome_id}: ${field} is required`);
  }
  if (ids.size < 10) errors.push("legacy outcome inventory is incomplete");
  return { ok: errors.length === 0, errors };
}

export function loadCutoverParityBaseline(url = new URL("./fixtures/w65-cutover-parity.json", import.meta.url)) {
  const value = JSON.parse(fs.readFileSync(url, "utf8"));
  const validation = validateCutoverParityBaseline(value);
  if (!validation.ok) throw new Error(`Invalid W65 cutover baseline:\n${validation.errors.join("\n")}`);
  return value;
}
