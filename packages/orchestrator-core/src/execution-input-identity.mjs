import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function hashFileTree(root) {
  const hash = crypto.createHash("sha256");
  if (!root || !fs.existsSync(root)) return null;
  const visit = (current) => {
    const entries = fs.statSync(current).isDirectory()
      ? fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
      : [];
    if (entries.length === 0 && fs.statSync(current).isFile()) {
      hash.update(path.relative(root, current).replaceAll(path.sep, "/"));
      hash.update(fs.readFileSync(current));
      return;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) {
        hash.update(path.relative(root, child).replaceAll(path.sep, "/"));
        hash.update(fs.readFileSync(child));
      } else if (entry.isSymbolicLink()) {
        hash.update(`${path.relative(root, child)}=>${fs.readlinkSync(child)}`);
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

export function buildStepExecutionIdentity(options) {
  const sourceDigests = Object.fromEntries(
    Object.entries(options.sources).map(([name, source]) => [name, hashFileTree(source)]),
  );
  const execution = options.executionOptions;
  return {
    schema_version: 1,
    mode: { dry_run: options.dryRun, unsafe_development_override: execution.unsafeDevelopmentOverride === true },
    workspace: {
      requested_execution_root: options.requestedExecutionRoot,
      reuse_disposable_workspace: execution.reuseDisposableWorkspace === true,
      project_root: options.init.projectRoot,
      runtime_root: options.init.runtimeRoot,
    },
    routing: {
      step_class: options.requestedStepClass,
      route_overrides: execution.routeOverrides ?? {},
      wrapper_overrides: execution.wrapperOverrides ?? {},
      prompt_bundle_overrides: execution.promptBundleOverrides ?? {},
      context_bundle_overrides: execution.contextBundleOverrides ?? {},
      adapter_overrides: execution.adapterOverrides ?? {},
    },
    policy: {
      policy_overrides: execution.policyOverrides ?? {},
      require_discovery_completeness: execution.requireDiscoveryCompleteness === true,
    },
    evidence: {
      approved_handoff_ref: execution.approvedHandoffRef ?? null,
      promotion_evidence_refs: execution.promotionEvidenceRefs ?? [],
      coordination_evidence_refs: execution.coordinationEvidenceRefs ?? [],
      runtime_evidence_refs: execution.runtimeEvidenceRefs ?? [],
      operator_request_ref: execution.operatorRequestRef ?? null,
    },
    plan: {
      execution_plan_ref: execution.executionPlanRef ?? null,
      execution_unit_id: execution.executionUnitId ?? null,
      task_refs: execution.taskRefs ?? [],
      plan_digest: execution.planDigest ?? null,
      task_digests: execution.taskDigests ?? {},
    },
    source_digests: sourceDigests,
  };
}
