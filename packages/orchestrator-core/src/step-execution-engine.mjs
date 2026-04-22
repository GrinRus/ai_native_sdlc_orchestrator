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
import { materializeDeliveryPlan } from "./delivery-plan.mjs";
import { initializeProjectRuntime } from "./project-init.mjs";
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
 *   policyOverrides?: Record<string, string>,
 *   adapterOverrides?: Record<string, string>,
 *   routesRoot?: string,
 *   wrappersRoot?: string,
 *   promptsRoot?: string,
 *   policiesRoot?: string,
 *   adaptersRoot?: string,
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
  /** @type {string[]} */
  let evidenceRefs = [init.projectProfilePath];
  /** @type {"passed" | "failed"} */
  let status = "passed";
  let summary = `Routed step '${requestedStepClass}' completed in dry-run mode.`;
  /** @type {string | null} */
  let blockedNextStep = null;

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
      stepClass: requestedStepClass,
      routeOverrides: options.routeOverrides,
      wrapperOverrides: options.wrapperOverrides,
      promptBundleOverrides: options.promptBundleOverrides,
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
      adapterRequest = createAdapterRequestEnvelope({
        request_id: `${stepResultId}.request`,
        run_id: runId,
        step_id: stepId,
        step_class: requestedStepClass,
        route: routeResolution,
        asset_bundle: assetResolution,
        policy_bundle: policyResolution,
        input_packet_refs: [],
        dry_run: true,
      });

      const mockAdapter = createMockAdapter();
      adapterResponse = mockAdapter.execute(/** @type {any} */ (adapterRequest));
      evidenceRefs = [
        ...new Set([
          init.projectProfilePath,
          ...(deliveryPlanResult ? [deliveryPlanResult.deliveryPlanFile] : []),
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
