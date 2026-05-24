# Changelog

All notable source-level and package changes should be summarized here for
versioned AOR snapshots.

## Unreleased

- No unreleased changes yet.

## [0.1.0-alpha.3] - 2026-05-24

- Added W30 alpha-hardening source-of-truth docs, including the W30 backlog
  wave, ADR index, and architecture decisions for the self-hosted alpha
  boundary.
- Added the OpenAPI 3.1 detached control-plane API contract and readiness
  drift checks that compare the contract to the implemented router surface.
- Added self-hosted operations guidance for environment modes,
  secrets/redaction, `.aor` backup/restore, and incident evidence preservation.
- Refreshed npm alpha release and installed-user smoke evidence for the
  hardened self-hosted CLI/API alpha path.

## [0.1.0-alpha.2] - 2026-05-23

- Verified the automated npm Trusted Publishing release path after bootstrap.
- Pinned release automation to the npm CLI version that supports explicit
  trusted-publishing permissions.
- Marked automated alpha GitHub Releases as prereleases.

## [0.1.0-alpha.1] - 2026-05-22

- Added the first npm CLI alpha package channel as `@grinrus/aor`.
- Added release branch gates for `release/v<semver-alpha>` PRs.
- Added npm package verification, dry-run packing, installed-package smoke, and
  GitHub release publish automation guarded by `release:publish`.
- Added public OSS readiness guidance for source-only alpha distribution.
- Added security, support, community, dependency automation, and CI hardening files.

## Release Policy

`main` remains the public source channel. npm CLI alpha releases are cut from
short-lived `release/v<semver-alpha>` branches, published as `@grinrus/aor`,
and tagged with matching GitHub Releases after the release gate passes.
