import fs from "node:fs";
import path from "node:path";

export function validateCriticalPathManifest(manifest, root) {
  const findings = [];
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.paths) || manifest.paths.length === 0) {
    findings.push("critical-path coverage manifest must use schema_version 1 and contain paths");
    return findings;
  }
  const seen = new Set();
  for (const entry of manifest.paths) {
    if (seen.has(entry.id)) findings.push(`duplicate critical path id '${entry.id}'`);
    seen.add(entry.id);
    for (const field of ["id", "source", "test", "positive_marker", "negative_marker"]) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") findings.push(`${entry.id ?? "unknown"}: missing ${field}`);
    }
    for (const field of ["source", "test"]) {
      if (typeof entry?.[field] === "string" && !fs.existsSync(path.join(root, entry[field]))) findings.push(`${entry.id}: missing ${field} file ${entry[field]}`);
    }
    if (typeof entry?.test === "string" && fs.existsSync(path.join(root, entry.test))) {
      const testSource = fs.readFileSync(path.join(root, entry.test), "utf8");
      if (!testSource.includes(entry.positive_marker)) findings.push(`${entry.id}: positive evidence marker is absent from ${entry.test}`);
      if (!testSource.includes(entry.negative_marker)) findings.push(`${entry.id}: negative evidence marker is absent from ${entry.test}`);
    }
  }
  return findings;
}
