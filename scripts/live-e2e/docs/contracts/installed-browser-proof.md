# Installed browser proof

## Ownership

`installed-browser-proof.v2` is a private live E2E qualification contract. It
belongs to `scripts/live-e2e/**`; product packages must not import its
vocabulary or evidence paths.

## Identity and immutability

The proof request, proof, and evidence index carry the same `run_id` and
`scenario_id`. The collector copies each required artifact into
`browser-evidence/objects/<sha256>.<ext>` and writes an immutable,
content-addressed index. Validation recomputes every digest and byte count,
rejects absolute or escaping refs, and rejects stale, wrong-kind, missing,
overwritten, and cross-run evidence.

Required artifact kinds are:

- `installed-app-smoke`
- `installed-scenario-report`
- `browser-task-proof`
- `dom-snapshot`
- `accessibility-summary`
- `finding-ledger`

## Authoritative readiness and action proof

The collector polls the installed app's public project-state and selected-flow
routes until the expected durable state is visible. `loading`, `syncing`,
`partial`, `offline`, and `timeout` are distinct non-passing outcomes.

At least one action must bind a visible UI label to its canonical HTTP
mutation, returned identity, evidence refs, post-reload verification, and a
durable public-route readback. A successful click or response without durable
readback is not proof.

## Required matrices

- Viewports: desktop, tablet, mobile, and 200% zoom.
- Accessibility: keyboard-only, dialog focus, focus restoration, semantic
  structure, WCAG AA contrast, touch targets, and reduced motion.
- Recovery: reload, reconnect, partial read, offline read, injected error,
  multi-item attention, project switching, and terminal read-only behavior.

The injected-error cell must record that the fault was actually injected.
Console errors, external requests, missing cells, or unresolved P1 findings
block the proof.

## Compatibility

Version 1 proof fixtures may still be read by historical report hydration, but
they cannot satisfy an installed qualification profile that declares schema
version 2. Wire-format changes require a new version and negative compatibility
tests.
