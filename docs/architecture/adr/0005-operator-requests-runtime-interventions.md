# ADR 0005: Operator requests as runtime-owned interactive interventions

## Status

Accepted for W32 operator-request runtime flow.

## Context

AOR already supports runtime-initiated interaction through
`step-result.requested_interaction` and `aor run answer`. Operators also need
to ask AOR for bounded help from any stage: analyze evidence, explain state,
revise or create documents, repair, validate, plan, implement, or review.

Letting UI or CLI send free-form chat directly to a runner would bypass
packet-first state, policy validation, context compilation, evidence refs, and
headless operation.

## Decision

Operator-initiated work is represented as a durable `operator-request`
contract. CLI, API, and web create the same artifact, validate target refs,
allowed paths, intent, stage, and delivery mode, and run it through the
existing routed runtime.

`request run` compiles `packet://operator-request@...` into the selected step
context and overlays `context-bundle://context.bundle.operator-intervention@v1`.
The existing prompt bundle for the selected step remains the primary prompt
source; AOR does not add a separate chat prompt system in v1.

Default delivery mode is `no-write`. Document edit intents create proposal
evidence, and `patch-only` creates patch evidence inside explicit allowed
paths. V1 does not silently mutate source files from the operator request
path.

## Consequences

- `run steer` remains a run-control transition and does not accept arbitrary
  request text.
- Read surfaces return sanitized summaries and refs; raw request text lives in
  the durable request artifact.
- Successful request runs link `operator_request_ref`, step-result,
  compiled-context, proposal/patch refs, and refreshed next-action evidence.
- The local web Ask AOR drawer, CLI commands, and detached HTTP routes stay
  aligned because they all call shared runtime code.

## Migration triggers

Open a new ADR before adding direct source mutation from operator requests,
introducing a separate prompt compiler for operator chat, or letting hosted UI
state replace durable `.aor/` request evidence.
