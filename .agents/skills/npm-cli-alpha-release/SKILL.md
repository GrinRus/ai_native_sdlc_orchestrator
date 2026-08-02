---
name: npm-cli-alpha-release
description: Use when preparing, reviewing, validating, or publishing an AOR npm CLI alpha release for @grinrus/aor.
---

1. Read `docs/ops/npm-cli-alpha-release.md` first; it is the release source of truth.
2. Confirm the request is for the npm CLI alpha channel only:
   - package `@grinrus/aor`;
   - npm `alpha` dist-tag;
   - no Docker, GHCR, stable, hosted SaaS, or public SDK package release.
3. Confirm the release branch is `release/v<semver-alpha>` and that `package.json` version exactly matches the branch version.
4. Check the release prep files stay aligned:
   - `CHANGELOG.md` has a matching version entry;
   - `README.md` includes the matching `npm install -g @grinrus/aor@<version>` command;
   - `package.json` still exposes `release:verify`, `release:pack`, `release:smoke`, and `release:gate`;
   - internal workspace packages under `apps/*` and `packages/*` remain private.
5. Run the strict local gate before treating a release PR as ready:

   ```bash
   AOR_RELEASE_BRANCH=release/v<semver-alpha> AOR_RELEASE_STRICT_BRANCH=true pnpm release:gate
   ```

6. Require the release PR to target `main`, come from the same repository, and carry the `release:publish` label before merge.
7. Preserve fail-closed publishing rules: do not add npm tokens, do not overwrite an existing version, do not publish without `--tag alpha`, and do not advance `latest` manually.
