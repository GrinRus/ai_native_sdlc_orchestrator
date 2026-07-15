# W58 implementation slices

W58 repairs runtime truthfulness after the W57 trust boundary is stable. It
makes read models non-materializing, context and quality evidence effective,
routes and policies executable, run lifecycle asynchronous, and the loopback
control plane safe for the packaged local console.

W58 keeps the web topology decision from W57: the React bundle is a same-origin
client of `aor app`, not a hosted or arbitrary-remote client. Security work in
this wave belongs primarily to the shared launcher/HTTP boundary; frontend
authentication and hosted deployment remain deferred.

Priorities use the audit remediation scale (`P0` release blocker, `P1` next
repair lane, `P2` planned). Effort estimates use `XS/S/M/L/XL` and include
contracts, implementation, regression tests, and source-of-truth documentation.

## W58-S01 — Non-materializing read-model contract and runtime

- **Outcome:** Every query surface can inspect a clean project without creating
  `.aor`, profiles, reports, packets, or workflow state.
- **Epic:** EPIC-1, EPIC-6
- **State:** done
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** `docs/contracts/control-plane-api.md`, read-model services,
  HTTP read handlers, CLI/API/web fixtures
- **Hard dependencies:** W57-S08
- **Primary user story surfaces:** PBO-05, PBO-09, OPS-01.
- **Audit findings:** AUD-019.

### Local tasks
1. Define stable uninitialized/empty response shapes for project state, runs,
   packets, flows, requests, and quality/evidence queries.
2. Introduce a non-materializing read context that resolves paths and existing
   state without calling project initialization.
3. Remove `initializeProjectRuntime` and all implicit writes from GET/list/read
   service call chains.
4. Keep explicit onboarding/initialization exclusively behind mutation commands
   with durable audit evidence.
5. Add a clean-target byte snapshot harness covering module API, HTTP routes,
   packaged SPA first load, and CLI read commands.
6. Document compatibility for consumers that previously received implicitly
   generated bootstrap artifacts.

### Acceptance criteria
1. `/`, `/app-config.json`, every GET route, and every module read operation leave
   a clean target byte-for-byte unchanged.
2. Uninitialized responses are deterministic, schema-valid, and explicitly carry
   `initialized=false` or the equivalent owning-contract state.
3. The initial SPA request sequence does not create `.aor` before the user invokes
   the initialization mutation.
4. Explicit initialization still produces the same valid runtime artifacts once.
5. Read failures never fall back to initialization as recovery.

### Done evidence
- updated read/query contracts and OpenAPI response examples
- clean-target module/HTTP/browser non-mutation tests
- explicit initialization compatibility tests
- package app-smoke first-load evidence
- `pnpm check`

### Out of scope
- Changing the visual first-run design.
- Remote/hosted project discovery.
- Transactional initialization internals already owned by W57-S06.

## W58-S02 — Effective context and unique asset identity

- **Outcome:** Every declared context, rule, skill, and asset reference resolves
  uniquely, contributes normalized content to the provider input, and changes the
  compiled fingerprint when its effective content changes.
- **Epic:** EPIC-1, EPIC-3, EPIC-4
- **State:** ready
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** context/asset contracts, reference registry,
  `packages/orchestrator-core/src/asset-loader.mjs`, context compiler,
  `packages/adapter-sdk/**`, examples/tests
- **Hard dependencies:** W57-S08
- **Primary user story surfaces:** DIS-02, ARC-02, ARC-04, DEV-07, AIP-01,
  AIP-02, PBO-06, SEC-04.
- **Audit findings:** AUD-018, AUD-028, AUD-052.

### Local tasks
1. Extend reference-integrity validation to every default/override skill, context
   doc, context rule, bundle, route, wrapper, prompt, and policy ref.
2. Reject duplicate canonical asset identities unless byte-identical and
   explicitly layered by a documented precedence contract.
3. Compile bounded normalized asset content or immutable readable attachments,
   not only IDs/URIs, into the provider request.
4. Include content digests, compiler revision, source provenance, and effective
   ordering in compiled-context fingerprints.
5. Align bundled/materialized registry roots and remove unused copied context
   output or make it an active validated root.
6. Add missing/wrong-family/duplicate/content-change/provider-packet fixtures.

### Acceptance criteria
1. Missing or wrong-family skill/context refs fail before provider invocation.
2. Two differing assets with one identity fail deterministically on every
   supported filesystem ordering.
3. The provider work packet contains the effective safety rule content or an
   immutable attachment that the runner can read.
