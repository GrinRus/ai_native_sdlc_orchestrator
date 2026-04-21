# Control plane API

## Purpose
The API exposes command, query, and live-stream surfaces for AOR.

## Command families
- project bootstrap commands
- intake and planning commands
- approval commands
- run lifecycle commands
- eval and harness commands
- delivery and release commands
- incident and promotion commands
- live E2E commands

## Query families
- projects
- packets
- runs
- step results
- validation and evaluation reports
- delivery manifests and release packets
- incidents and promotion decisions
- live E2E reports

## Streaming
The API should provide SSE-first live events so CLI and web can observe active work without owning workflow state.

## Key design rules
- keep the API usable without the web UI;
- keep ids and references visible in responses;
- expose explicit approval and dry-run paths for risky actions;
- keep command and query shapes aligned with the contract docs and CLI catalog.
