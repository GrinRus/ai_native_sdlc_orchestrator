# System of record and core entities

## Purpose
AOR needs a canonical data model for durable orchestration state.

## Durable entities
- **Project profile** — persistent configuration for a target project.
- **Project analysis report** — discovered facts about repo shape, commands, risk zones, and missing prerequisites.
- **Artifact packet** — discovery, research, ADR, spec, review, and other artifact-oriented outputs.
- **Wave ticket** — bounded execution unit derived from a spec.
- **Handoff packet** — approved execution boundary for runner-backed work.
- **Step result** — normalized result of one step.
- **Validation report** — deterministic quality evidence.
- **Evaluation report** — suite-based or grader-based quality evidence.
- **Delivery manifest** — durable delivery transaction.
- **Release packet** — release-ready summary of a completed wave.
- **Promotion decision** — certification result for a platform asset.
- **Incident report** — failure summary linked back to runs and assets.

## Read/write split
- PostgreSQL stores metadata, lifecycle state, references, and query projections.
- Object storage stores large evidence blobs such as logs, diffs, screenshots, reports, and transcripts.

## Why this matters
Without a durable system of record, AOR cannot safely support:
- pause/resume,
- replay and certification,
- approvals,
- delivery traceability,
- incident learning,
- auditability across runner changes.
