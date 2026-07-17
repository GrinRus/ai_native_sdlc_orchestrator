# W63 canonical lifecycle closure

## Verdict

W63-S08 closes the bounded `OPS-12` outcome: an operator can complete the
canonical safe no-write lifecycle through the installed opt-in Quiet Cockpit
without a required terminal handoff. The packaged default remains the legacy
renderer until W65.

## Executable evidence

- Journey contract: `apps/web/browser/fixtures/golden-lifecycle.json`
- Contract loader and safety allowlist:
  `apps/web/browser/golden-lifecycle-loader.mjs`
- Installed browser proof: the `canonical no-write lifecycle` case in
  `apps/web/browser/operator-scenarios.spec.mjs`
- Production action boundary: `apps/web/src/operator-control.js`
- Installed acceptance baseline:
  `docs/research/15-w63-installed-console-acceptance.md`

The versioned journey contains fifteen ordered transitions from Workspace and
Project setup through Execution Setup, Mission, Discovery, Specification,
Plan/Approval, Execution, Review/QA, no-write Delivery/Release, Learning, and a
distinct Follow-up Flow. Every transition declares its entry state,
authoritative family, visible label, exact structured operation, recovery path,
and expected evidence family.

The browser test packs and installs the package, launches `aor app` from a
neutral directory with a disposable `AOR_HOME`, and exercises the production
Quiet Cockpit action adapter over same-origin HTTP. It verifies:

- fifteen label-to-mutation matches and fifteen unique durable readback refs;
- reload reconstruction at Mission, Execution, and Learning boundaries;
- one injected stale approval revision followed by a safe retry;
- no duplicate durable outcome after the retry;
- simulation/no-write flags, no external browser network, no target-source
  mutation, and no upstream write;
- the legacy renderer remains selected when the console selector is absent or
  invalid.

## Evidence boundary

This is deterministic installed-user proof using the approved simulation
route. It is not evidence for hosted UI, Windows certification, credentialed
provider breadth, paid judges, target-source editing, or real upstream writes.
Those exclusions remain outside the W63 claim and do not weaken the bounded
safe no-write outcome.

## W65 parity handoff

W65-S01 inherits:

- selector: `?console=quiet-cockpit`;
- journey ID: `quiet-cockpit.safe-no-write.v1`;
- transition IDs and structured-operation allowlist from the golden manifest;
- installed scenario IDs and raw artifact root `.aor/quality/w63/s07/`;
- W63-S07 finding ledger and evidence index;
- this lifecycle closure as the durable action/evidence parity baseline.

W65 may freeze, compare, activate, roll back, and retire presentation paths. It
must not replace missing runtime behavior with browser-owned state or broaden
the no-write proof into an unsupported production claim.
