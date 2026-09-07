---
name: live-e2e-preflight
description: Review or prepare AOR live E2E profiles, catalog missions, and prerequisites before an authorized rehearsal.
---

# Live E2E preflight

Profile review and preparation do not require a provider run. Inspect or edit
only what the request authorizes; cloning targets, installing target tools,
probing provider authentication, and starting a rehearsal belong to an
authorized run. Do not infer permission for credential changes, paid retries,
or broader write-back from a profile's settings.

Read the
[current preparation procedure](../../../scripts/live-e2e/docs/runbooks/live-e2e-no-write-preflight.md)
and the relevant cell in the
[target catalog](../../../scripts/live-e2e/docs/runbooks/live-e2e-target-catalog.md).
Resolve `target_catalog_id` and `feature_mission_id` against the machine-readable
catalog under `scripts/live-e2e/catalog/targets/`. Supported live proof uses a
catalog-backed full journey or installed-user guided journey; historical bounded
deterministic rehearsals are not acceptance inputs.

Check the selected profile's:

- flow range, source-install policy, public-control-plane interaction capability,
  frontend capability, and `no-upstream-write` safety policy;
- skill-agent operator mode, required operator decisions, public interaction
  answers, and target-write policy before execution;
- enabled implementation loop, iteration and provider budgets, review/QA repair
  actions, and stop conditions;
- target shape, toolchain, setup and verification command ownership, baseline
  gate, expected artifacts, delivery mode, and change budget.

Medium and large product-change missions require accepted step-quality reports
before continuation and a separate final all-pass assessment for product
acceptance. Xlarge has the same quality evidence requirements but is manual-only
observation, excluded from the step evaluator and qualification sets. Use the
[qualification runbook](../../../scripts/live-e2e/docs/runbooks/live-e2e-provider-qualification.md)
when current W66 coverage or same-commit evidence is in scope.

The runner prepares the feature request and host-side profiles/assets, then
uses public installed commands. Keep the default isolated source install;
`--runtime-root` and `--aor-install-mode repo-local` are explicit debug overrides.
The launcher isolates product `AOR_HOME`; internal rehearsal outputs may use
ignored `.aor/` paths. Do not inject examples, route overlays, or provider-home
state into the target checkout. Path lists are not live E2E acceptance gates;
use the catalog mission and evidence requirements rather than inventing them.

Keep `output_policy.write_back_to_remote=false`. A fork-shaped delivery profile
does not authorize an upstream write or publication. Report the resolved cell,
readiness gaps, required evidence, and bounded next action; run only within
existing user authorization.
