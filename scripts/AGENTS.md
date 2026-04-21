# AGENTS.md

Files in this directory implement repository-integrity checks.

## Rules

- Use only Node.js standard library unless a new dependency is clearly justified.
- Keep checks deterministic, fast, and readable.
- Fail with actionable messages that point to the owning file or doc.
- Prefer validating the current repository honestly over simulating future runtime behavior.

## Expected scope

These scripts should validate things like:

- required root files;
- guidance coverage;
- backlog consistency;
- workflow conventions.

They should not pretend to compile or run a product runtime that does not exist yet.
