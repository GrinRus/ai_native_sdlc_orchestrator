# ADR index

This directory records implemented alpha commitments and accepted designs for
their planned replacement. Each decision states its implementation scope;
accepting a design does not establish that its runtime or target stack is active.

## Accepted decisions

| ADR | Status | Decision | Applies to |
|---|---|---|---|
| `0001-alpha-filesystem-runtime-sor.md` | Superseded by ADR 0021 | Historical repo-local `.aor/` runtime system of record. | Pre-W67 runtime state |
| `0002-alpha-hybrid-api-transport.md` | Accepted | The alpha control plane remains hybrid module plus detached HTTP/SSE transport. | CLI/API boundary, OpenAPI contract, production-hardening gate |
| `0003-alpha-detachable-web-console.md` | Accepted | The web console remains optional and detachable; CLI/API stay primary. | Operator UX, self-hosted release mode, app smoke boundary |
| `0004-alpha-packaged-local-web-console.md` | Accepted | The npm alpha includes a packaged local SPA as a supported installed-user surface while headless operation remains valid. | Installed-user first run, `aor app`, packaged web assets, release smoke |
| `0005-operator-requests-runtime-interventions.md` | Accepted | Operator-initiated interventions are durable runtime-owned `operator-request` artifacts, not direct runner chat. | Ask AOR, request CLI/API, context compilation, proposal/patch evidence |
| `0020-project-topology-and-local-bindings.md` | Accepted | Portable topology is separate from machine-local bindings. | Project, repository, component, and workspace-set identity |
| `0021-central-aor-home-and-portable-project-config.md` | Accepted | Mutable runtime state lives under `~/.aor`; repository `.aor` is explicit portable output only. | Storage, onboarding, evidence, config export |
| `0022-runner-output-acceptance-boundary.md` | Accepted | Strict adapter-backed execution resolves one schema before spawn and keeps process, parsing, validation, verification, and mission outcomes independent. | Runner output, provider work packet v3, adapter capability, Runtime Harness acceptance, repair |

## Accepted W72 design decisions

These decisions are accepted design with implementation pending. Their status
does not promote current alpha behavior or release evidence. The
[Task architecture and complete workshop register](../17-iterative-task-architecture.md)
maps all 19 answers to implementing slices.

| ADR | Status | Decision | Applies to |
| --- | --- | --- | --- |
| [0023](0023-task-authority-and-decisions.md) | Accepted design | Task authority, effective requirements, typed decisions, scoped blockers. | Task domain, adoption, revisions, CLI/API/web |
| [0024](0024-adaptive-preparation-and-criterion-proof.md) | Accepted design | Adaptive preparation, bounded context, independent criterion proof. | Policies, compiler, verification, review |
| [0025](0025-task-runtime-and-filesystem-publication.md) | Accepted design | Modular core, atomic filesystem publication, detached controller and bounded units. | AOR Home, execution, recovery, scheduler |
| [0026](0026-declarative-policy-and-task-budget.md) | Accepted design | Declarative policies and capability-aware cumulative Task budgets. | Profiles, limits, reservations, projections |
| [0027](0027-exact-result-delivery-approval.md) | Accepted design | Separate delivery permission for exact verified output. | Delivery plan/manifest and result review |
| [0028](0028-breaking-task-model-replacement.md) | Accepted design | Complete replacement without old-model compatibility. | W72 contracts, assets, runtime, installed acceptance |

## Historical target-architecture relationship

The target architecture in `docs/architecture/03-technical-stack.md` still
records earlier TypeScript/framework/distributed-storage ideas separately from
the accepted W72 modular Node.js/filesystem design. W72 does not require those
new infrastructure dependencies.

Future migration work should add new ADRs before changing the runtime system of
record, transport framework, web ownership boundary, durable orchestration
model, or operator-request prompt/mutation semantics.
