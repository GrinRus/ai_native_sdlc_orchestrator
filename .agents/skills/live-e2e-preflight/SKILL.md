---
name: live-e2e-preflight
description: Use when you need to prepare, review, or update a live E2E rehearsal profile for AOR.
---

1. Start with `docs/ops/live-e2e-target-catalog.md`.
2. Confirm the target repo shape, setup commands, and verification commands.
3. Make sure upstream write-back is disabled unless a fork is explicitly configured.
4. Choose the smallest matching profile: regress short, regress long, release short, or release long.
5. Ensure the profile objective, budgets, gates, and outputs match the intended rehearsal.
