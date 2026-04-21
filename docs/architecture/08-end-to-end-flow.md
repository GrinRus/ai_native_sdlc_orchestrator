# End-to-end flow

## Canonical flow
1. `project init`
2. `project analyze`
3. `project validate`
4. `project verify`
5. intake request
6. discovery packet
7. research / ADR packet
8. spec packet
9. wave ticket
10. handoff packet and approval
11. execution run
12. review and QA
13. delivery manifest
14. release packet
15. incident or close
16. dataset / suite backfill and recertification when needed

## Why bootstrap is a first-class stage
AOR cannot safely run against a repository until it knows:
- its topology,
- its commands,
- its service boundaries,
- its risk zones,
- its missing prerequisites,
- its local verification path.

## Why delivery is not the end
The full loop closes only when:
- delivery artifacts exist,
- sign-offs are recorded,
- incidents can feed back into quality memory,
- platform assets can be recertified if needed.
