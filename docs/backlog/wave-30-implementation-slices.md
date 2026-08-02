# W30 - alpha hardening

Make the current self-hosted CLI/API alpha easier to verify, operate, and
review without starting the target-architecture rewrite.

## Wave objective

Harden the bounded alpha distribution around source-of-truth planning,
architecture decisions, machine-readable API contracts, self-hosted operations,
readiness gates, and installed-user release proof.

## Wave exit criteria

- W30 is represented across the roadmap, master backlog, epic map, dependency
  graph, and owning wave doc.
- Alpha architecture decisions distinguish current runtime commitments from
  future TypeScript/NestJS/Next.js/Postgres/S3/Temporal-style targets.
- The detached HTTP/SSE control-plane route surface has a machine-readable
  OpenAPI 3.1 contract and drift check.
- Self-hosted operators have environment, secrets/redaction, backup/restore, and
  incident evidence runbooks for the bounded mode.
- `pnpm production:ready --json` reports W30 hardening evidence and fails closed
  on missing contracts, docs, or unsupported readiness claims.
- The npm alpha release path includes the hardened installed-user smoke boundary
  without claiming GA, hosted SaaS, Docker/GHCR, SSO, default upstream
  write-back, or OpenCode live-baseline certification.

---

## W30-S01 — Post-W29 alpha-hardening planning source of truth
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** W30 exists as the post-W29 alpha-hardening wave across every backlog source of truth.
- **Primary modules:** `docs/backlog/**`, `README.md`
- **Hard dependencies:** W29-S01
- **Primary user story surfaces:** enablement slice; supports OPS/SEC/DEVX traceability without closing a new product story.

### Local tasks
1. Add the W30 wave document with slice-local tasks, acceptance criteria, done evidence, and out-of-scope boundaries.
2. Add W30 to the roadmap wave summary and detailed roadmap section.
3. Add W30 rows to the master implementation backlog.
4. Add W30 entries to the epic map and dependency graph.
5. Verify slice-cycle status and next-slice selection against the expanded backlog.

### Acceptance criteria
1. W30 is visible in the roadmap as the post-W29 alpha-hardening wave.
2. Every W30 slice is tied to user-story surfaces or explicitly marked as enablement.
3. The dependency graph has no orphan W30 slices and topological order includes W30-S01 through W30-S06.
4. Slice-cycle commands load the W30 backlog without manual script changes.

### Done evidence
- W30 wave document
- updated roadmap, implementation backlog, epic map, and dependency graph
- slice-cycle verification output

### Out of scope
- Creating tiny task-level backlog entries outside this wave document.
- Reopening earlier wave acceptance criteria.

## W30-S02 — Alpha architecture decision records
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** The current alpha boundary is captured in ADRs before any target-architecture migration work is queued.
- **Primary modules:** `docs/architecture/**`, `README.md`, `docs/ops/**`, `docs/contracts/**`
- **Hard dependencies:** W30-S01
- **Primary user story surfaces:** ARC-01, ARC-08, OPS-10, SEC-06.

### Local tasks
1. Add an ADR index under `docs/architecture/adr/`.
2. Record the alpha filesystem runtime system-of-record decision for `.aor/`.
3. Record the alpha hybrid module plus HTTP/SSE API transport decision.
4. Record the detachable web console decision that keeps CLI/API as primary operator surfaces.
5. Link ADRs from technical stack, API contract, README, and self-hosted runbook context.

### Acceptance criteria
1. Current and target architecture are separated in docs and runbooks.
2. ADRs explain why W30 does not implement the TypeScript/NestJS/Next.js/Postgres/S3/Temporal-style target.
3. Each ADR includes future migration triggers rather than implying current production dependencies.

### Done evidence
- ADR index and three accepted ADRs
- updated technical stack references
- self-hosted release and API contract links

### Out of scope
- Implementing the future storage, transport, frontend, or workflow engine stack.
- Replacing `.aor/` as the alpha runtime root.

## W30-S03 — Machine-readable detached API contract
- **Epic:** EPIC-6 Operator surface
- **State:** done
- **Outcome:** The current detached HTTP/SSE control-plane routes have an OpenAPI 3.1 contract with drift validation.
- **Primary modules:** `docs/contracts/**`, `examples/control-plane-api/**`, `apps/api/**`, `scripts/**`, tests
- **Hard dependencies:** W30-S02
- **Primary user story surfaces:** OPS-01, OPS-02, OPS-10, SEC-02, SEC-06.

### Local tasks
1. Add an OpenAPI 3.1 artifact for the implemented control-plane HTTP/SSE routes.
2. Add route metadata needed for deterministic route/spec drift checks.
3. Update the narrative API contract and baseline example to reference the OpenAPI artifact.
4. Extend production-readiness checks to validate the OpenAPI artifact against the router.
5. Add targeted tests for missing spec and route drift failure modes.

### Acceptance criteria
1. Every implemented detached route has a matching OpenAPI path, method, route id, permission, and route kind.
2. The OpenAPI artifact documents read routes, run-control mutations, UI lifecycle mutations, lifecycle-command mutations, interaction answers, auth errors, and SSE events.
3. The drift check fails closed if a router route is not represented in the OpenAPI artifact.
4. The spec does not claim unsupported hosted, full CLI-over-HTTP, or future target-stack APIs.

