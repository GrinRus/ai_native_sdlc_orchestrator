/**
 * Supported Node.js runtime contract for the installed CLI and source gates.
 *
 * Keep this in a packaged runtime module so the CLI, guided readiness probe,
 * and release smoke test cannot silently drift from package.json engines.
 */
export const SUPPORTED_NODE_ENGINE = ">=22 <23 || >=26 <27";
export const SUPPORTED_NODE_FAMILIES = Object.freeze(["22.x", "26.x"]);

function parseNodeVersion(version) {
  const match = String(version ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareNodeVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function comparatorSatisfies(version, comparator) {
  const trimmed = comparator.trim();
  const minimum = trimmed.match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u);
  if (minimum) {
    const parsedMinimum = parseNodeVersion(`${minimum[1]}.${minimum[2] ?? 0}.${minimum[3] ?? 0}`);
    return parsedMinimum ? compareNodeVersions(version, parsedMinimum) >= 0 : false;
  }
  const maximum = trimmed.match(/^<\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u);
  if (maximum) {
    const parsedMaximum = parseNodeVersion(`${maximum[1]}.${maximum[2] ?? 0}.${maximum[3] ?? 0}`);
    return parsedMaximum ? compareNodeVersions(version, parsedMaximum) < 0 : false;
  }
  return false;
}

/**
 * @param {string} versionText
 * @param {string} [requiredRange]
 * @returns {boolean}
 */
export function nodeVersionSatisfiesRequiredRange(versionText, requiredRange = SUPPORTED_NODE_ENGINE) {
  const version = parseNodeVersion(versionText);
  if (!version) return false;
  return String(requiredRange)
    .split("||")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      const comparators = entry.split(/\s+/u).filter(Boolean);
      return comparators.length > 0 && comparators.every((comparator) => comparatorSatisfies(version, comparator));
    });
}

/**
 * @param {string} [versionText]
 * @returns {boolean}
 */
export function isSupportedNodeVersion(versionText = process.versions.node) {
  return nodeVersionSatisfiesRequiredRange(versionText, SUPPORTED_NODE_ENGINE);
}

export function supportedNodeFamiliesLabel() {
  return SUPPORTED_NODE_FAMILIES.join(" or ");
}

/**
 * @param {string} [versionText]
 * @returns {string}
 */
export function unsupportedNodeVersionMessage(versionText = process.version) {
  return [
    `AOR cannot run on Node.js ${versionText}.`,
    `Supported versions are Node.js ${supportedNodeFamiliesLabel()} (${SUPPORTED_NODE_ENGINE}).`,
    "Install a supported Node.js version and rerun the command.",
  ].join(" ");
}
