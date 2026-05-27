# W33 - console flow alignment and post-audit local-alpha repair

Align the rebased post-audit repair wave with the current console model:
`aor app` is the only product operator console, while `ui attach` and
`ui detach` remain explicit lifecycle commands for detached control-plane
state. The old static HTML snapshot renderer is removed from public and
internal proof paths.

W33 does not replace W31 packaged local app work or W32 operator requests. It
does not introduce CORS, hosted deployment, auth hardening, or production
security work.

## Wave objective

Make the local-alpha console story unambiguous and keep the post-audit
stabilization fixes traceable after the W31/W32 rebase:
- product console: `aor app`, packaged React/Vite SPA, foreground loopback
  server, same-origin control-plane routes;
- lifecycle state: `aor ui attach` and `aor ui detach`;
- proof smoke: `aor app --smoke true --open false --json`;
- removed surface: generated static operator-console HTML snapshots.

## Wave exit criteria

- W33 is represented across the roadmap, master backlog, epic map, dependency
  graph, and owning wave doc.
- No docs or examples imply that a generated static HTML snapshot is the
  operator console.
- Live E2E guided proof uses app-smoke evidence from the real `aor app` path.
- Root gates, guided runtime-root behavior, control-plane launch guidance,
  CLI ergonomics, OpenAPI schema depth, runtime read-model bounds, and web
  maintainability fixes remain mapped to W33 rather than colliding with W31 or
  W32 semantics.
- Security, CORS/preflight, hosted deployment, SSO, and managed production
  contour work remain explicitly out of scope.

---

## W33-S01 — Console flow source-of-truth and static snapshot removal
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Backlog, docs, live E2E proof, fixtures, and web tests agree that `aor app` is the primary local operator console and the old static snapshot renderer is gone.
- **Primary modules:** `docs/backlog/**`, `README.md`, `docs/architecture/**`, `docs/ops/**`, `docs/product/**`, `apps/web/**`, `scripts/live-e2e/**`, `examples/live-e2e/**`
- **Hard dependencies:** W32-S01
- **Primary user story surfaces:** source-of-truth alignment only; no new story closure.

### Local tasks
1. Remove the static snapshot script, module exports, renderer modules, and smoke fixture.
2. Replace guided live E2E legacy web proof evidence with real `aor app --smoke` evidence.
3. Rework web tests around SPA source coverage and app-smoke behavior.
4. Update README, architecture, ops, product, live E2E, and backlog docs.
5. Keep `ui attach` and `ui detach` documented as lifecycle commands, not the main console launch path.

### Acceptance criteria
1. No source, docs, or fixtures reference the removed snapshot smoke script as an executable flow.
2. No docs imply generated HTML is the operator console.
3. Guided proof requires app-smoke evidence with `mode=local-spa`, `status=smoke-pass`, `html_loaded=true`, and matching config/state project ids.
4. `aor app` remains the primary documented installed-user console.
5. W33 is the highest backlog wave.

### Done evidence
- `apps/web/test/operator-console.test.mjs`
- `scripts/live-e2e/lib/flows.mjs`
- `scripts/live-e2e/lib/guided-proof.mjs`
- `scripts/live-e2e/run-profile.mjs`
- `scripts/live-e2e/profiles/installed-user-guided-journey.yaml`
- `scripts/test/live-e2e-proof-runner.test.mjs`
- `examples/live-e2e/fixtures/w21-s07/installed-user-guided-app-smoke.sample.json`
- updated README, architecture, ops, product, live E2E, and backlog docs

### Out of scope
- Reintroducing a generated static HTML console.
- CORS/preflight, auth hardening, hosted deployment, or production contour work.

---

## W33-S02 — Reliable root gates and live E2E timeout bounds
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Root gates and slice gates terminate deterministically; live E2E proof subprocesses fail closed with useful profile/run diagnostics.
- **Primary modules:** `scripts/**`, `scripts/test/**`, `docs/backlog/**`
- **Hard dependencies:** W33-S01
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Add outer timeout/fail-closed handling around live E2E proof runner subprocesses.
2. Keep heavyweight proof behavior explicit and bounded in root gates.
3. Preserve existing individual CLI/API/web/core tests.
4. Add diagnostic output naming the active profile and run id when a timeout
   fires.

