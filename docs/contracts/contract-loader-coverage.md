# Contract loader coverage

This table maps documented contracts to loader coverage for `W0-S02`.

| Contract family | Source contract | Loader family key | Example glob | Status | Notes |
|---|---|---|---|---|---|
| Core packets and profiles | `project-profile.md` | `project-profile` | `examples/project*.aor.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `project-analysis-report.md` | `project-analysis-report` | `examples/project-analysis-report.sample.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `artifact-packet.md` | `artifact-packet` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Core packets and profiles | `wave-ticket.md` | `wave-ticket` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Core packets and profiles | `handoff-packet.md` | `handoff-packet` | `examples/packets/handoff-*.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `release-packet.md` | `release-packet` | `examples/packets/release-*.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `delivery-manifest.md` | `delivery-manifest` | `examples/delivery-manifest*.yaml` | implemented | Required fields + top-level type checks. |
| Core packets and profiles | `incident-report.md` | `incident-report` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Execution and quality | `step-result.md` | `step-result` | none | implemented | Includes closed-set enum check for `step_class`. |
| Execution and quality | `validation-report.md` | `validation-report` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Execution and quality | `evaluation-report.md` | `evaluation-report` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Execution and quality | `dataset.md` | `dataset` | `examples/eval/dataset-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `evaluation-suite.md` | `evaluation-suite` | `examples/eval/suite-*.yaml` | implemented | Required fields + top-level type checks. |
| Execution and quality | `promotion-decision.md` | `promotion-decision` | none | implemented | Includes closed-set enum checks for promotion channels. |
| Platform assets | `provider-route-profile.md` | `provider-route-profile` | `examples/routes/*.yaml` | implemented | Required fields + top-level type checks. |
| Platform assets | `wrapper-profile.md` | `wrapper-profile` | `examples/wrappers/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `prompt-bundle.md` | `prompt-bundle` | `examples/prompts/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `step-policy-profile.md` | `step-policy-profile` | `examples/policies/*.yaml` | implemented | Includes closed-set enum check for `step_class`. |
| Platform assets | `adapter-capability-profile.md` | `adapter-capability-profile` | `examples/adapters/*.yaml` | implemented | Required fields + top-level type checks. |
| Operations | `live-run-event.md` | `live-run-event` | none | implemented | Contract is loader-covered; no YAML example in this repo yet. |
| Operations | `live-e2e-profile.md` | `live-e2e-profile` | `examples/live-e2e/*.yaml` | implemented | Required fields + top-level type checks. |
| Operations | `control-plane-api.md` | `control-plane-api` | none | limitation | Narrative contract; no YAML schema in `W0-S02`. TODO: add machine-loadable shape in a dedicated schema slice. |
