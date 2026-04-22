# Target architecture

## Purpose
AOR is a packet-driven control plane for the full SDLC.

## Core principles
1. Packet-first.
2. Contract-first.
3. Runner-agnostic core.
4. Bootstrap before delivery.
5. Validation before evaluation.
6. Harness and certification by default.
7. Bounded execution and bounded write-back.
8. Headless-first runtime with detachable UI.
9. Promotion through evidence.
10. Learning loop from incidents back into datasets and suites.

## System planes
- **Context plane** — project profile, project analysis, prompt bundles, runtime context docs/rules/skills/bundles, and compiled-context artifacts.
- **Workflow plane** — long-running workflows, approvals, orchestration decisions.
- **Execution plane** — checkout, workspace, route resolution, adapters, runner sessions, delivery.
- **Quality plane** — validation, eval, harness, certification, promotion.
- **Operations plane** — query model, live events, logs, incidents, cost and audit.

## Main components
- Control plane API
- CLI
- optional web UI
- orchestrator core
- workflow runtime
- provider-routing module
- adapter SDK
- contracts module
- harness module
- observability module
- persistent stores for metadata and evidence

## Main data flow
1. Bootstrap a project into a machine-usable target.
2. Materialize packets as discovery, planning, and approval progress.
3. Resolve route, wrapper, prompt bundle, context bundle, and step policy for each step, with project profiles as the only default owner for wrapper/prompt/context selection.
4. Compile packet refs, project-analysis facts, and selected runtime context assets into a bounded prompt/context artifact.
5. Execute the bounded step through an adapter-backed runner.
6. Validate outputs, then evaluate or replay when required.
7. Materialize delivery and release artifacts.
8. Feed incidents back into datasets, suites, and promotion decisions.

`AGENTS.md` and `.agents/**` are contributor-facing development guidance for the AOR repository. They are not part of the runtime context plane and must not be treated as injectible runtime assets.
