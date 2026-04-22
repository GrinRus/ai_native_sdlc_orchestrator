# Routed Rehearsal Transcript (W2-S06)

$ aor project init --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
exit=0
$ aor project analyze --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
exit=0
$ aor handoff prepare --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal
exit=0
$ aor handoff approve --project-ref <AOR_WORKSPACE> --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --handoff-packet <AOR_WORKSPACE>/.aor/w2-s06-rehearsal/projects/aor-core/artifacts/aor-core.handoff.bootstrap.v1.json --approval-ref approval://W2-S06-REHEARSAL
exit=0
$ aor project validate --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --require-approved-handoff --handoff-packet <AOR_WORKSPACE>/.aor/w2-s06-rehearsal/projects/aor-core/artifacts/aor-core.handoff.bootstrap.v1.json
exit=0
$ aor project verify --project-ref <AOR_WORKSPACE> --project-profile <AOR_WORKSPACE>/examples/project.aor.yaml --runtime-root <AOR_WORKSPACE>/.aor/w2-s06-rehearsal --require-validation-pass --routed-dry-run-step implement
exit=0

## Result
- validation_status: pass
- handoff_status: approved
- routed_step_result_file: <AOR_WORKSPACE>/.aor/w2-s06-rehearsal/projects/aor-core/reports/step-result-routed-implement.json
