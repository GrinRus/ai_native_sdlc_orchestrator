import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadContractFile } from "../../contracts/src/index.mjs";

const MAX_INLINE_ASSET_BYTES = 64 * 1024;

function normalizeContent(value) {
  return value.replace(/\r\n?/gu, "\n").normalize("NFC");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function asRoots(value) {
  return (Array.isArray(value) ? value : [value]).filter(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  );
}

/**
 * Build one deterministic registry. Duplicate identities fail closed. A
 * byte-identical duplicate is accepted only when it comes from a later,
 * explicitly ordered root and is retained as deduplicated provenance.
 *
 * @param {{
 *   roots: string | string[],
 *   family: "context-doc" | "context-rule" | "context-skill",
 *   idField: "context_doc_id" | "context_rule_id" | "context_skill_id",
 *   scheme: "context-doc" | "context-rule" | "context-skill",
 * }} options
 */
export function buildEffectiveAssetRegistry(options) {
  const roots = asRoots(options.roots);
  if (roots.length === 0) throw new Error(`${options.family} registry requires at least one root.`);
  const explicitLayering = roots.length > 1;
  const registry = new Map();

  roots.forEach((configuredRoot, rootOrder) => {
    if (!fs.existsSync(configuredRoot)) {
      throw new Error(`${options.family} registry root '${configuredRoot}' does not exist.`);
    }
    const sourceRoot = fs.realpathSync.native(configuredRoot);
    const files = fs.readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(yaml|yml)$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of files) {
      const source = path.join(sourceRoot, fileName);
      const content = normalizeContent(fs.readFileSync(source, "utf8"));
      if (Buffer.byteLength(content, "utf8") > MAX_INLINE_ASSET_BYTES) {
        throw new Error(`${options.family} asset '${source}' exceeds the ${MAX_INLINE_ASSET_BYTES}-byte inline limit.`);
      }
      const loaded = loadContractFile({ filePath: source, family: options.family });
      if (!loaded.ok) throw new Error(`${options.family} asset '${source}' failed contract validation.`);
      const document = loaded.document;
      const canonicalId = document?.[options.idField];
      const version = document?.version;
      if (typeof canonicalId !== "string" || typeof version !== "number") {
        throw new Error(`${options.family} asset '${source}' is missing ${options.idField}/version.`);
      }
      const reference = `${options.scheme}://${canonicalId}@v${version}`;
      const digest = sha256(content);
      const existing = registry.get(reference);
      if (existing) {
        if (!explicitLayering || existing.root_order === rootOrder || existing.digest !== digest) {
          throw new Error(
            `Duplicate canonical asset identity '${reference}' conflicts between '${existing.source}' and '${source}'.`,
          );
        }
        existing.deduplicated_provenance.push({ source_root: sourceRoot, source, root_order: rootOrder, digest });
        continue;
      }
      registry.set(reference, {
        canonical_id: canonicalId,
        reference,
        family: options.family,
        version,
        digest,
        source_root: sourceRoot,
        source,
        root_order: rootOrder,
        provenance: "selected",
        deduplicated_provenance: [],
        delivery_mode: "inline",
        content,
        document,
      });
    }
  });
  return registry;
}

export function requireEffectiveAsset(registry, reference, family) {
  const entry = registry.get(reference);
  if (!entry) throw new Error(`Effective ${family} reference '${reference}' is missing from its registry.`);
  return entry;
}

export function effectiveAssetView(entry, order) {
  return {
    canonical_id: entry.canonical_id,
    reference: entry.reference,
    family: entry.family,
    digest: `sha256:${entry.digest}`,
    source_root: entry.source_root,
    source: entry.source,
    provenance: entry.provenance,
    deduplicated_provenance: entry.deduplicated_provenance,
    order,
    delivery_mode: entry.delivery_mode,
    content: entry.content,
  };
}