### Done evidence
- OpenAPI 3.1 contract artifact
- API contract doc and baseline example updates
- route/spec drift readiness check
- targeted production-readiness tests

### Out of scope
- Adding new HTTP endpoints.
- Changing CLI behavior or response contracts.
- Generating client SDKs.

## W30-S04 — Self-hosted operations hardening docs
- **Epic:** EPIC-7 Live E2E and rehearsal
- **State:** done
- **Outcome:** Early self-hosted operators can find the alpha environment, secrets, backup/restore, and incident evidence procedures in runbooks.
- **Primary modules:** `docs/ops/**`, `SECURITY.md`, `README.md`
- **Hard dependencies:** W30-S03
- **Primary user story surfaces:** OPS-04, OPS-06, OPS-10, SEC-02, SEC-06.

### Local tasks
1. Add a self-hosted environment matrix for local trusted, production-hardened loopback, connected web, and npm alpha install modes.
2. Add a secrets and redaction guide for bearer tokens, runner credentials, and local redaction values.
3. Add `.aor/` backup and restore guidance for workspace-local evidence.
4. Add a self-hosted incident runbook for preserving evidence and avoiding upstream writes.
5. Update the runbook index, release runbook, README docs map, and security references.

### Acceptance criteria
1. Operators can identify required environment variables, credentials, and commands for each bounded alpha mode.
2. Rollback and incident procedures preserve `.aor/` evidence before cleanup.
3. Backup/restore docs do not claim hosted durability, database recovery, or managed tenant rollback.
4. Security docs point to the production-hardened auth and redaction model.

### Done evidence
- environment matrix runbook
- secrets/redaction runbook
- backup/restore runbook
- self-hosted incident runbook
- updated runbook index and security references

### Out of scope
- Hosted incident response.
- Database backup/restore.
- Enterprise identity or tenant operations.

## W30-S05 — Alpha readiness gate expansion
- **Epic:** EPIC-0 Repository development system
- **State:** done
- **Outcome:** Production readiness reports W30 alpha-hardening evidence and fails closed on missing docs, API spec drift, and unsupported readiness claims.
- **Primary modules:** `scripts/**`, `docs/ops/**`, `docs/contracts/**`, `docs/product/**`, tests
- **Hard dependencies:** W30-S04
- **Primary user story surfaces:** OPS-06, OPS-10, SEC-06, AIP-12, DEV-04.

### Local tasks
1. Extend `pnpm production:ready` with a W30 alpha-hardening check category.
2. Require ADR index, OpenAPI spec, W30 backlog source-of-truth docs, and new self-hosted ops docs.
3. Compare OpenAPI routes with the implemented API router metadata.
4. Preserve fail-closed story-status honesty for blocked OpenCode stories.
5. Add tests for missing OpenAPI, API drift, and dishonest OpenCode story status.

### Acceptance criteria
1. `pnpm production:ready --json` includes reviewable W30 evidence.
2. The gate fails if the OpenAPI artifact is missing or does not cover a router route.
3. The gate fails if DEV-04 or AIP-12 are promoted without real OpenCode proof.
4. The gate does not require live runner credentials and does not write runtime state.

### Done evidence
- production-readiness check update
- targeted production-readiness tests
- unchanged `pnpm check` versus `pnpm production:ready` boundary

### Out of scope
- Moving production readiness into `pnpm check`.
- Running real external providers from the gate.

## W30-S06 — Alpha release and onboarding proof refresh
- **Epic:** EPIC-5 Delivery and release
- **State:** done
- **Outcome:** The npm alpha release path documents and exercises the hardened installed-user smoke boundary.
- **Primary modules:** `docs/ops/**`, `scripts/**`, `docs/product/**`, `package.json`, release tests
- **Hard dependencies:** W30-S05
- **Primary user story surfaces:** OPS-06, OPS-10, PBO-01, PBO-02, PBO-03, SEC-02, SEC-06.

### Local tasks
1. Update the npm alpha release runbook with W30 gate expectations.
2. Extend installed-package smoke coverage to include optional API/web boundary guidance without starting a hosted service.
3. Refresh story matrix evidence for affected operations, security, and onboarding stories.
4. Keep OpenCode blocked until real OpenCode live-baseline proof exists.
5. Keep release docs clear that GA, Docker/GHCR, SaaS, SSO, and default upstream write-back remain out of scope.

### Acceptance criteria
1. Release docs show a minimal reproducible alpha verification path.
2. Smoke coverage separates public operator CLI path from maintainer-only proof fixtures.
3. Story matrix still distinguishes `baseline-covered`, `proof-covered`, and `blocked`.
4. Release workflow docs do not claim GA readiness or unsupported distribution channels.

### Done evidence
- npm alpha release runbook update
- installed-package smoke update
- story coverage evidence refresh
- production-readiness W30 evidence

### Out of scope
- Publishing a new package version.
- Certifying OpenCode.
- Adding Docker/GHCR release channels.
