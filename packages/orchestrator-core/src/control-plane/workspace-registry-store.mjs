import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REGISTRY_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_LIMIT = 100;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function platformStateRoot(env = process.env) {
  if (env.AOR_HOME) return path.resolve(env.AOR_HOME);
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA ?? os.homedir(), "AOR");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AOR");
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "aor");
}

export function resolveWorkspaceRegistryPaths(options = {}) {
  const root = path.resolve(options.root ?? platformStateRoot(options.env));
  const workspaceRoot = path.join(root, "workspace");
  return Object.freeze({
    root,
    workspaceRoot,
    registryFile: path.join(workspaceRoot, "registry.json"),
    lockDir: path.join(workspaceRoot, "registry.lock"),
  });
}

function emptyRegistry() {
  return { schema_version: REGISTRY_VERSION, revision: 0, selected_project_id: null, projects: [] };
}

function parseRegistry(file, quarantineCorrupt) {
  if (!fs.existsSync(file)) return emptyRegistry();
  try {
    const document = JSON.parse(fs.readFileSync(file, "utf8"));
    if (document?.schema_version !== REGISTRY_VERSION || !Number.isInteger(document.revision) || !Array.isArray(document.projects)) {
      throw new Error("unsupported registry shape");
    }
    return document;
  } catch (error) {
    if (!quarantineCorrupt) throw error;
    const quarantine = `${file}.corrupt.${Date.now()}`;
    fs.renameSync(file, quarantine);
    return { ...emptyRegistry(), recovery: { status: "quarantined", quarantine_file: quarantine } };
  }
}

function lockIsStale(lockDir) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    return Date.now() - Number(metadata.created_at_ms) > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function acquireLock(paths) {
  fs.mkdirSync(paths.workspaceRoot, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
    try {
      fs.mkdirSync(paths.lockDir);
      fs.writeFileSync(path.join(paths.lockDir, "owner.json"), `${JSON.stringify({
        pid: process.pid,
        created_at_ms: Date.now(),
      }, null, 2)}\n`, { mode: 0o600 });
      return () => fs.rmSync(paths.lockDir, { recursive: true, force: true });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      if (lockIsStale(paths.lockDir)) {
        fs.rmSync(paths.lockDir, { recursive: true, force: true });
        continue;
      }
      sleep(10);
    }
  }
  throw new Error(`Timed out acquiring Local Workspace registry lock '${paths.lockDir}'.`);
}

function publish(paths, document) {
  const temporary = path.join(paths.workspaceRoot, `.registry.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, paths.registryFile);
}

export function createWorkspaceRegistryStore(options = {}) {
  const paths = resolveWorkspaceRegistryPaths(options);
  return Object.freeze({
    paths,
    read() {
      return parseRegistry(paths.registryFile, true);
    },
    update(expectedRevision, mutate) {
      const release = acquireLock(paths);
      try {
        const current = parseRegistry(paths.registryFile, true);
        if (expectedRevision !== undefined && current.revision !== expectedRevision) {
          const error = new Error(`Workspace registry revision conflict: expected ${expectedRevision}, current ${current.revision}.`);
          error.code = "workspace_registry_revision_conflict";
          throw error;
        }
        const next = mutate(structuredClone(current));
        const published = { ...next, schema_version: REGISTRY_VERSION, revision: current.revision + 1 };
        publish(paths, published);
        return published;
      } finally {
        release();
      }
    },
  });
}
