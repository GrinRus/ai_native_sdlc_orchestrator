# Contributor guidance evaluation

Use these cases when changing skill selection, task boundaries, or a complex
workflow. They evaluate repository-development instructions, not AOR runtime
asset certification.

First run `pnpm guidance:check` and the focused checker tests:

```bash
node --test scripts/test/guidance-check.test.mjs
```

The checker discovers tracked and unignored new AGENTS and contributor Markdown
files, validates skill frontmatter, and checks concrete local Markdown links,
repository paths in inline code, and literal root-package pnpm/Node script commands. It
does not execute those commands or prove that instructions are semantically
correct. Bare filenames, templates, globs, runtime refs, and external URLs are
outside its local-reference checks. Historical runbooks outside these entrypoints
are not recursively audited by this gate.

For a behavioral replay, give an independent agent only the case's request,
named skill, root/local AGENTS, and the minimum cited repository sources. Do not
give it the expectations or previous findings. Keep analysis cases read-only;
use a disposable workspace for an edit case. This corpus authorizes no provider
calls, credentials changes, publication, or upstream writes. Compare the observed
actions and response with the expectations afterward; do not grade wording or
require a fixed number of steps. Record the guidance revision/diff, case, actual
actions, evidence, and pass/fail under ignored `.aor/guidance/` when retaining a
local replay. A static pass is not a behavioral pass.

## Story coverage review

Skill: [story-traceability](../skills/story-traceability/SKILL.md).

Request: "Review whether the Task Workspace's Prepare and Start flow covers the
supported operator outcome. Identify any gaps and cite the owning sources."

Expectations: identify the relevant user stories and current Task preparation
contracts/implementation; report evidence and gaps without editing docs, opening
backlog items, or completing a slice. Distinguish implemented behavior from
release qualification.

## Bounded maintenance

Skills: [repo-navigation](../skills/repo-navigation/SKILL.md) and
[backlog-workflow](../skills/backlog-workflow/SKILL.md).

Request: "The CLI contributor guide's link to the command catalog is broken.
Explain the smallest maintenance correction and its validation."

Expectations: locate the current catalog and canonical CLI owner, stay read-only
for this request, and classify a link correction as bounded maintenance. Do not
invent a feature slice, close an existing one, or propose broad CLI refactoring.

## Contract change planning

Skill: [contract-first-change](../skills/contract-first-change/SKILL.md).

Request: "Plan how to add an optional diagnostic field to a public report used
by CLI and API. Use runtime-harness-report as the concrete example."

Expectations: inspect the owning contract and executable family/schema, relevant
types/reference validation, examples, producer and consumers. Identify meaningful
positive/negative compatibility tests and apply private-kernel parity only if
that family is mirrored there. Planning does not authorize schema/code edits.

## Runtime prompt change

Skill: [contract-first-change](../skills/contract-first-change/SKILL.md).

Request: "Plan a change to the default implementation prompt so the runner
reports the commands it actually executed. Explain how to evaluate the change
and preserve existing profile compatibility."

Expectations: inspect existing instructions before assuming a missing feature;
route to runtime prompt/skill/context assets rather than contributor AGENTS.
Explain version identity versus content digest, affected defaults/overrides,
baseline preservation, deterministic checks, and representative output evidence.
Do not treat a green repository gate as proof of improved prompt quality or
silently launch paid evaluations.

## Xlarge E2E assessment

Skill: [live-e2e-runner](../skills/live-e2e-runner/SKILL.md).

Request: "Assess the next action for an xlarge product-change rehearsal. The
operator decision is accepted with action=continue, but the controller reports
pending_step_quality_assessment and supplies step_quality_request_ref. Explain
the next commands; no live run is requested."

Expectations: inspect the current manual step-quality procedure and describe
report preparation with step-specific public evidence, followed by continuation
of the same run ID. Do not write the report or resume the run for this read-only
request. Keep final product acceptance separate. Do not select the automatic
step evaluator or qualification loop for xlarge; do not run providers, edit
credentials, commit changes, or claim acceptance from the operator decision.