4. Changing rule content with a stable ID changes the compiled fingerprint and
   invalidates stale certification/replay evidence.
5. Every materialized context asset has traced registry provenance and a consumer.

### Done evidence
- updated asset/context contracts and examples
- complete reference-integrity matrix
- duplicate identity and ordering tests
- provider packet/content fingerprint tests
- bundled/materialized parity proof

### Out of scope
- Arbitrary remote asset registries.
- Unbounded provider context expansion.
- UI authoring for context assets.

## W58-S03 — Executable route fallback, retry, repair, and adapter semantics

- **Outcome:** Resolved routes preserve fallback and policy references, and
  requested/effective model semantics, retry/repair/adapter decisions, and
  fallback transitions execute exactly as recorded without erasing structured
  denial evidence.
- **Epic:** EPIC-3, EPIC-4, EPIC-7
- **State:** ready
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** route/policy contracts, `packages/provider-routing/**`,
  step execution, `packages/adapter-sdk/**`, examples/tests
- **Hard dependencies:** W57-S08
- **Primary user story surfaces:** ARC-02, DEV-01, DEV-05, EMP-07, AIP-03,
  AIP-04, PBO-10, OPS-03, SEC-04.
- **Audit findings:** AUD-024, AUD-025, AUD-026.

### Local tasks
1. Preserve ordered fallback candidates, retry policy refs, and repair policy refs
   in the resolved route contract and durable evidence.
2. Validate fallback capability compatibility and define allowed transition,
   exhaustion, escalation, and terminal-block semantics.
3. Make `retry.on[]` and `repair.on[]` executable predicates; unlisted failure
   classes follow an explicit block/escalate path.
4. Normalize provider streams into semantic events before presentation redaction
   so denials, interaction requests, packet echo, and terminal reports survive.
5. Keep adapter-specific parsing at the adapter boundary while emitting one
   runner-neutral failure vocabulary.
6. Add failure-class × route × budget × provider-format matrix tests.
7. Add `requested_model`, `effective_model`, and `model_source` to resolved
   route and execution evidence, distinguishing an explicit concrete model, a
   policy-approved alias, and an adapter/runner default.
8. Pass `effective_model` through the adapter-owned invocation boundary and
   reject unsupported model/capability combinations before process spawn or
   budget consumption.
9. Capture fake-runner argv/config and preserve the exact provider, adapter, and
   model transition for primary and fallback attempts so durable route evidence
   can be compared with what actually executed.

### Acceptance criteria
1. A transient allowed failure selects the next compatible fallback exactly once
   and records the transition.
2. Missing/incompatible/disallowed fallback blocks without silently retrying the
   same primary route.
3. A repair policy limited to `tests-failed` cannot run for
   `security-boundary` or any unlisted class.
4. Structured Qwen and other provider denials always produce a blocked response
   with a stable failure kind while public output remains redacted.
5. Route, retry, repair, and adapter evidence remains provider-neutral outside
   adapter-owned raw artifacts.
6. Route resolution records requested/effective model and source without
   conflating explicit values, aliases, or runner defaults.
7. The adapter invokes the runner with the recorded effective model; an
   unsupported model or capability fails before spawn and creates no execution
   or budget side effect.
8. Primary and fallback evidence records the exact provider/adapter/model
   transition and matches the captured runner argv/config.

### Done evidence
- route/policy contract and example updates
- fallback state-machine tests
- failure-class policy matrix
- cross-provider semantic normalization fixtures
- adapter boundary regression checks
- requested/effective-model resolution and unsupported-model fixtures
- fake-runner invocation/evidence parity captures

### Out of scope
- Certifying every external provider as production-ready.
- Provider-owned authentication behavior.
- Unlimited automatic retry or repair budgets.
- Raw arbitrary model selection or execution-profile UI, which are owned by W61.

## W58-S04 — Real evaluation, Harness lineage, and replay compatibility

- **Outcome:** Evaluation and certification resolve real immutable cases, bind
  strictness to the owning run, and reject replay when effective content or
  execution versions differ.
- **Epic:** EPIC-4
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** XL
- **Primary modules:** evaluation/Harness contracts,
  `packages/harness/**`, eval runner, Runtime Harness reports,
  certification decision, replay tests
- **Hard dependencies:** W57-S05, W58-S02, W58-S03
- **Primary user story surfaces:** PSO-05, ARC-03, ARC-04, RQA-03, RQA-04,
  AIP-05, AIP-06, AIP-07, OPS-05.
