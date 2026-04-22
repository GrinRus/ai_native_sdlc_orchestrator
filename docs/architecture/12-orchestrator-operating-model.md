# Orchestrator operating model

## Purpose
This is the most concrete description of how AOR should operate day to day.

## Core idea
AOR is the durable SDLC control plane that coordinates:
- project context,
- packets,
- approvals,
- routed execution,
- quality evidence,
- delivery transactions,
- platform-asset evolution,
- incident learning.

## Canonical operating units
- **Project profile** — persistent project defaults.
- **Project analysis report** — repeatable onboarding knowledge.
- **Packet chain** — discovery through release.
- **Run and step results** — normalized execution state.
- **Quality evidence** — validation, eval, harness, logs, traces, and diffs.
- **Delivery plan** — pre-write policy decision and gate status.
- **Delivery manifest** — actual delivery transaction.
- **Learning memory** — incidents, datasets, suites, and promotion decisions.

## Standard operating modes
- project bootstrap
- discovery-only
- planning-only
- execution-only from approved handoff
- repair-only from a failed step
- evaluation-only
- harness-only
- full end-to-end rehearsal

## Detailed execution pattern
1. load the project profile and target repository information;
2. analyze or verify the project if required;
3. materialize the next packet boundary;
4. request human approval if the policy requires it;
5. resolve route, wrapper, prompt bundle, skill refs, and step policy;
6. compile working context and inject it into the adapter request envelope;
7. execute the step through the selected adapter;
8. collect evidence and normalize the step result;
9. run validation;
10. run eval or harness if the step policy requires it;
11. decide whether to close, retry, repair, escalate, or block;
12. if the flow reaches delivery, materialize a delivery plan before any write-back path starts;
13. only if the delivery plan is ready, materialize a delivery manifest;
14. if the flow reaches release, materialize a release packet;
15. if the flow fails materially, open or update an incident path.

## Delivery model
AOR should support these delivery modes:
- `no-write`
- `patch-only`
- `local-branch`
- `fork-first-pr`

All non-trivial delivery modes should leave a delivery manifest behind.
Delivery-capable runs should execute from an isolated root (`workspace-clone` or `worktree`) rather than mutating the operator's primary checkout directly.

Policy boundary between rehearsal and delivery:
- rehearsal can proceed in `no-write` mode without handoff/promotion gates;
- non-read-only delivery modes must be blocked unless approved handoff evidence and promotion evidence are both present;
- write-back is allowed only when the delivery plan status is `ready`.

## Asset evolution model
Prompt bundles, wrappers, routes, policies, and adapters evolve on their own lifecycle:
- draft → candidate → stable → frozen/demoted

Promotion must be based on certification evidence, not intuition.

## Incident learning loop
When a run fails or a release causes trouble:
1. create an incident report;
2. link the incident to run, route, wrapper, adapter, and packets;
3. backfill a dataset case;
4. update or create suites;
5. recertify the impacted platform asset before restoring it to stable use.
