import path from "node:path";

export function toEvidenceRef(projectRoot, filePath) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!projectRoot || !path.isAbsolute(projectRoot) || !path.isAbsolute(filePath)) return `evidence://${normalizedPath}`;
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return !relative || relative.startsWith("..") ? `evidence://${normalizedPath}` : `evidence://${relative}`;
}

export function evidenceReferenceRoot(projectRoot, evidenceDir) {
  if (!evidenceDir || !path.isAbsolute(evidenceDir)) return projectRoot;
  const marker = `${path.sep}projects${path.sep}`;
  const markerIndex = evidenceDir.lastIndexOf(marker);
  return markerIndex > 0 ? evidenceDir.slice(0, markerIndex) : projectRoot;
}
