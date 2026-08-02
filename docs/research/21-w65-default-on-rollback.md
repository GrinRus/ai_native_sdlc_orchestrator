# W65 default-on and rollback rehearsal

W65-S05 changes both the compiled selector default and local app-config default to `quiet-cockpit`. An explicit `?console=legacy` remains available for the bounded rollback rehearsal.

The installed browser matrix verifies default-on first load, responsive and keyboard operation, and a Quiet → legacy → Quiet history sequence. Project selection remains identical across each switch; the selector is presentation-only and does not repeat lifecycle mutations or create durable artifacts.

No P1 cutover finding is open. The operational stop conditions and package-version rollback boundary are documented in `docs/ops/quiet-cockpit-cutover.md`. The legacy branch remains reachable only until W65-S06.
