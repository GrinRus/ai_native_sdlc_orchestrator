# AGENTS.md

Files in this directory implement repository-integrity checks and internal
maintainer rehearsals for the implemented AOR runtime.

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

Build and rehearsal checks must exercise the implemented runtime and distinguish
fixture coverage from installed end-to-end proof.
