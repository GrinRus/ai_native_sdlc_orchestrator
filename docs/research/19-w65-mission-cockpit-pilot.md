# W65 Mission and Cockpit pilot

The opt-in pilot reuses the accepted W63 Mission builder, canonical action
adapter, installed scenario catalog, and fifteen-transition golden journey.
No lifecycle command, packet, projection, or evidence owner changes in S03.

The machine-readable matrix
`apps/web/browser/fixtures/w65-mission-cockpit-pilot.json` covers first run,
invalid and complete Mission intake, partial `create -> next` recovery, active
provider work, interactions and decisions, verification and bounded repair,
review and no-write delivery, partial/offline reads, completed inspection, and
follow-up creation. Every scenario records its canonical route, durable
readback, and legacy/Quiet identity assertion.

All six operator action categories are represented. Retry continues from the
existing Mission/request identity, completed source Flows remain immutable,
and follow-up creates distinct Flow and intake refs. Installed browser evidence
remains external-network-free, target-source-free, and no-upstream-write.

No P1 parity finding was discovered. The packaged default remains legacy until
W65-S05.
