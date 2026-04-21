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
5. resolve route, wrapper, prompt bundle, and step policy;
6. execute the step through the selected adapter;
7. collect evidence and normalize the step result;
8. run validation;
9. run eval or harness if the step policy requires it;
10. decide whether to close, retry, repair, escalate, or block;
11. if the flow reaches delivery, materialize a delivery manifest;
12. if the flow reaches release, materialize a release packet;
13. if the flow fails materially, open or update an incident path.

## Delivery model
AOR should support these delivery modes:
- patch only
- local branch
- fork branch / fork PR
- controlled direct write for trusted internal projects only

All non-trivial delivery modes should leave a delivery manifest behind.
Delivery-capable runs should execute from an isolated root (`workspace-clone` or `worktree`) rather than mutating the operator's primary checkout directly.

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
