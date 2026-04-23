import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  createAdapterRequestEnvelope,
  createMockAdapter,
  resolveAdapterForRoute,
} from "../../adapter-sdk/src/index.mjs";
import { validateContractDocument } from "../../contracts/src/index.mjs";
import { resolveRouteForStep } from "../../provider-routing/src/route-resolution.mjs";

import { resolveAssetBundleForStep } from "./asset-loader.mjs";
import { compileStepContext } from "./context-compiler.mjs";
import { materializeDeliveryPlan } from "./delivery-plan.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
import { analyzeProjectRuntime } from "./project-analysis.mjs";
import { resolveStepPolicyForStep } from "./policy-resolution.mjs";

const STEP_CLASS_TO_RESULT_CLASS = Object.freeze({
  discovery: "artifact",
  research: "artifact",
  spec: "artifact",
  planning: "planner",
  implement: "runner",
  review: "runner",
  qa: "runner",
  repair: "repair",
  eval: "eval",
  harness: "harness",
});
const STEP_ARCHITECTURE_DOC_REFS = Object.freeze([
  "docs/architecture/04-system-of-record-and-core-entities.md",
  "docs/architecture/12-orchestrator-operating-model.md",
  "docs/architecture/14-cli-command-catalog.md",
]);
const STEP_ARCHITECTURE_CONTRACT_REFS = Object.freeze([
  "docs/contracts/project-analysis-report.md",
  "docs/contracts/step-result.md",
  "docs/contracts/wave-ticket.md",
  "docs/contracts/handoff-packet.md",
]);

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

/**
 * @param {string} value
 * @returns {string}
 */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRefSuffix(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === "object" && value !== null ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function uniqueStrings(value) {
  return [...new Set(asStringArray(value))];
}

/**
 * @param {string} projectId
 * @param {string} stepClass
 * @param {string} promptBundleRef
 * @returns {string}
 */
function buildCompiledContextId(projectId, stepClass, promptBundleRef) {
  const promptMatch = /^prompt-bundle:\/\/([^@]+)@v\d+$/u.exec(promptBundleRef);
  const promptSuffix = normalizeRefSuffix(promptMatch?.[1] ?? promptBundleRef);
  return `compiled-context.${projectId}.${stepClass}.${promptSuffix || "default"}`;
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   compiledContextArtifact: Record<string, unknown>,
 *   stepClass: string,
 * }} options
 */
