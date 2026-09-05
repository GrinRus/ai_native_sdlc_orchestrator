# Repository cleanup audit

This maintenance audit removes demonstrably unreachable implementation and
retired instructions without changing the supported public runtime contract.
It does not close the remaining W71 installed-journey acceptance gaps.

## Iteration 1: reachability and dependencies

Base: main `18c63473f96d0d1ce9ecc8a014bcc68c0f8116bc`.

- Removed the detached pre-Task console, its exclusive browser fixtures and
  tests, six orphan CLI/harness fixtures, five superseded console documents,
  and two obsolete private maintenance modules. Packaged-app smoke coverage
  remains in `apps/web/test/packaged-task-app.test.mjs`.
- Removed unused CLI imports, private helpers, and unreachable private contract
  validation branches. The public contract kernel remains the authority; private
  rehearsal families and compatibility exports remain available.
- Replaced references to removed historical artifacts with immutable Git blob
  references. Historical screenshots remain where current docs or historical
  evidence still use them; age alone is not a deletion criterion.
- Extended the unused-code check across production JavaScript. The integration
  retains main's checked process runner, path-containment fixes, test partitions,
  guidance checks, and audit-disposition statuses.

Local integration checks passed: lint, TypeScript (zero diagnostics), and quality
ratchets (309 production files, 300 JavaScript modules, 66 public contract
families and 75 effective private families). Full gate and browser acceptance
must pass on the PR revision before merge; these focused results alone do not
establish that result. The PR's CI run is the authoritative merge evidence.

## Remaining review work

Iteration 2 must align active Strategic/finance, Ask AOR, and quality-gate UI
instructions with Task Workspace, and correct FIN-03's W62 proof scope.
Iteration 3 must review the integrated code, documentation, links, and gate
evidence from the updated main. Each iteration is a separate PR; findings remain
open until the corresponding changes and applicable checks are complete.
