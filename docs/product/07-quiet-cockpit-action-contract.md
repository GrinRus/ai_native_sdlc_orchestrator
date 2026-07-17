# Quiet Cockpit action contract

Quiet Cockpit presents one control from the durable `next-action-report`. The
control label describes its actual effect; CLI command text remains diagnostic
and is never parsed to select browser behavior.

| Action ID | Operator label | Category | Canonical effect |
| --- | --- | --- | --- |
| `discovery-run` | Create discovery evidence | mutation | `discovery run` lifecycle mutation |
| `spec-build` | Build specification evidence | mutation | `spec build` lifecycle mutation |
| `plan-create` | Create task plan | mutation | `plan create` lifecycle mutation |
| `review-run` | Run review checks | mutation | `review run` for the report-owned run ID |
| `delivery-prepare` | Prepare no-write delivery evidence | mutation | `deliver prepare` with bounded mode |
| `release-prepare` | Prepare release evidence | mutation | `release prepare` with bounded mode |
| `learning-handoff` | Create learning handoff | mutation | `learning handoff` for the report-owned run ID |
| `inspect-active-run` | Inspect active run | workbench | open Journey/execution evidence |
| `review-decide` | Record review decision | workbench | open the typed decision surface |
| `start-new-flow` | Start follow-up Flow | workbench | open a new Mission with source lineage |

Unknown action IDs are unavailable. Legacy reports are projected through the
same bounded action-ID registry; neither `command` nor `low_level_command` is
interpreted. Mutation completion is accepted only after durable control-plane
readback. Ask AOR similarly retains its created request identity when the run
phase fails, so retry resumes that request instead of creating a second one.