- **Audit findings:** AUD-009, AUD-010, AUD-012, AUD-027.

### Local tasks
1. Define immutable subject/input/expected case resolution and fail closed when a
   referenced artifact is absent, stale, mutable, or wrong-family.
2. Replace placeholder deterministic and pairwise scoring with real assertions
   and an isolated judge interface that consumes the actual case/subject content.
3. Bind mission strictness and every run-level decision to the exact intake/run
   lineage rather than project-wide filesystem mtime.
4. Extend capture/replay compatibility with context/content hashes, compiler
   revision, route/policy/adapter versions, environment, and case digests.
5. Enforce run-level evidence when delivery/certification requests it and reject
   soft or step-only reports.
6. Add controlled mutation, cross-run, changed-content, missing-case, and strict
   delivery truth-table tests.

### Acceptance criteria
1. Missing or contradictory critical cases fail evaluation and certification.
2. Controlled subject/expected mutations change the scorer verdict and can never
   retain a synthetic constant pass.
3. Interleaved runs retain independent mission profiles regardless of file mtime.
4. Same-ID changed content/version returns replay-incompatible.
5. Strict delivery accepts only a closed, run-owned, run-level pass with complete
   routed transitions and meaningful-path evidence.

### Done evidence
- updated eval/Harness/certification contracts and examples
- real scorer and judge interface fixtures
- mutation and missing-reference tests
- interleaved-run lineage tests
- replay compatibility manifest tests

### Out of scope
- Paid judge calls as a required root test.
- Certifying every external model/provider.
- Replacing deterministic validation with judge-only evaluation.

## W58-S05 — Asynchronous run jobs and durable live-event delivery

- **Outcome:** Starting a run returns control immediately, workers execute
  asynchronously, and CLI/API/SSE can observe, pause, answer, or cancel the same
  durable run across process boundaries.
- **Epic:** EPIC-3, EPIC-6
- **State:** ready
- **Remediation priority:** P0
- **Estimated effort:** XL
- **Primary modules:** lifecycle command service, run worker/supervisor,
  observability journal, SSE transport, CLI follow, tests
- **Hard dependencies:** W57-S08
- **Primary user story surfaces:** EMP-05, DEV-01, OPS-01, OPS-02, OPS-04,
  OPS-10.
- **Audit findings:** AUD-006, AUD-021, AUD-032, AUD-033, AUD-034.

### Local tasks
1. Define durable job/start/worker/terminal/cancel ownership and IPC contracts.
2. Make HTTP run start return an accepted response plus run ID without executing
   the provider synchronously in the server event loop.
3. Run external processes asynchronously with bounded process-group cleanup,
   heartbeat, cancellation, pause, and interaction continuation.
4. Deliver live events across API/worker/CLI processes through journal tailing or
   a durable broker cursor, not a module-local emitter only.
5. Implement true long-running `run status --follow` with cursor reconnect and
   signal cleanup.
6. Bound replay, emitter/subscription lifetime, slow-client backpressure, and
   server shutdown.
7. Add active-run responsiveness, separate-process delivery, reconnect, slow
   client, and shutdown tests.

### Acceptance criteria
1. During a five-second fake provider, state GET, SSE heartbeat, pause, answer,
   and cancel remain responsive in the same server process.
2. An event appended by a separate worker appears live and exactly once in the
   connected API/CLI stream.
3. `maxReplay=0` returns no replay, positive replay is server-capped, and large
   logs are not fully retained in memory.
4. Server shutdown completes within a bound with active streams and releases all
   listeners/subscriptions.
5. `run status --follow` observes later events and terminates cleanly on SIGINT.

### Done evidence
- durable job/lifecycle contract and worker tests
- event-loop responsiveness probe
- separate-process SSE/CLI follow tests
- replay/backpressure/shutdown stress tests
- process-group cancellation evidence

### Out of scope
- Distributed multi-host scheduling.
- Hosted websocket infrastructure.
- Credentialed provider qualification.

## W58-S06 — Canonical API, OpenAPI, CLI, and service boundary

- **Outcome:** The module API, detached routes, OpenAPI, CLI flags, lifecycle
  service, limits, redaction, and operator errors describe and execute one
  unambiguous surface.
- **Epic:** EPIC-0, EPIC-6
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** `apps/api/**`, `apps/cli/**`, control-plane services,
  `docs/contracts/control-plane-api.openapi.json`, production-readiness tests