function writeCompiledContextArtifact(options) {
  const validation = validateContractDocument({
    family: "compiled-context-artifact",
    document: options.compiledContextArtifact,
    source: "runtime://compiled-context-artifact",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Compiled-context artifact failed contract validation: ${messages}`);
  }

  const artifactPath = path.join(options.runtimeLayout.reportsRoot, `compiled-context-${options.stepClass}.json`);
  fs.writeFileSync(artifactPath, `${JSON.stringify(options.compiledContextArtifact, null, 2)}\n`, "utf8");
  return artifactPath;
}

/**
 * @param {Record<string, unknown>} assetResolution
 * @returns {string[]}
 */
function resolveSyntheticPacketRefs(assetResolution) {
  const promptBundle = asRecord(assetResolution.prompt_bundle);
  const promptProfile = asRecord(promptBundle.profile);
  const requiredInputs = asRecord(promptProfile.required_inputs);
  const packets = asRecord(requiredInputs.packets);
  return uniqueStrings(packets.required).map((packetName) => `packet://${packetName}`);
}

/**
 * @param {{
 *   runtimeLayout: { reportsRoot: string },
 *   stepResultFileName: string,
 *   stepResult: Record<string, unknown>,
 * }} options
 */
function writeStepResult(options) {
  const validation = validateContractDocument({
    family: "step-result",
    document: options.stepResult,
    source: "runtime://step-result",
  });
  if (!validation.ok) {
    const messages = validation.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Routed step-result failed contract validation: ${messages}`);
  }

  const stepResultPath = path.join(options.runtimeLayout.reportsRoot, options.stepResultFileName);
  fs.writeFileSync(stepResultPath, `${JSON.stringify(options.stepResult, null, 2)}\n`, "utf8");
  return stepResultPath;
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef?: string,
 *   projectProfile?: string,
 *   runtimeRoot?: string,
 *   stepClass: string,
 *   dryRun?: boolean,
 *   runId?: string,
 *   stepId?: string,
 *   routeOverrides?: Record<string, string>,
 *   wrapperOverrides?: Record<string, string>,
 *   promptBundleOverrides?: Record<string, string>,
 *   contextBundleOverrides?: Record<string, string[]>,
 *   policyOverrides?: Record<string, string>,
 *   adapterOverrides?: Record<string, string>,
 *   routesRoot?: string,
 *   wrappersRoot?: string,
 *   promptsRoot?: string,
 *   contextBundlesRoot?: string,
 *   policiesRoot?: string,
 *   adaptersRoot?: string,
 *   skillsRoot?: string,
 *   requireDiscoveryCompleteness?: boolean,
 * }} options
 */
export function executeRoutedStep(options) {
  const init = initializeProjectRuntime(options);

  const routesRoot = options.routesRoot
    ? path.isAbsolute(options.routesRoot)
      ? options.routesRoot
      : path.resolve(init.projectRoot, options.routesRoot)
    : path.join(init.projectRoot, "examples/routes");
  const wrappersRoot = options.wrappersRoot
    ? path.isAbsolute(options.wrappersRoot)
      ? options.wrappersRoot
      : path.resolve(init.projectRoot, options.wrappersRoot)
    : path.join(init.projectRoot, "examples/wrappers");
  const promptsRoot = options.promptsRoot
    ? path.isAbsolute(options.promptsRoot)
      ? options.promptsRoot
      : path.resolve(init.projectRoot, options.promptsRoot)
    : path.join(init.projectRoot, "examples/prompts");
  const contextBundlesRoot = options.contextBundlesRoot
    ? path.isAbsolute(options.contextBundlesRoot)
      ? options.contextBundlesRoot
      : path.resolve(init.projectRoot, options.contextBundlesRoot)
    : path.join(init.projectRoot, "examples/context/bundles");
  const policiesRoot = options.policiesRoot
    ? path.isAbsolute(options.policiesRoot)
      ? options.policiesRoot
      : path.resolve(init.projectRoot, options.policiesRoot)
    : path.join(init.projectRoot, "examples/policies");
  const adaptersRoot = options.adaptersRoot
    ? path.isAbsolute(options.adaptersRoot)
      ? options.adaptersRoot
      : path.resolve(init.projectRoot, options.adaptersRoot)
    : path.join(init.projectRoot, "examples/adapters");
  const skillsRoot = options.skillsRoot
    ? path.isAbsolute(options.skillsRoot)
      ? options.skillsRoot
      : path.resolve(init.projectRoot, options.skillsRoot)
    : path.join(init.projectRoot, "examples/skills");

  const requestedStepClass = options.stepClass;
  const resultStepClass = STEP_CLASS_TO_RESULT_CLASS[requestedStepClass] ?? "runner";
  const runId = options.runId ?? `${init.projectId}.routed-execution.v1`;
  const stepId = options.stepId ?? `routed.${requestedStepClass}`;
  const stepResultId = `${runId}.step.${requestedStepClass}`;
  const dryRun = options.dryRun !== false;

  const startedAt = new Date().toISOString();

  /** @type {Record<string, unknown> | null} */
  let routeResolution = null;
  /** @type {Record<string, unknown> | null} */
  let assetResolution = null;
  /** @type {Record<string, unknown> | null} */
  let policyResolution = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResolution = null;
  /** @type {{ deliveryPlan: Record<string, unknown>, deliveryPlanFile: string } | null} */
  let deliveryPlanResult = null;
  /** @type {Record<string, unknown> | null} */
  let adapterRequest = null;
  /** @type {Record<string, unknown> | null} */
  let adapterResponse = null;
  /** @type {Record<string, unknown> | null} */
  let compiledContextArtifact = null;
  /** @type {Record<string, unknown> | null} */
  let contextCompilation = null;
  /** @type {string | null} */
  let compiledContextRef = null;
  /** @type {string | null} */
  let compiledContextArtifactPath = null;
  /** @type {string[]} */
  let evidenceRefs = [init.projectProfilePath];
  /** @type {"passed" | "failed"} */
  let status = "passed";
  let summary = `Routed step '${requestedStepClass}' completed in dry-run mode.`;
  /** @type {string | null} */
  let blockedNextStep = null;
  /** @type {{
   *   status: "pass" | "fail",
   *   blocking: boolean,
   *   analysis_report_id: string,
   *   analysis_report_file: string,
   *   checks: Array<{ check_id: string, status: "pass" | "fail", blocking: boolean, summary: string, expected: unknown, actual: unknown }>,
   * } | null} */
  let discoveryCompletenessGate = null;
  /** @type {{
   *   architecture_doc_refs: string[],
   *   contract_refs: string[],
   *   planning_artifact_families: string[],
   *   step_linkage: Array<{ step_class: string, route_id: string | null, wrapper_ref: string | null, prompt_bundle_ref: string | null, policy_id: string | null }>,
   *   evaluation_refs: { suite_refs: string[], dataset_refs: string[] },
   * } | null} */
  let discoveryArchitectureTraceability = null;

  if (requestedStepClass === "spec" && options.requireDiscoveryCompleteness !== false) {
    const discoveryResult = analyzeProjectRuntime({
      cwd: options.cwd,
      projectRef: options.projectRef,
      projectProfile: options.projectProfile,
      runtimeRoot: options.runtimeRoot,
      routeOverrides: options.routeOverrides,
      policyOverrides: options.policyOverrides,
      adapterOverrides: options.adapterOverrides,
      routesRoot: options.routesRoot,
      wrappersRoot: options.wrappersRoot,
      promptsRoot: options.promptsRoot,
      policiesRoot: options.policiesRoot,
      adaptersRoot: options.adaptersRoot,
    });
    const completeness = discoveryResult.report.discovery_completeness;
    const architectureTraceability = discoveryResult.report.architecture_traceability;

    if (
      typeof completeness !== "object" ||
      completeness === null ||
      !Array.isArray(completeness.checks) ||
      typeof completeness.status !== "string"
    ) {
      throw new Error(
        "Project analysis report is missing discovery_completeness; run 'aor discovery run' to regenerate analysis outputs.",
      );
    }

    discoveryCompletenessGate = {
      status: completeness.status === "pass" ? "pass" : "fail",
      blocking: Boolean(completeness.blocking),
      analysis_report_id: discoveryResult.report.report_id,
      analysis_report_file: discoveryResult.reportPath,
      checks: completeness.checks
        .filter((check) => typeof check === "object" && check !== null)
        .map((check) => ({
          check_id: typeof check.check_id === "string" ? check.check_id : "unknown",
          status: check.status === "pass" ? "pass" : "fail",
          blocking: Boolean(check.blocking),
          summary: typeof check.summary === "string" ? check.summary : "Discovery completeness check",
          expected: Object.prototype.hasOwnProperty.call(check, "expected") ? check.expected : null,
          actual: Object.prototype.hasOwnProperty.call(check, "actual") ? check.actual : null,
        })),
    };
    if (typeof architectureTraceability === "object" && architectureTraceability !== null) {
      discoveryArchitectureTraceability = {
        architecture_doc_refs: Array.isArray(architectureTraceability.architecture_doc_refs)
          ? architectureTraceability.architecture_doc_refs.filter((entry) => typeof entry === "string")
          : [],
        contract_refs: Array.isArray(architectureTraceability.contract_refs)
          ? architectureTraceability.contract_refs.filter((entry) => typeof entry === "string")
          : [],
        planning_artifact_families: Array.isArray(architectureTraceability.planning_artifact_families)
          ? architectureTraceability.planning_artifact_families.filter((entry) => typeof entry === "string")
          : [],
        step_linkage: Array.isArray(architectureTraceability.step_linkage)
          ? architectureTraceability.step_linkage
              .filter((entry) => typeof entry === "object" && entry !== null)
              .map((entry) => ({
                step_class: typeof entry.step_class === "string" ? entry.step_class : "unknown",
                route_id: typeof entry.route_id === "string" ? entry.route_id : null,
                wrapper_ref: typeof entry.wrapper_ref === "string" ? entry.wrapper_ref : null,
                prompt_bundle_ref: typeof entry.prompt_bundle_ref === "string" ? entry.prompt_bundle_ref : null,
                policy_id: typeof entry.policy_id === "string" ? entry.policy_id : null,
              }))
          : [],
        evaluation_refs:
          typeof architectureTraceability.evaluation_refs === "object" && architectureTraceability.evaluation_refs
            ? {
                suite_refs: Array.isArray(architectureTraceability.evaluation_refs.suite_refs)
                  ? architectureTraceability.evaluation_refs.suite_refs.filter((entry) => typeof entry === "string")
                  : [],
                dataset_refs: Array.isArray(architectureTraceability.evaluation_refs.dataset_refs)
                  ? architectureTraceability.evaluation_refs.dataset_refs.filter((entry) => typeof entry === "string")
                  : [],
              }
            : { suite_refs: [], dataset_refs: [] },
      };
    }

    if (discoveryCompletenessGate.blocking) {
      status = "failed";
      summary =
        "Spec build blocked by discovery completeness checks. Run 'aor discovery run' and resolve failed checks before planning handoff.";
      blockedNextStep = "Re-run discovery and close failing completeness checks before executing spec build.";
      evidenceRefs = [...new Set([init.projectProfilePath, discoveryResult.reportPath])];
    }
  }

  if (!discoveryCompletenessGate?.blocking) {
    try {
      routeResolution = resolveRouteForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        stepClass: requestedStepClass,
        stepOverrides: options.routeOverrides,
      });

      assetResolution = resolveAssetBundleForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        wrappersRoot,
        promptsRoot,
        contextBundlesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        wrapperOverrides: options.wrapperOverrides,
        promptBundleOverrides: options.promptBundleOverrides,
        contextBundleOverrides: options.contextBundleOverrides,
      });

      policyResolution = resolveStepPolicyForStep({
        projectProfilePath: init.projectProfilePath,
        routesRoot,
        policiesRoot,
        stepClass: requestedStepClass,
        routeOverrides: options.routeOverrides,
        policyOverrides: options.policyOverrides,
      });
      deliveryPlanResult = materializeDeliveryPlan({
        runtimeLayout: init.runtimeLayout,
        projectId: init.projectId,
        runId,
        stepClass: requestedStepClass,
        policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
      });

      adapterResolution = resolveAdapterForRoute({
        routeResolution: /** @type {any} */ (routeResolution),
        adaptersRoot,
        adapterOverrides: options.adapterOverrides,
      });

      if (!dryRun) {
        evidenceRefs = [
          ...new Set([
            init.projectProfilePath,
            ...(deliveryPlanResult ? [deliveryPlanResult.deliveryPlanFile] : []),
          ]),
        ];
        status = "failed";
        summary = `Routed step '${requestedStepClass}' blocked: live adapter execution is not implemented yet; use dry-run mode.`;
        blockedNextStep = "Retry with '--routed-dry-run-step' until live adapter execution is implemented.";
      } else {
        const syntheticPacketRefs = resolveSyntheticPacketRefs(/** @type {Record<string, unknown>} */ (assetResolution));
        const compiled = compileStepContext({
          projectRoot: init.projectRoot,
          projectProfilePath: init.projectProfilePath,
          stepClass: requestedStepClass,
          routeResolution: /** @type {Record<string, unknown>} */ (routeResolution),
          assetResolution: /** @type {Record<string, unknown>} */ (assetResolution),
          policyResolution: /** @type {Record<string, unknown>} */ (policyResolution),
          inputPacketRefs: syntheticPacketRefs,
          runtimeEvidenceRefs: evidenceRefs,
          skillsRoot,
        });
        contextCompilation = compiled.context_compilation;

        const promptBundleRef = String(
          asRecord(asRecord(assetResolution).prompt_bundle).prompt_bundle_ref ?? "prompt-bundle://unknown@v1",
        );
        const contextBundles = asRecord(asRecord(assetResolution).context_bundles);
        const expandedRefs = asRecord(contextBundles.expanded_refs);
        const compiledContextId = buildCompiledContextId(init.projectId, requestedStepClass, promptBundleRef);
        compiledContextArtifact = {
          compiled_context_id: compiledContextId,
          version: 1,
          step: requestedStepClass,
          prompt_bundle_ref: promptBundleRef,
          context_bundle_refs: uniqueStrings(contextBundles.bundle_refs),
          context_doc_refs: uniqueStrings(expandedRefs.context_doc_refs),
          context_rule_refs: uniqueStrings(expandedRefs.context_rule_refs),
          context_skill_refs: uniqueStrings(expandedRefs.context_skill_refs),
          packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
          hashes: {
            prompt_hash: `sha256:${sha256Hex(promptBundleRef)}`,
            context_hash: `sha256:${String(compiled.context_compilation.compiled_context_fingerprint ?? "")}`,
          },
          provenance: {
            compiler_revision_ref: "compiler://runtime-context-compiler@v1",
            project_profile_ref: init.projectProfilePath,
            route_profile_ref: asRecord(routeResolution).resolved_route_id ?? null,
            wrapper_profile_ref: asRecord(asRecord(assetResolution).wrapper).wrapper_ref ?? null,
            generated_at: new Date().toISOString(),
          },
        };
        compiledContextArtifactPath = writeCompiledContextArtifact({
          runtimeLayout: init.runtimeLayout,
          compiledContextArtifact,
          stepClass: requestedStepClass,
        });
        compiledContextRef = `compiled-context://${compiledContextId}`;

        adapterRequest = createAdapterRequestEnvelope({
          request_id: `${stepResultId}.request`,
          run_id: runId,
          step_id: stepId,
          step_class: requestedStepClass,
          route: routeResolution,
          asset_bundle: assetResolution,
          policy_bundle: policyResolution,
          input_packet_refs: uniqueStrings(compiled.context_compilation.resolved_input_packet_refs),
          dry_run: true,
          context: {
            compiled_context_ref: compiledContextRef,
            compiled_context_id: compiledContextId,
            compiled_context_fingerprint: compiled.context_compilation.compiled_context_fingerprint,
            context_bundle_refs: compiledContextArtifact.context_bundle_refs,
            context_doc_refs: compiledContextArtifact.context_doc_refs,
            context_rule_refs: compiledContextArtifact.context_rule_refs,
            context_skill_refs: compiledContextArtifact.context_skill_refs,
            packet_refs: compiledContextArtifact.packet_refs,
            instruction_set: compiled.compiled_context.instruction_set,
            required_inputs_resolved: compiled.compiled_context.required_inputs_resolved,
            guardrails: compiled.compiled_context.guardrails,
            skill_refs: compiled.compiled_context.skill_refs,
            provenance: compiled.compiled_context.provenance,
          },
        });

        const mockAdapter = createMockAdapter();
        adapterResponse = mockAdapter.execute(/** @type {any} */ (adapterRequest));
        evidenceRefs = [
          ...new Set([
            init.projectProfilePath,
            ...(deliveryPlanResult ? [deliveryPlanResult.deliveryPlanFile] : []),
            ...(compiledContextRef ? [compiledContextRef] : []),
            ...(compiledContextArtifactPath ? [compiledContextArtifactPath] : []),
            ...asStringArray(adapterResponse.evidence_refs),
          ]),
        ];
        summary = `Routed dry-run for step '${requestedStepClass}' completed with selected adapter '${String(
          /** @type {any} */ (adapterResolution).adapter?.adapter_id ?? "unknown",
        )}' and mock execution.`;
      }
    } catch (error) {
      status = "failed";
      summary = error instanceof Error ? error.message : String(error);
      blockedNextStep = "Fix routed resolution inputs (route/asset/policy/adapter) and retry dry-run.";
    }
  }

  const finishedAt = new Date().toISOString();
  const stepResult = {
    step_result_id: stepResultId,
    run_id: runId,
    step_id: stepId,
    step_class: resultStepClass,
    status,
    summary,
    evidence_refs: evidenceRefs,
    routed_execution: {
      mode: dryRun ? "dry-run" : "execute",
      no_write_enforced: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      route_resolution: routeResolution,
      asset_resolution: assetResolution,
      policy_resolution: policyResolution,
      delivery_plan: deliveryPlanResult
        ? {
            plan_id: deliveryPlanResult.deliveryPlan.plan_id,
            delivery_mode: deliveryPlanResult.deliveryPlan.delivery_mode,
            status: deliveryPlanResult.deliveryPlan.status,
            writeback_allowed: deliveryPlanResult.deliveryPlan.writeback_allowed,
            delivery_plan_file: deliveryPlanResult.deliveryPlanFile,
          }
        : null,
      adapter_resolution: adapterResolution,
      adapter_request: adapterRequest,
      adapter_response: adapterResponse,
      context_compilation: {
        compiled_context_ref: compiledContextRef,
        compiled_context_file: compiledContextArtifactPath,
        compiled_context_artifact: compiledContextArtifact,
        diagnostics: contextCompilation,
      },
      discovery_completeness_gate: discoveryCompletenessGate,
      architecture_traceability: {
        architecture_doc_refs: discoveryArchitectureTraceability?.architecture_doc_refs ?? [...STEP_ARCHITECTURE_DOC_REFS],
        contract_refs: discoveryArchitectureTraceability?.contract_refs ?? [...STEP_ARCHITECTURE_CONTRACT_REFS],
        planning_artifact_families: discoveryArchitectureTraceability?.planning_artifact_families ?? [
          "project-analysis-report",
          "step-result",
          "wave-ticket",
          "handoff-packet",
        ],
        step_linkage: discoveryArchitectureTraceability?.step_linkage ?? [],
        evaluation_refs: discoveryArchitectureTraceability?.evaluation_refs ?? {
          suite_refs: [],
          dataset_refs: [],
        },
        selected_step: {
          step_class: requestedStepClass,
          route_id:
            typeof (/** @type {any} */ (routeResolution))?.resolved_route_id === "string"
              ? /** @type {any} */ (routeResolution).resolved_route_id
              : null,
          wrapper_ref:
            typeof (/** @type {any} */ (assetResolution))?.wrapper?.wrapper_ref === "string"
              ? /** @type {any} */ (assetResolution).wrapper.wrapper_ref
              : null,
          prompt_bundle_ref:
            typeof (/** @type {any} */ (assetResolution))?.prompt_bundle?.prompt_bundle_ref === "string"
              ? /** @type {any} */ (assetResolution).prompt_bundle.prompt_bundle_ref
              : null,
          policy_id:
            typeof (/** @type {any} */ (policyResolution))?.policy?.policy_id === "string"
              ? /** @type {any} */ (policyResolution).policy.policy_id
              : null,
          adapter_id:
            typeof (/** @type {any} */ (adapterResolution))?.adapter?.adapter_id === "string"
              ? /** @type {any} */ (adapterResolution).adapter.adapter_id
              : null,
        },
      },
      blocked_next_step: blockedNextStep,
      evidence_root: init.runtimeLayout.reportsRoot,
    },
  };

  const stepResultFileName = `step-result-routed-${requestedStepClass}.json`;
  const stepResultPath = writeStepResult({
    runtimeLayout: init.runtimeLayout,
    stepResultFileName,
    stepResult,
  });

  return {
    ...init,
    runId,
    stepId,
    stepResultId,
    stepResult,
    stepResultPath,
  };
}
