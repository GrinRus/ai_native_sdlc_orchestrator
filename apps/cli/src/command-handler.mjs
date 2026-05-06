import { getContractFamilyIndex } from "../../../packages/contracts/src/index.mjs";

import {
  RUNTIME_ROOT_DIRNAME,
  getCommandDefinition,
  getImplementedCommands,
  getPlannedCommands,
} from "./command-catalog.mjs";
import {
  CliUsageError,
  ensureRequiredFlags,
  resolveProjectRef,
  resolveRuntimeRoot,
} from "./command-runtime.mjs";
import { buildCliOutput, createCliOutputState } from "./cli-output.mjs";
import { executeCommandHandlerGroup, resolveCommandHandlerGroup } from "./command-handlers/index.mjs";

export { CliUsageError };

/**
 * @typedef {{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 * }} CliResult
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function isHelpFlag(value) {
  return value === "-h" || value === "--help" || value === "help";
}

/**
 * @param {string[]} args
 * @returns {Record<string, string | string[] | true>}
 */
function parseFlags(args) {
  /** @type {Record<string, string | string[] | true>} */
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new CliUsageError(`Unexpected argument '${current}'. Flags must use --name <value>.`);
    }

    const [rawName, inlineValue] = current.split("=", 2);
    const flagName = rawName.slice(2);

    if (!flagName) {
      throw new CliUsageError(`Invalid flag '${current}'.`);
    }

    if (inlineValue !== undefined) {
      const existing = flags[flagName];
      if (existing === undefined) {
        flags[flagName] = inlineValue;
      } else if (existing === true) {
        throw new CliUsageError(`Duplicate flag '--${flagName}'.`);
      } else if (Array.isArray(existing)) {
        existing.push(inlineValue);
      } else {
        flags[flagName] = [existing, inlineValue];
      }
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      const existing = flags[flagName];
      if (existing === undefined) {
        flags[flagName] = next;
      } else if (existing === true) {
        throw new CliUsageError(`Duplicate flag '--${flagName}'.`);
      } else if (Array.isArray(existing)) {
        existing.push(next);
      } else {
        flags[flagName] = [existing, next];
      }
      index += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(flags, flagName)) {
      throw new CliUsageError(`Duplicate flag '--${flagName}'.`);
    }
    flags[flagName] = true;
  }

  return flags;
}

/**
 * @param {{ command: string, summary?: string, inputs?: string[], outputs?: string[], contractFamilies?: string[] }} definition
 * @returns {string}
 */
