# Security Policy

AOR is a pre-release, source-only alpha repository. Security reports are still important because AOR orchestrates runners, reads project context, writes runtime artifacts, and can be configured near credentials or private repositories.

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` | Yes, for source-only alpha reports |
| npm packages | Not applicable; packages are private and unpublished |
| GitHub Releases | Not applicable; no versioned releases are published yet |

## Reporting a Vulnerability

Use GitHub Private Vulnerability Reporting for this repository when it is available. If it is temporarily unavailable, contact the repository owner privately before opening any public issue.

Do not publish secrets, exploit details, private repository names, target checkout contents, live runner transcripts, or credential-bearing `.aor/` artifacts in public issues, pull requests, discussions, or comments.

## AOR-Specific Security Areas

Reports are especially useful when they involve:

- runner orchestration boundaries, adapter permissions, or command execution scope;
- accidental exposure of configured secrets in CLI JSON, API responses, server-sent events, logs, or web views;
- unsafe handling of `.aor/` runtime outputs, target checkouts, proof fixtures, or generated artifacts;
- behavior that could write to upstream public repositories when a no-write mode is expected;
- live E2E profiles, delivery modes, or fork-first workflows that bypass documented public-repo safety rules.

## Public Disclosure

Please wait for maintainer confirmation before disclosing vulnerability details publicly. The maintainer will coordinate a fix, credit, and disclosure timing appropriate for a source-only alpha project.

## Non-Security Issues

Use GitHub issues for ordinary bugs, documentation gaps, roadmap questions, and feature requests. Never include credentials or private repository material in those reports.