- **Hard dependencies:** W58-S01, W58-S05
- **Primary user story surfaces:** ARC-06, PBO-10, OPS-01, OPS-02, OPS-04,
  OPS-09, OPS-11, OPS-12, SEC-02, SEC-06, FIN-04.
- **Audit findings:** AUD-032, AUD-035, AUD-036, AUD-037, AUD-038, AUD-045,
  AUD-048.

### Local tasks
1. Choose one canonical operator-request/read implementation and replace ambiguous
   star exports with explicit public module exports.
2. Type actual success/error/nullable/array response shapes and supported query
   parameters in OpenAPI, including limits and SSE cursors.
3. Validate captured module/HTTP fixtures against OpenAPI in readiness tests
   instead of checking route names and marker metadata only.
4. Derive allowed/repeatable CLI and lifecycle flags from one command catalog and
   reject unknown flags with stable suggestions/errors.
5. Enforce list/replay default and maximum limits consistently before parsing and
   output materialization.
6. Route `aor app --json` through shared redaction for success, compact, and error
   output.
7. Extract a transport-neutral lifecycle application service so HTTP, CLI, and
   app launcher do not form an ESM cycle.
8. Define one operator-facing error envelope across module, HTTP, CLI JSON, and
   app transports with `code`, `title`, `detail`, `operation`, `phase`,
   `resource`, `consequence`, `retryable`, scoped project/flow/run references,
   `field_errors[]`, `evidence_refs[]`, and `recovery_actions[]`.
9. Constrain recovery actions to `retry`, `refresh`, `inspect`,
   `select_project`, `rebind_repository`, `configure_execution`,
   `copy_command`, and `continue_in_terminal`; require typed action payloads and
   prohibit UI recovery logic from parsing shell commands, stack traces, or raw
   provider text.

### Acceptance criteria
1. Every documented operation imports from `apps/api` with no ambiguous export.
2. Captured success and error fixtures for every route validate against OpenAPI.
3. `limit=2` returns at most two items; defaults and maximums are contract-aligned.
4. Unknown/typo flags return CLI exit 1 or HTTP 400 without invoking handlers.
5. Configured secret values never appear in app JSON, denials, or errors.
6. Madge reports no control-plane/app-launcher cycle and transports do not import
   one another.
7. Captured module, HTTP, CLI JSON, and app errors expose the same required
   envelope fields, scoped references, redaction, and retry semantics.
8. Every advertised recovery action belongs to the canonical catalog and is
   selected from structured failure state rather than inferred from diagnostic
   text.

### Done evidence
- explicit API export-surface tests
- OpenAPI fixture validation suite
- limit and unknown-flag tests
- app JSON redaction tests
- cross-transport operator-error envelope fixtures
- recovery-action catalog and diagnostic-text non-inference tests
- zero-cycle dependency report

### Out of scope
- Generating public SDKs for unsupported APIs.
- Hosted API gateway or enterprise identity integration.
- Removing documented compatibility wrappers without a migration decision.
- Visual presentation of recovery cards or lifecycle actions, which is owned by
  W59 and W63.

## W58-S07 — Loopback-only local app transport boundary

- **Outcome:** The packaged local console remains login-free and same-origin, but
  a LAN host, foreign web origin, DNS-rebinding Host, malformed body, or oversized
  request cannot invoke or steer its local mutation handlers.
- **Epic:** EPIC-6
- **State:** blocked
- **Remediation priority:** P0
- **Estimated effort:** M
- **Primary modules:** packaged-local-console ADR, control-plane HTTP contract,
  app launcher, HTTP auth/utils/transport, app config, tests/runbooks
- **Hard dependencies:** W58-S01, W58-S06
- **Primary user story surfaces:** ARC-06, PBO-09, OPS-04, OPS-10, OPS-11,
  SEC-06.
- **Audit findings:** AUD-020, AUD-046.
- **Trust assumption:** Processes running under the same trusted OS account and
  intentional local non-browser clients are inside the supported local boundary;
  loopback binding is not presented as authorization against hostile local code.

### Local tasks
1. Permit local-trusted app binding only to literal loopback addresses and reject
   non-loopback before `listen` or any runtime write.
2. Validate Host before static/config/API routing and build app config from the
   known listener address rather than the request Host header.
3. Require same-origin browser mutations, reject foreign/null Origin as defined by
   contract, and preserve compatible non-browser CLI/curl calls without enabling
   foreign credentialed CORS.
