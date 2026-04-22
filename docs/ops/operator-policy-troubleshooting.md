# Runbook: operator policy troubleshooting sequence

## Scope
Use this runbook when operators need route/policy decision visibility for one run without scraping raw runtime logs.

## Step 1: open selected-run status
```bash
aor run status \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID>
```

Expected signals:
- `run_summaries[]` includes the selected run.
- `run_summaries[].policy_context` includes route IDs, policy IDs, write-back modes, and governance decision rollups.
- `run_event_history` and `run_policy_history` are present for the selected run.

## Step 2: inspect bounded event history context
Review:
- `run_event_history.events[].event_type`
- `run_event_history.events[].sequence`
- `run_event_history.events[].policy_context`

Expected use:
- validate control action risk tier and approval requirement context from event payloads;
- confirm ordering via `sequence` before moving to live follow mode.

## Step 3: inspect route/policy decision history
Review:
- `run_policy_history.entries[].source` (`step-result` or `delivery-plan`)
- `run_policy_history.entries[].route_id`
- `run_policy_history.entries[].policy_id`
- `run_policy_history.entries[].governance_decision`
- `run_policy_history.entries[].governance_reasons[]`

Expected use:
- identify when governance changed (`allow|deny|escalate`);
- connect decision reasons to durable artifacts through `artifact_ref`.

## Step 4: switch to live follow when needed
```bash
aor run status \
  --project-ref <PROJECT_ROOT> \
  --run-id <RUN_ID> \
  --follow true \
  --after-event-id <LAST_EVENT_ID> \
  --max-replay 50
```

Expected signals:
- replay begins after `after-event-id`;
- new warnings and terminal states remain visible through `replay_events` and stream updates.

## Step 5: escalate with incident/audit surfaces
When policy history or event context indicates unresolved risk, continue with:
- `aor incident open --project-ref <PROJECT_ROOT> --run-id <RUN_ID> --summary "<TEXT>"`
- `aor audit runs --project-ref <PROJECT_ROOT> --run-id <RUN_ID>`

This keeps troubleshooting evidence linked to incident and audit workflows.
