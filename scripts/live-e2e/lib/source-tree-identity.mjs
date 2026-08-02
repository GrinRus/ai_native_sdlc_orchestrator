import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function computeSourceTreeDigest(cwd) {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd,
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listed.status !== 0) return null;
  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  for (const relativeFile of files) {
    const absoluteFile = path.join(cwd, relativeFile);
    digest.update(`${relativeFile}\0`);
    try {
      const stat = fs.lstatSync(absoluteFile);
      if (stat.isSymbolicLink()) digest.update(`symlink\0${fs.readlinkSync(absoluteFile)}\0`);
      else if (stat.isFile()) digest.update(`file\0${createHash("sha256").update(fs.readFileSync(absoluteFile)).digest("hex")}\0`);
      else digest.update(`${stat.isDirectory() ? "directory" : "other"}\0`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      digest.update("deleted\0");
    }
  }
  return digest.digest("hex");
}

export function sourceInstallCacheMatches(options) {
  if (options.effectivePolicy !== "source-install-required") return true;
  return Boolean(
    options.currentSourceCommit
    && options.cachedSourceCommit
    && options.currentSourceCommit === options.cachedSourceCommit
    && options.currentSourceTreeDigest
    && options.cachedSourceTreeDigest
    && options.currentSourceTreeDigest === options.cachedSourceTreeDigest,
  );
}
