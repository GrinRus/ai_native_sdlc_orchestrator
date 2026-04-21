# AGENTS.md

This directory contains GitHub-facing automation and community-health files.

## Editing rules

- Keep workflow permissions least-privilege by default.
- Pin third-party actions to full commit SHAs.
- Use workflow concurrency when stale runs should be canceled.
- Keep issue and PR templates aligned with the slice-first backlog model.
- If CI behavior changes, update `README.md`, `CONTRIBUTING.md`, and `scripts/**` when needed.

## Scope guardrails

- Do not add release or publish automation without a matching backlog slice.
- Do not introduce write-capable workflow permissions unless the workflow genuinely needs them.
- Prefer simple CI that validates the repository honestly over aspirational workflows that cannot pass locally.
