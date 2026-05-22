# Changelog

All notable source-level and package changes should be summarized here for
versioned AOR snapshots.

## Unreleased

- No unreleased changes yet.

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
