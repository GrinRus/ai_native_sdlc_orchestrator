export const PROCESS_TREE_SUPERVISION_SOURCE = String.raw`
const knownProcessTargets = new Map();

function snapshotProcessTargets(rootPid) {
  if (process.platform === "win32") return;
  let output = "";
  try {
    const psCommand = process.platform === "darwin" ? "/bin/ps" : "/usr/bin/ps";
    output = execFileSync(psCommand, ["-axo", "pid=,ppid=,pgid="], { encoding: "utf8" });
  } catch {
    return;
  }
  const rows = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, parentPid, processGroupId]) =>
      Number.isInteger(pid) && Number.isInteger(parentPid) && Number.isInteger(processGroupId),
    )
    .map(([pid, parentPid, processGroupId]) => ({ pid, parentPid, processGroupId }));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.parentPid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  for (const row of rows) {
    if (descendants.has(row.pid)) {
      knownProcessTargets.set(row.pid, row.processGroupId);
    }
  }
}

function killProcessTree(child, signal) {
  if (!child || typeof child.pid !== "number") return;
  snapshotProcessTargets(child.pid);
  if (process.platform !== "win32") {
    for (const processGroupId of new Set(knownProcessTargets.values())) {
      if (!Number.isInteger(processGroupId) || processGroupId <= 1) continue;
      try {
        process.kill(-processGroupId, signal);
      } catch {}
    }
    for (const pid of knownProcessTargets.keys()) {
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }
  try {
    child.kill(signal);
  } catch {}
}
`;
