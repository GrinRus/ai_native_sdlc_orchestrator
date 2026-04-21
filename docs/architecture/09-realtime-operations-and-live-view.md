# Realtime operations and live view

## Purpose
Operators need live state without making the UI part of the critical path.

## Design rules
- the runtime must stay headless-first;
- the API and event stream must work without the web UI;
- the UI can attach late and catch up from the read model plus the live stream;
- detaching the UI must not change workflow state.

## Live signal types
- run and step lifecycle events
- route and policy decisions
- approval requests
- validation, eval, and harness outcomes
- delivery and release milestones
- incident creation and follow-up actions

## Operator surfaces
- CLI for direct operational control
- optional web UI for dashboards and drill-down views
- API queries for automation and integrations
