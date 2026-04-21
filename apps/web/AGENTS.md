# AGENTS.md

Web is the optional operator console for a running AOR system.

## Owns
- project, wave, packet, and run views
- live timeline and logs
- quality, promotion, and incident views
- live E2E dashboards

## Rules
- Write module-facing docs, examples, and comments in English.
- UI is detachable and must not own critical orchestration logic.
- Read models and streams come from API and observability layers.
- Stopping the web app must not stop runs.