4. Require supported JSON media types for mutation routes.
5. Add a bounded incremental body reader, request deadline, `413`, and handler
   non-invocation guarantees.
6. Serve app config through shared redaction/no-store behavior without exposing
   unnecessary absolute paths before authorization.
7. Add loopback, IPv4/IPv6, Host, Origin, media type, body-size, and zero-artifact
   rejection tests.

### Acceptance criteria
1. `aor app --host 0.0.0.0` and other non-loopback local-trusted binds fail before
   listening and leave the target unchanged.
2. Spoofed Host returns 400; foreign/null browser Origin returns 403; text/plain
   JSON returns 415; oversized bodies return 413.
3. Every rejected request leaves `.aor` unchanged and never invokes a mutation
   handler.
4. The normal same-origin SPA remains usable without a bearer login or token in
   browser storage.
5. The detached production-hardened API remains headless and bearer-protected as
   documented, without requiring the SPA.
6. The threat model states that same-account local processes are trusted and that
   any future untrusted-local, LAN, remote, or hosted mode requires a new ADR and
   stronger authentication boundary.

### Done evidence
- updated local-console ADR, contract, OpenAPI notes, and environment matrix
- IPv4/IPv6 loopback launch tests
- Host/Origin/media-type/body-limit rejection tests
- same-origin packaged SPA mutation smoke
- app-config redaction/no-store tests

### Out of scope
- Hosted or arbitrary-remote SPA deployment.
- Login/logout, browser session management, bearer refresh/rotation, OAuth/OIDC,
  SSO, RBAC, multi-user or multi-tenant authorization.
- TLS termination, reverse-proxy trust, credentialed CORS, WAF, public rate
  limiting, managed retention, or hosted CSP/domain policy.

## W58-S08 — Runtime-quality acceptance proof

- **Outcome:** W58 closes with one deterministic proof that read-only behavior,
  context/evaluation truth, asynchronous control, canonical APIs, and loopback
  transport match their contracts.
- **Epic:** EPIC-0, EPIC-7
- **State:** blocked
- **Remediation priority:** P1
- **Estimated effort:** L
- **Primary modules:** cross-package integration tests, package smoke, proof
  fixtures, audit ledger, readiness/docs
- **Hard dependencies:** W58-S02, W58-S03, W58-S04, W58-S05, W58-S06, W58-S07
- **Primary user story surfaces:** OPS-06, OPS-07, FIN-03.
- **Audit findings:** W58 closure for AUD-006, AUD-009, AUD-010, AUD-012,
  AUD-018 through AUD-021, AUD-024 through AUD-028, AUD-032 through AUD-038,
  AUD-045, AUD-046, the control-plane cycle portion of AUD-048, and the
  effective-context portion of AUD-052. Web behavior AUD-039 through AUD-044,
  dependency hygiene AUD-047, and the remaining refactoring work close in W59.

### Local tasks
1. Build a clean temporary-project integration profile covering first read,
   explicit init, routed execution, real deterministic eval, live stream, cancel,
   API/CLI parity, and local browser mutation.
2. Run controlled content/ref/failure mutations and prove gates fail closed.
3. Run separate-process event delivery and active-run responsiveness checks.
4. Validate all captured HTTP/module fixtures against OpenAPI and contract loaders.
5. Re-run package dry-run/install/app smoke and dependency audit.
6. Reconcile audit IDs, story evidence, readiness output, and remaining W59 work.

### Acceptance criteria
1. The integration profile passes without paid calls, credentials, external
   writes, or implicit initialization.
2. Missing evidence, changed content, unlisted failure classes, and foreign-origin
   requests each fail for the expected reason.
3. API, CLI, SSE, worker, and SPA observe one durable run consistently.
4. Package smoke proves the installed SPA assets, app config, loopback routes,
   first read, and one explicit same-origin mutation; reusable browser state,
   accessibility, reconnect, and failure certification remains assigned to
   W59-S01 rather than being inferred from marker text.
5. The closure report maps every W58 audit ID to reproducible evidence and leaves
   maintainability/UI work explicitly assigned to W59.

### Done evidence
- W58 deterministic integration profile and transcripts
- mutation/fail-closed result matrix
- OpenAPI/contract validation results
- package install/app smoke and dependency audit
- updated audit disposition and `pnpm slice:gate`

### Out of scope
- Credentialed provider certification or real upstream delivery.
- Hosted frontend deployment proof.
- Broad browser/component behavior certification, owned by W59-S01.
- Broad decomposition/maintainability work owned by W59.