### Acceptance criteria
1. `pnpm test` terminates deterministically.
2. `pnpm check` reaches build or fails with an explicit bounded error.
3. `pnpm slice:gate` no longer hangs.
4. Timeout failure messages include test file, profile, and run context.

### Done evidence
- live E2E proof runner timeout tests
- root gate and slice gate verification output
- diagnostic timeout/error output with profile/run context

### Out of scope
- Changing live E2E acceptance semantics beyond timeout/fail-closed behavior.
- Adding provider auth, CORS, or hosted deployment hardening.

---

## W33-S03 — Failure-safe run start durable state
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Failed `run start` attempts no longer leave misleading active running state without terminal/block evidence.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/cli/**`, tests
- **Hard dependencies:** W33-S02
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Move validation and preflight before durable start transitions where
   possible.
2. Add compensating terminal/block transitions for downstream failures.
3. Add tests for validation failure and runtime execution failure.

### Acceptance criteria
1. A failed start does not leave active running state without terminal/block evidence.
2. CLI output and run event history explain the failure.
3. Existing run-control tests still pass.

### Done evidence
- run-control validation-failure tests
- runtime-exception terminal-state tests
- CLI/run event history assertions

### Out of scope
- Redesigning the run-state machine.
- Adding new security/auth policy modes.

---

## W33-S04 — Guided runtime-root fidelity
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Guided recommendations preserve explicit non-default runtime roots instead of falling back to `.aor` examples.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/cli/**`, tests, docs
- **Hard dependencies:** W33-S02
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Include `--runtime-root` in guided recommendations when the operator used an explicit or non-default runtime root.
2. Update human output and JSON tests.
3. Verify no-write quickstart remains aligned with README.

### Acceptance criteria
1. `doctor`, `next`, `app`, and mission blockers preserve runtime root in recommendations.
2. Default runtime-root behavior remains concise.

### Done evidence
- guided CLI human-output tests
- guided CLI JSON tests
- README/no-write quickstart alignment checks

### Out of scope
- Changing default runtime-root resolution.
- Adding new runtime storage backends.

---

## W33-S05 — Control-plane launch and port guidance alignment
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** CLI and ops docs present one coherent local control-plane/app launch story.
- **Primary modules:** `apps/cli/**`, `packages/orchestrator-core/**`, `docs/ops/**`, tests
- **Hard dependencies:** W33-S04
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Separate packaged app launch from detached API lifecycle guidance.
2. Update `aor app` guidance and `docs/ops/ui-attach-detach.md`.
3. Add/refresh smoke commands for local app and detached API checks.

### Acceptance criteria
1. CLI and docs no longer disagree between app and API ports.
2. An early operator can find the exact local control-plane command path.

### Done evidence
- `aor app --help`
- `docs/ops/ui-attach-detach.md`
- local app and detached API smoke command coverage

### Out of scope
- Adding CORS/preflight support.
- Turning detached API launch into the default console path.

---

## W33-S06 — App-smoke console boundary and static snapshot removal
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The static snapshot is removed; app smoke validates the real packaged local SPA without making web mandatory.
- **Primary modules:** `apps/web/**`, `apps/cli/**`, `scripts/live-e2e/**`, `docs/ops/**`, tests
- **Hard dependencies:** W33-S02
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Remove static renderer docs and code paths.
2. Keep generated evidence as JSON app-smoke summaries, not HTML console artifacts.
3. Preserve headless CLI/API operation without requiring the web app.

### Acceptance criteria
1. Docs no longer imply browser controls exist in a generated static artifact.
2. App-smoke output proves SPA, config, and state routes.
3. No CORS/security work is included.

### Done evidence
- `aor app --smoke true --open false --json`
- web SPA/app-smoke tests
- live E2E app-smoke fixture updates

### Out of scope
- Replacing app smoke with generated HTML artifacts.
- CORS, auth, bearer, or hosted security work.

---

## W33-S07 — CLI operator output ergonomics
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Common operator inspection flows are less noisy while preserving machine-readable compatibility.
- **Primary modules:** `apps/cli/**`, `packages/orchestrator-core/**`, `docs/architecture/**`, tests
- **Hard dependencies:** W33-S04
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Add compact JSON or command-scoped JSON behavior while preserving existing full schema paths.
2. Group global help by guided/core/run/review/delivery/ops.
3. Update command catalog/help tests.

### Acceptance criteria
1. Existing `--json` compatibility is preserved or explicitly covered.
2. Operators get clearer output for common inspection flows.

### Done evidence
- CLI help fixture updates
- compact/full JSON behavior tests
- command catalog alignment checks

### Out of scope
- Removing existing full JSON compatibility.
- Adding new command families outside operator ergonomics.

---

## W33-S08 — Control-plane OpenAPI payload schema depth
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** OpenAPI documents concrete control-plane payload shapes instead of relying on generic JSON object placeholders.
- **Primary modules:** `docs/contracts/**`, `examples/control-plane-api/**`, `apps/api/**`, `scripts/**`, tests
- **Hard dependencies:** W33-S02
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Add concrete schemas for key read and mutation responses.
2. Keep route drift checks.
3. Avoid security/auth expansion beyond the current baseline.

### Acceptance criteria
1. OpenAPI has typed schemas for state, runs, run-control, lifecycle-command, UI lifecycle, interaction answer, and event history payloads.
2. Production-readiness drift check still passes.

### Done evidence
- `docs/contracts/control-plane-api.openapi.json`
- OpenAPI drift checks
- API transport schema coverage tests

### Out of scope
- Auth/CORS/body-size hardening.
- Hosted API deployment contract work.

---

## W33-S09 — Runtime read-model scale and pagination baseline
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Runtime artifact, run, and event reads are bounded for larger `.aor` histories while keeping the filesystem source of record.
- **Primary modules:** `packages/orchestrator-core/**`, `apps/api/**`, `apps/cli/**`, tests
- **Hard dependencies:** W33-S02
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Add bounded list behavior or indexing for large `.aor` histories.
2. Add fixture/perf smoke coverage with many artifacts.
3. Keep filesystem SOR; do not introduce database/storage migration.

### Acceptance criteria
1. Read routes and CLI inspection remain bounded with large artifact counts.
2. Existing small-runtime behavior is unchanged.

### Done evidence
- large runtime artifact read-model tests
- API and CLI bounded list assertions
- unchanged small-runtime behavior tests

### Out of scope
- Database, search index, or external storage migration.
- Changing `.aor/` as the filesystem source of record.

---

## W33-S10 — Web app smoke module cleanup and console surface simplification
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** Web maintainability follows the app-smoke-only console boundary after static snapshot removal.
- **Primary modules:** `apps/web/**`, tests
- **Hard dependencies:** W33-S06
- **Primary user story surfaces:** local-alpha repair only; no new story closure.

### Local tasks
1. Keep SPA source, app launcher smoke, and API transport coverage separated.
2. Remove static snapshot module ownership from the web package.
3. Preserve public behavior of `aor app`.

### Acceptance criteria
1. The web package does not export snapshot composition or renderer helpers.
2. SPA/source tests and app-smoke checks cover the supported console surface.
3. No product behavior changes beyond removing the obsolete static snapshot
   surface.

### Done evidence
- `apps/web/package.json`
- `apps/web/test/operator-console.test.mjs`
- removed static snapshot module tree

### Out of scope
- Reintroducing Node-rendered operator-console HTML.
- Changing `aor app` product behavior beyond obsolete surface removal.

## Wave out of scope

- CORS/preflight support.
- HTTP body size limits.
- Sanitized internal API 500s.
- Additional bearer/auth/redaction hardening.
- Hosted deployment, multi-tenant, SSO, managed rollback, or production
  contour work.
