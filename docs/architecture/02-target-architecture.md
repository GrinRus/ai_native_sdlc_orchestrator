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
- **Knowledge plane** — project profile, project analysis, packet chain, rules and skills.
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
3. Resolve route, wrapper, prompt bundle, and step policy for each step.
4. Execute the bounded step through an adapter-backed runner.
5. Validate outputs, then evaluate or replay when required.
6. Materialize delivery and release artifacts.
7. Feed incidents back into datasets, suites, and promotion decisions.
