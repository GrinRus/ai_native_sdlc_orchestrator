# Realtime operations and live view

## Purpose
Operators need live state without making the UI part of the critical path.

## Design rules
- the runtime must stay headless-first;
- the API and event stream must work without the web UI;
- the UI can attach late and catch up from the read model plus the live stream;
- detaching the UI must not change workflow state.
- connected UI actions must call control-plane command mutations and must not own orchestration decisions.

## Live signal types
- run and step lifecycle events
- route and policy decisions
- approval requests
- runner-requested questions and answer audit refs
- validation, eval, and harness outcomes
- delivery and release milestones
- incident creation and follow-up actions

## Operator surfaces
- CLI for direct operational control
- optional web UI for dashboards and drill-down views
- API queries for automation and integrations

## Interactive continuation
When a runner asks a question, AOR treats it as a run continuation boundary:
- the routed step persists `step-result.requested_interaction` with a query-safe summary and evidence refs;
- live events announce the requested, answered, resumed, or blocked state without raw answer text;
- operator answers flow through a control-plane command path that writes answer audit evidence first;
- the runtime resumes from the recorded boundary or stays blocked with explicit evidence refs and reason codes.

The web UI may render the question and submit the answer, but it must not decide how to resume the run or store unaudited answer state.