export function formatCommandHelp(definition) {
  const statusLine =
    definition.command === "eval run"
      ? "Status: implemented in quality shell (W3-S03)"
      : definition.command === "harness replay"
        ? "Status: implemented in quality shell (W9-S05)"
      : definition.command === "asset promote" || definition.command === "asset freeze"
        ? "Status: implemented in quality shell (W9-S06)"
      : definition.command === "harness certify"
        ? "Status: implemented in quality shell (W3-S05)"
      : definition.command === "intake create" ||
            definition.command === "discovery run" ||
            definition.command === "spec build" ||
            definition.command === "wave create"
          ? "Status: implemented in intake and planning shell (W6-S02)"
        : definition.command === "review run"
          ? "Status: implemented in review shell (W13-S05)"
        : definition.command === "learning handoff"
          ? "Status: implemented in learning-loop shell (W13-S05)"
        : definition.command === "run start" ||
            definition.command === "run pause" ||
            definition.command === "run resume" ||
            definition.command === "run steer" ||
            definition.command === "run cancel"
          ? "Status: implemented in run-control shell (W6-S03)"
        : definition.command === "run status" ||
            definition.command === "packet show" ||
            definition.command === "evidence show"
          ? "Status: implemented in operator shell (W5-S03)"
        : definition.command === "deliver prepare" || definition.command === "release prepare"
          ? "Status: implemented in delivery/release shell (W6-S05)"
        : definition.command === "incident recertify"
          ? "Status: implemented in incident recertification shell (W8-S06)"
        : definition.command === "incident open" ||
            definition.command === "incident show" ||
            definition.command === "audit runs"
          ? "Status: implemented in incident/audit shell (W6-S06)"
        : definition.command === "ui attach" || definition.command === "ui detach"
          ? "Status: implemented in UI lifecycle shell (W6-S04)"
          : "Status: implemented in bootstrap shell (W1-S01)";
  const notes =
    definition.command === "project init"
      ? [
          "- --project-ref is optional. When omitted, the command discovers repo root from cwd.",
          "- --project-profile can override default profile discovery in project root.",
          `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
          "- --materialize-project-profile writes project.aor.yaml from bundled bootstrap templates when the target repo is still clean.",
          "- --materialize-bootstrap-assets writes packaged examples/context bootstrap assets without proof-runner-side file injection.",
          "- --repo-build-command, --repo-lint-command, and --repo-test-command override detected verification commands during bootstrap materialization.",
          "- Re-running bootstrap materialization is idempotent and reports whether existing assets were reused.",
        ]
      : definition.command === "project analyze"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --project-profile can override default profile discovery in project root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
            "- --route-overrides accepts comma-separated step overrides like planning=route.plan.default.",
            "- --policy-overrides accepts comma-separated step overrides like planning=policy.step.planner.default.",
            "- Analyze emits route, asset, and policy resolution reports for downstream execution planning.",
          ]
      : definition.command === "project validate"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --project-profile can override default profile discovery in project root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' from profile runtime defaults.`,
            "- Validation report status can be pass, warn, or fail.",
            "- --require-approved-handoff enforces approved handoff gate for execution-style readiness.",
          ]
      : definition.command === "project verify"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --require-validation-pass enforces validation gate before verify can proceed.",
            "- --routed-dry-run-step executes one routed dry-run step and writes a durable step-result artifact.",
            "- --routed-live-step executes one routed live step when delivery guardrails and supported adapter baseline permit it.",
            "- Use --approved-handoff-ref and --promotion-evidence-refs with --routed-live-step for non-no-write live routes.",
            "- --routed-dry-run-step and --routed-live-step are mutually exclusive.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "eval run"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --subject-ref is required and must use '<subject_type>://<target>' format.",
            "- --suite-ref is optional and falls back to eval_policy.default_release_suite_ref.",
            "- Eval run is offline and independent from delivery automation.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "harness certify"
        ? [
            "- --asset-ref is the asset being promoted (for example wrapper://..., route://..., prompt-bundle://...).",
            "- --subject-ref defines the eval/harness subject family used to produce evidence.",
            "- Certification combines validation report + eval report + harness capture + harness replay into one promotion-decision.",
            "- Stable/frozen/demoted transitions require baseline-comparison evidence.",
            "- Freeze transitions require explicit regression evidence before rollout action becomes 'freeze'.",
            "- Context asset promotions require with-context vs without-context comparison and immutable provenance evidence.",
            "- Status semantics are pass, hold, or fail.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "harness replay"
        ? [
            "- --capture-file points to an existing harness-capture-*.json artifact.",
            "- Replay performs compatibility checks against current route/wrapper/prompt/policy/adapter resolution.",
            "- Compatible captures replay eval scoring; incompatible captures persist status='incompatible' with explicit blocked_next_step guidance.",
            "- Replay writes one durable harness-replay-*.json report under runtime reports root.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "asset promote"
        ? [
            "- --asset-ref and --subject-ref are required promotion targets for certification evidence.",
            "- Promote defaults to candidate -> stable, but channels can be overridden for bounded transitions.",
            "- Command reuses certification evidence flow (validation, eval, harness capture/replay) and writes one promotion-decision artifact.",
            "- Status semantics are pass, hold, or fail; inspect promotion_rollout_action and promotion_governance_checks for audit details.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "asset freeze"
        ? [
            "- Freeze defaults to stable -> frozen and enforces explicit freeze-channel guardrails.",
            "- Freeze uses the same certification evidence bar (validation, eval, harness capture/replay).",
            "- Without regression evidence, freeze remains hold with explicit guardrail rationale.",
            "- With regression evidence, rollout_decision.action can become freeze even when final decision status is fail.",
            `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
          ]
      : definition.command === "handoff prepare"
        ? [
            "- --project-ref must point to an existing directory.",
            "- --approved-artifact defaults to bootstrap artifact packet under runtime artifacts root.",
            "- The generated handoff packet is pending approval until 'handoff approve' runs.",
          ]
      : definition.command === "handoff approve"
        ? [
            "- --approval-ref is required and becomes machine-checkable approval evidence.",
            "- --handoff-packet is optional and defaults to bootstrap handoff packet path.",
            "- Approval sets handoff status to approved for downstream execution validation gates.",
          ]
        : definition.command === "intake create"
          ? [
              "- --project-ref must point to an existing directory.",
              "- Intake create writes an intake-request artifact-packet with feature request and optional mission traceability.",
              "- --request-file can carry structured JSON input that discovery and review can trace later.",
              "- --source-kind and --source-ref preserve local issue, PRD, RFC, note, or mail-like source references.",
              "- Product-intake completeness is explicit: goals, constraints, KPIs, Definition of Done, and source refs are reported as present or missing.",
              "- --request-constraints accepts comma-separated values and can be repeated.",
              `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
            ]
          : definition.command === "discovery run"
            ? [
                "- --project-ref must point to an existing directory.",
              "- Discovery run materializes project-analysis plus route/asset/policy/eval registry reports.",
              "- --input-packet links discovery output to one prior intake-request artifact packet.",
              "- --route-overrides and --policy-overrides accept comma-separated step overrides.",
              "- Output includes discovery completeness checks and architecture traceability linkage for planning handoff.",
              "- Output includes discovery research ADR-readiness, open questions, and local research source linkage.",
            ]
          : definition.command === "spec build"
            ? [
                "- --project-ref must point to an existing directory.",
                "- Spec build runs routed dry-run step execution for step_class 'spec'.",
                "- Output includes a durable step-result artifact under runtime reports.",
                "- Spec build enforces discovery completeness gate and blocks when required checks fail.",
                "- Spec build preserves the discovery research gate so ADR-readiness is visible at handoff.",
              ]
              : definition.command === "wave create"
                ? [
                    "- --project-ref must point to an existing directory.",
                    "- Wave create writes wave-ticket and pending handoff-packet artifacts.",
                    "- Use 'aor handoff approve' to promote approval_state before execution-style flows.",
                  ]
          : definition.command === "run start"
            ? [
                "- Starts one deterministic run-control lifecycle, executes one routed live step, and emits live-run events.",
                "- --run-id is optional; when omitted, CLI generates a bounded run id.",
                "- --target-step defaults to implement for full-journey execution start.",
                "- --require-validation-pass defaults to true so execution remains gated by deterministic validation.",
                "- High-risk guardrails still apply when policy requires approval evidence.",
              ]
            : definition.command === "run pause"
              ? [
                  "- Pause transitions only from running state; repeated pause attempts are blocked.",
                  "- Command writes durable control audit evidence even when blocked.",
                  "- Use run resume, run steer, or run cancel for next control actions.",
                ]
              : definition.command === "run resume"
                ? [
                    "- Resume transitions only from paused state; resume on running run is blocked.",
                    "- Command writes durable control audit evidence even when blocked.",
                    "- Use run status --follow for live stream observation after resume.",
                  ]
                : definition.command === "run steer"
                  ? [
                      "- --target-step is required to keep control scope explicit and auditable.",
                      "- High-risk steer requires --approval-ref when policy guardrails demand approval.",
                      "- Successful steer keeps deterministic status while recording target_step intent.",
                    ]
                  : definition.command === "run cancel"
                    ? [
                        "- Cancel transitions only from running or paused state.",
                        "- High-risk cancel requires --approval-ref when policy guardrails demand approval.",
                        "- Command emits terminal control-plane event and durable control audit evidence.",
                      ]
          : definition.command === "run status"
            ? [
                "- This command is read-only. It does not mutate run state.",
                "- --follow=true requires --run-id and reuses the shared live-run event stream protocol.",
                "- When --run-id is set, output includes run_event_history and run_policy_history for troubleshooting.",
                "- Use run start/pause/resume/steer/cancel for bounded control actions.",
              ]
      : definition.command === "packet show"
            ? [
                "- This command is read-only and resolves packet artifacts through the API read surface.",
                "- --family filters contract families (artifact-packet, wave-ticket, handoff-packet, delivery-plan, delivery-manifest, release-packet).",
                "- Use deliver/release prepare to materialize policy-bounded delivery and release artifacts.",
              ]
            : definition.command === "deliver prepare"
              ? [
                  "- Delivery prepare resolves policy bounds and materializes a delivery-plan before driver execution.",
                  "- --mode accepts canonical values only: no-write, patch-only, local-branch, fork-first-pr.",
                  "- Non-no-write modes require approved handoff and promotion evidence refs to pass guardrails.",
                  "- fork-first-pr stays in planning-only mode unless --network-write is explicitly enabled.",
                  "- --network-write requires GitHub credentials (GITHUB_TOKEN) and bounded fork permissions.",
                  "- Multi-repo plans require --coordination-evidence-refs in non-no-write modes.",
                  "- Optional rerun flags persist packet-boundary and failed-step recovery scope for auditable retries.",
                  "- Output includes delivery_governance_decision with explicit allow/deny/escalate reasons.",
                ]
              : definition.command === "release prepare"
                ? [
                    "- Release prepare enforces release preconditions before delivery/release artifact materialization.",
                    "- If preconditions are blocked, the command fails with explicit blocking reasons.",
                    "- Optional rerun flags keep failed-step recovery bounded by explicit packet boundary metadata.",
                    "- Governance deny/escalate reasons are surfaced as machine-readable blocking codes.",
                    "- Successful execution links delivery-manifest and release-packet outputs for audit lineage.",
                  ]
            : definition.command === "evidence show"
              ? [
                  "- This command is read-only and aggregates step, quality, and delivery evidence.",
                  "- --run-id scopes results to one run when contracts include run_id.",
                  "- Use incident open/show and audit runs for incident and run-centric audit actions.",
                ]
              : definition.command === "incident open"
                ? [
                    "- Incident open writes one contract-valid incident-report under runtime reports.",
                    "- --run-id and --summary are required to preserve explicit operator intent and run lineage.",
                    "- Command links run packet, step, quality, and explicit linked-asset refs into one incident record.",
                  ]
                : definition.command === "incident recertify"
                  ? [
                      "- Incident recertify updates one incident-report with recertify/hold/re-enable transitions.",
                      "- Re-enable requires explicit promotion evidence with status=pass.",
                      "- Freeze/demote rollout actions trigger rollback-safe hold instead of direct re-enable.",
                      "- Recertification updates preserve run-linked, finance, and quality evidence refs with explicit roots.",
                    ]
                : definition.command === "incident show"
                  ? [
                      "- Incident show is read-only and supports lookup by --incident-id or --run-id.",
                      "- --limit bounds output size for operator review sessions.",
                      "- Empty result sets are valid when no incident record matches the filter.",
                    ]
                  : definition.command === "audit runs"
                    ? [
                        "- Audit runs is read-only and emits run-centric snapshots for packet, step, quality, and finance evidence refs.",
                        "- Use --run-id to scope one run or --limit for bounded list output.",
                        "- Audit output highlights incident/promotion lineage plus cost/latency signals for traceable governance follow-up.",
                      ]
                  : definition.command === "review run"
                    ? [
                        "- Review run is report-only at the command level and writes one durable review-report artifact.",
                        "- Review verdict checks feature traceability, discovery quality, artifact quality, and code quality.",
                        "- A failing review should be consumed by operator flow; it does not imply CLI transport failure on its own.",
                      ]
                    : definition.command === "learning handoff"
                      ? [
                          "- Learning handoff writes public learning-loop scorecard and handoff artifacts.",
                          "- Existing incident-report linkage is preserved when incident open/recertify already ran for the same run.",
                          "- Use audit runs and incident show to inspect closure lineage after handoff materializes.",
                        ]
                  : definition.command === "ui attach"
                    ? [
                        "- Attach records explicit UI lifecycle state in runtime state artifacts.",
                        "- --control-plane is optional; omit it to record disconnected/read-model mode.",
                        "- Repeating the same attach input is idempotent and reports ui_lifecycle_idempotent=true.",
                      ]
                    : definition.command === "ui detach"
                      ? [
                          "- Detach never stops active workflows and preserves headless CLI/API operation.",
                          "- Repeating detach on an already detached state is idempotent.",
                          "- Detached lifecycle state remains visible through operator surfaces.",
                        ]
      : [
          "- --project-ref must point to an existing directory.",
          `- --runtime-root defaults to '${RUNTIME_ROOT_DIRNAME}' under the resolved project ref.`,
        ];

  const lines = [
    `aor ${definition.command}`,
    definition.summary ?? "No summary available.",
    "",
    statusLine,
    `Inputs: ${(definition.inputs ?? []).join(", ")}`,
    `Outputs: ${(definition.outputs ?? []).join(", ")}`,
    `Contract families: ${(definition.contractFamilies ?? []).join(", ") || "none"}`,
    "",
    "Notes:",
    ...notes,
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * @returns {string}
 */
export function formatTopLevelHelp() {
  const implementedLines = getImplementedCommands().map(
    (definition) => `  - aor ${definition.command}`,
  );
  const plannedLines = getPlannedCommands().map((definition) => `  - aor ${definition.command}`);

  const lines = [
    "AOR CLI command surface",
    "",
    "Implemented commands:",
    ...implementedLines,
    "",
    "Planned commands (not implemented yet):",
    ...plannedLines,
    "",
    "Use 'aor <group> <command> --help' for implemented command contracts.",
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * @param {string[]} args
 * @returns {{ type: "top-help" } | { type: "command-help", command: string } | { type: "execute", command: string, flags: Record<string, string | true> }}
 */
export function parseInvocation(args) {
  if (args.length === 0 || isHelpFlag(args[0])) {
    return { type: "top-help" };
  }

  const [group, verb, ...rest] = args;
  if (!verb || isHelpFlag(verb)) {
    throw new CliUsageError("Command must be '<group> <command>'. Use '--help' for catalog output.");
  }

  const command = `${group} ${verb}`;
  const definition = getCommandDefinition(command);
  if (!definition) {
    throw new CliUsageError(`Unknown command '${command}'. Use '--help' to see available commands.`);
  }

  const flags = parseFlags(rest);

  if (flags.help === true) {
    return { type: "command-help", command };
  }

  return { type: "execute", command, flags };
}

/**
 * @param {string} command
 * @param {Record<string, string | string[] | true>} flags
 * @param {string} cwd
 * @returns {CliResult}
 */
export function executeImplementedCommand(command, flags, cwd) {
  const definition = getCommandDefinition(command);
  if (!definition) {
    throw new CliUsageError(`Unknown command '${command}'.`);
  }

  if (definition.status !== "implemented") {
    throw new CliUsageError(`Command 'aor ${command}' is planned and not implemented yet.`);
  }

  const handlerGroup = resolveCommandHandlerGroup(command);
  if (!handlerGroup) {
    throw new CliUsageError(`Command 'aor ${command}' is implemented but has no CLI handler group.`);
  }

  const outputState = createCliOutputState();

  const handled = executeCommandHandlerGroup({
    groupId: handlerGroup,
    command,
    flags,
    cwd,
    outputState,
  });

  if (!handled) {
    ensureRequiredFlags(command, flags);

    const projectRefInput = /** @type {string} */ (flags["project-ref"]);
    outputState.resolvedProjectRef = resolveProjectRef(projectRefInput, cwd);
    outputState.resolvedRuntimeRoot = resolveRuntimeRoot(flags["runtime-root"], outputState.resolvedProjectRef);
  }

  const contractIndex = getContractFamilyIndex();
  const resolvedFamilies = (definition.contractFamilies ?? []).map((family) => {
    const entry = contractIndex.find((candidate) => candidate.family === family);
    if (!entry) {
      throw new CliUsageError(`Contract family '${family}' is missing from the contract loader index.`);
    }

    return {
      family: entry.family,
      group: entry.familyGroup,
      source_contract: entry.sourceContract,
      status: entry.status,
    };
  });

  const output = buildCliOutput({ command, resolvedFamilies, state: outputState });

  return {
    exitCode: 0,
    stdout: `${JSON.stringify(output, null, 2)}\n`,
    stderr: "",
  };
}
