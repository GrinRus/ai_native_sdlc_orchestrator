# W4-S06 public-target delivery rehearsal transcript (sample)

## Scope
- Target A: `sindresorhus/ky` (`release-short`, `patch-only`)
- Target B: `belgattitude/nextjs-monorepo-example` (`release-long`, `fork-first-pr`)
- Safety boundary: `write_back_to_remote=false`

## Run A — success path (`ky`)
1. Preflight completed (`clone -> inspect -> analyze -> validate -> verify -> stop`).
2. Delivery rehearsal executed in `patch-only` mode.
3. Durable artifacts produced:
   - `ky-release-short.delivery-manifest.sample.json`
   - `ky-release-short.release-packet.sample.json`
4. Checkpoint result: pass (all manifest/release lineage fields present).

## Run B — failure path (`nextjs-monorepo-example`)
1. Preflight completed.
2. Delivery rehearsal planned in `fork-first-pr` mode.
3. Failure injected at credential/permission checkpoint (simulated missing fork push permission).
4. Durable recovery evidence produced:
   - `nextjs-release-long.delivery-transcript-failure.sample.json`
   - `nextjs-release-long.release-packet-failure.sample.json`
5. Checkpoint result: blocked (release packet status `blocked`, transcript includes `recovery_steps`).

## Human checkpoint outcomes
- Do not request production write-back policy change unless:
  - delivery manifest contains approval context and changed-path lineage;
  - release packet contains handoff/promotion/execution lineage;
  - failure transcript recovery guidance is empty or resolved.
