# W65 default-on and rollback rehearsal

W65-S05 changes both the compiled selector default and local app-config default to `quiet-cockpit`. An explicit `?console=legacy` remains available for the bounded rollback rehearsal.

The installed browser matrix verifies default-on first load, responsive and keyboard operation, and a Quiet → legacy → Quiet history sequence. Project selection remains identical across each switch; the selector is presentation-only and does not repeat lifecycle mutations or create durable artifacts.

No P1 cutover finding is open. The operational stop conditions and package-version rollback boundary are documented in [W65 cutover runbook snapshot (f6de7e31)](https://github.com/GrinRus/ai_native_sdlc_orchestrator/blob/f6de7e3167e74a2fd975deb5736e464cdcffac2f/docs/ops/quiet-cockpit-cutover.md). The legacy branch remains reachable only until W65-S06.
