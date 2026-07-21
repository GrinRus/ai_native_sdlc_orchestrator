import fs from "node:fs";
import path from "node:path";

const SUPPORTED_TRANSPORTS = Object.freeze([
  "request-artifact",
  "stdin-json",
  "file-attachment",
  "argv-json",
  "none",
]);

export function resolveRequestTransport(externalRuntime, requestViaStdin) {
  const configured = typeof externalRuntime.request_transport === "string"
    ? externalRuntime.request_transport.trim()
    : "";
  return configured || (requestViaStdin ? "stdin-json" : "none");
}

export function isSupportedRequestTransport(requestTransport) {
  return SUPPORTED_TRANSPORTS.includes(requestTransport);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeFileName(value, fallback) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return normalized || fallback;
}

function isPathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizePrimaryCheckoutPath(value, primaryRoots) {
  for (const root of primaryRoots) {
    if (value === root) return "aor-evidence://primary-checkout";
    if (value.startsWith(`${root}${path.sep}`)) {
      const relative = path.relative(root, value).replace(/\\/gu, "/");
      return `aor-evidence://primary-checkout/${relative}`;
    }
  }
  return value;
}

function sanitizeProviderValue(value, primaryRoots) {
  if (typeof value === "string") return sanitizePrimaryCheckoutPath(value, primaryRoots);
  if (Array.isArray(value)) return value.map((entry) => sanitizeProviderValue(entry, primaryRoots));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeProviderValue(entry, primaryRoots)]),
  );
}

function writeProviderInputSnapshot(sourcePath, destinationPath, primaryRoots) {
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  let snapshotText = sourceText;
  try {
    snapshotText = `${JSON.stringify(sanitizeProviderValue(JSON.parse(sourceText), primaryRoots), null, 2)}\n`;
  } catch {
    for (const root of primaryRoots) {
      snapshotText = snapshotText.split(root).join("aor-evidence://primary-checkout");
    }
  }
  fs.writeFileSync(destinationPath, snapshotText, { encoding: "utf8", mode: 0o444, flag: "wx" });
}

/**
 * Materialize the provider-visible request packet and its local inputs inside
 * the disposable execution checkout. Canonical evidence remains in the
 * project runtime; the runtime agent never receives those paths as writable
 * execution roots.
 *
 * @param {{
 *   providerWorkPacket: Record<string, unknown>,
 *   canonicalPacketFile: string,
 *   executionRoot: string,
 *   projectRoot?: string | null,
 * }} options
 */
export function materializeProviderInputSnapshot(options) {
  fs.writeFileSync(options.canonicalPacketFile, `${JSON.stringify(options.providerWorkPacket, null, 2)}\n`, "utf8");
  const canonicalExecutionRoot = fs.realpathSync.native(options.executionRoot);
  const primaryRoots = [];
  if (typeof options.projectRoot === "string" && path.isAbsolute(options.projectRoot)) {
    primaryRoots.push(path.resolve(options.projectRoot));
    if (fs.existsSync(options.projectRoot)) primaryRoots.push(fs.realpathSync.native(options.projectRoot));
  }
  const uniquePrimaryRoots = [...new Set(primaryRoots)].sort((left, right) => right.length - left.length);
  const snapshotName = safeFileName(path.basename(options.canonicalPacketFile, ".json"), "provider-work-packet");
  const snapshotRoot = path.join(canonicalExecutionRoot, ".aor", "provider-inputs", snapshotName);
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const canonicalSnapshotRoot = fs.realpathSync.native(snapshotRoot);
  if (!isPathInsideRoot(canonicalSnapshotRoot, canonicalExecutionRoot)) {
    throw new Error("Provider input snapshot escaped the disposable execution root.");
  }

  const sourceResolvedRefs = Array.isArray(options.providerWorkPacket.resolved_local_refs)
    ? options.providerWorkPacket.resolved_local_refs
    : [];
  const packet = sanitizeProviderValue(structuredClone(options.providerWorkPacket), uniquePrimaryRoots);
  const snapshotRefs = [];
  let index = 0;
  for (const value of sourceResolvedRefs) {
    const entry = asRecord(value);
    if (entry.role === "provider_work_packet") continue;
    const sourcePath = typeof entry.local_path === "string" ? entry.local_path : "";
    const destinationName = `${String(index).padStart(2, "0")}-${safeFileName(path.basename(sourcePath), "input.json")}`;
    const destinationPath = path.join(canonicalSnapshotRoot, destinationName);
    const sourceAvailable = sourcePath && path.isAbsolute(sourcePath) && fs.existsSync(sourcePath);
    const sourceStat = sourceAvailable ? fs.lstatSync(sourcePath) : null;
    const sourceIsRegularFile = sourceStat?.isFile() === true && sourceStat.isSymbolicLink() === false;
    if (sourceIsRegularFile) {
      writeProviderInputSnapshot(sourcePath, destinationPath, uniquePrimaryRoots);
      snapshotRefs.push({ ...entry, local_path: destinationPath, available: true });
    } else if (entry.required === true) {
      fs.writeFileSync(destinationPath, `${JSON.stringify({
        status: "unavailable",
        role: entry.role || "unknown",
        evidence_ref: entry.evidence_ref || null,
        reason: sourceAvailable ? "not-a-regular-file" : "source-unavailable",
      }, null, 2)}\n`, { encoding: "utf8", mode: 0o444, flag: "wx" });
      snapshotRefs.push({ ...entry, local_path: destinationPath, available: false });
    } else {
      continue;
    }
    index += 1;
  }

  const snapshotPacketFile = path.join(canonicalSnapshotRoot, "provider-work-packet.json");
  const canonicalRef = sourceResolvedRefs.find((value) => asRecord(value).role === "provider_work_packet");
  snapshotRefs.push({
    ...asRecord(canonicalRef),
    role: "provider_work_packet",
    local_path: snapshotPacketFile,
    required: true,
    kind: "provider-work-packet",
  });
  packet.resolved_local_refs = snapshotRefs;
  packet.execution_contract = {
    ...asRecord(packet.execution_contract),
    disposable_workspace_boundary: {
      execution_root: canonicalExecutionRoot,
      provider_input_root: canonicalSnapshotRoot,
      evidence_inputs_read_only: true,
      source_edits_must_remain_within_execution_root: true,
      primary_checkout_paths_are_not_execution_roots: true,
    },
  };
  fs.writeFileSync(snapshotPacketFile, `${JSON.stringify(packet, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o444,
    flag: "wx",
  });

  return {
    packet,
    packetFile: snapshotPacketFile,
    snapshotRoot: canonicalSnapshotRoot,
  };
}
