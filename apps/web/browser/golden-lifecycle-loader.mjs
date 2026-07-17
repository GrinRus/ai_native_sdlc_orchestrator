import fs from "node:fs";

export const GOLDEN_LIFECYCLE_COMMANDS = new Set([
  "project init", "route select", "route check", "mission create", "discovery run", "spec build", "plan create",
  "handoff approve", "run start", "review run", "review decide", "deliver prepare", "release prepare", "learning handoff",
]);

export function validateGoldenLifecycle(manifest) {
  const errors = [];
  if (manifest?.schema_version !== 1) errors.push("golden lifecycle schema_version must be 1");
  if (manifest?.renderer !== "quiet-cockpit") errors.push("golden lifecycle must target Quiet Cockpit");
  if (manifest?.delivery_mode !== "no-write") errors.push("golden lifecycle must remain no-write");
  for (const field of ["external_network", "target_source_writes", "upstream_writes"]) if (manifest?.[field] !== false) errors.push(`${field} must be false`);
  const transitions = Array.isArray(manifest?.transitions) ? manifest.transitions : [];
  const ids = new Set();
  for (const transition of transitions) {
    if (ids.has(transition.transition_id)) errors.push(`${transition.transition_id}: duplicate transition`);
    ids.add(transition.transition_id);
    if (!GOLDEN_LIFECYCLE_COMMANDS.has(transition.command)) errors.push(`${transition.transition_id}: command is not in the golden lifecycle allowlist`);
    for (const field of ["entry_state", "stage", "authoritative_family", "label", "recovery", "evidence_family"]) {
      if (!String(transition?.[field] ?? "").trim()) errors.push(`${transition.transition_id}: ${field} is required`);
    }
    if (!transition.flags || typeof transition.flags !== "object" || Array.isArray(transition.flags)) errors.push(`${transition.transition_id}: flags must be an object`);
  }
  const required = ["workspace-project", "route-select", "route-check", "mission", "discovery", "specification", "plan", "approval", "execution", "review", "qa-decision", "delivery", "release", "learning", "follow-up"];
  if (required.some((id, index) => transitions[index]?.transition_id !== id)) errors.push("golden lifecycle transition order is incomplete");
  return { ok: errors.length === 0, errors };
}

export function loadGoldenLifecycle(url = new URL("./fixtures/golden-lifecycle.json", import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync(url, "utf8"));
  const validation = validateGoldenLifecycle(manifest);
  if (!validation.ok) throw new Error(`Invalid golden lifecycle:\n${validation.errors.join("\n")}`);
  return manifest;
}
