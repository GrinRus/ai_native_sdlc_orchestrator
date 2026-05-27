#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { attachOperatorConsoleSession } from "../src/operator-console.mjs";

/**
 * @param {string[]} args
 * @returns {Record<string, string | true>}
 */
function parseFlags(args) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) {
      throw new Error(`Unexpected argument '${current}'.`);
    }
    const [rawName, inlineValue] = current.split("=", 2);
    const name = rawName.slice(2);
    if (!name) {
      throw new Error(`Invalid flag '${current}'.`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      throw new Error(`Duplicate flag '--${name}'.`);
    }
    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
      continue;
    }
    flags[name] = true;
  }
  return flags;
}

/**
 * @param {string} flag
 * @param {string | true | undefined} value
 * @returns {string | undefined}
 */
function optionalString(flag, value) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new Error(`Flag '--${flag}' requires a value.`);
  }
  return value;
}

/**
 * @param {string} flag
 * @param {string | true | undefined} value
 * @returns {boolean}
 */
function optionalBoolean(flag, value) {
  if (value === undefined) return false;
  if (value === true || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Flag '--${flag}' accepts only true or false.`);
}

/**
 * @param {string | undefined} outputFile
 */
function ensureParentDir(outputFile) {
  if (!outputFile) return;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {string} outputHtml
 * @param {string} suffix
 * @param {string} extension
 */
function siblingEvidencePath(outputHtml, suffix, extension) {
  const parsed = path.parse(outputHtml);
  return path.join(parsed.dir, `${parsed.name}-${suffix}${extension}`);
}

/**
 * @param {ReturnType<typeof attachOperatorConsoleSession> extends Promise<infer T> ? T : never} session
 * @param {string} html
 */
function buildDomSnapshot(session, html) {
  return {
    snapshot_kind: "static-rendered-operator-console",
    project_id: session.snapshot.project.project_id,
    selected_run_id: session.snapshot.selected_run_id,
    run_count: session.snapshot.runs.length,
    interaction_count: Array.isArray(session.snapshot.run_detail.interactions)
      ? session.snapshot.run_detail.interactions.length
      : 0,
    evidence_link_count: Array.isArray(session.snapshot.run_detail.evidence_refs)
      ? session.snapshot.run_detail.evidence_refs.length
      : 0,
    guided_lifecycle_state: session.snapshot.guided_lifecycle?.state ?? "unknown",
    guided_current_stage_id: session.snapshot.guided_lifecycle?.current_stage_id ?? "unknown",
    rendered_html_length: html.length,
    visible_text_markers: {
      has_run_list: html.includes("Runs") || html.includes("Run"),
      has_selected_run_detail: html.includes(String(session.snapshot.selected_run_id ?? "")),
      has_interaction_surface: html.includes("interaction") || html.includes("Interaction"),
      has_evidence_surface: html.includes("Evidence") || html.includes("evidence"),
      has_closure_state: html.includes("closure") || html.includes("Closure") || html.includes("Next action"),
    },
  };
}

/**
 * @param {Record<string, unknown>} domSnapshot
 */
function buildAccessibilitySummary(domSnapshot) {
  const markers = typeof domSnapshot.visible_text_markers === "object" && domSnapshot.visible_text_markers
    ? /** @type {Record<string, unknown>} */ (domSnapshot.visible_text_markers)
    : {};
  const findings = [];
  if (markers.has_run_list !== true) findings.push("run list marker was not visible in static HTML");
  if (markers.has_selected_run_detail !== true) findings.push("selected run marker was not visible in static HTML");
  if (markers.has_evidence_surface !== true) findings.push("evidence marker was not visible in static HTML");
  return {
    audit_kind: "static-html-accessibility-smoke",
    status: findings.length > 0 ? "warn" : "pass",
    checks: {
      static_html_rendered: Number(domSnapshot.rendered_html_length) > 0,
      run_list_marker_visible: markers.has_run_list === true,
      selected_run_marker_visible: markers.has_selected_run_detail === true,
      evidence_marker_visible: markers.has_evidence_surface === true,
      closure_marker_visible: markers.has_closure_state === true,
    },
    findings,
  };
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} summary
 */
function writeSvgSnapshot(filePath, summary) {
  const lines = [
    `AOR Operator Console`,
    `Project: ${String(summary.project_id ?? "unknown")}`,
    `Run: ${String(summary.selected_run_id ?? "none")}`,
    `Runs: ${String(summary.run_count ?? 0)}`,
    `Interactions: ${String(summary.interaction_count ?? 0)}`,
    `Lifecycle: ${String(summary.guided_lifecycle_state ?? "unknown")}`,
  ];
  const text = lines
    .map((line, index) => `<text x="24" y="${42 + index * 28}" font-size="18">${escapeXml(line)}</text>`)
    .join("\n");
  fs.writeFileSync(
    filePath,
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">',
      '<rect width="960" height="360" fill="#f8fafc"/>',
      '<rect x="16" y="16" width="928" height="328" fill="#ffffff" stroke="#94a3b8"/>',
      `<g font-family="Arial, sans-serif" fill="#0f172a">${text}</g>`,
      "</svg>",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const projectRef = optionalString("project-ref", flags["project-ref"]);
  if (!projectRef) {
    throw new Error("Missing required flag '--project-ref'.");
  }

  const runId = optionalString("run-id", flags["run-id"]);
  const follow = optionalBoolean("follow", flags.follow);
  const runtimeRoot = optionalString("runtime-root", flags["runtime-root"]);
  const controlPlane = optionalString("control-plane", flags["control-plane"]);
  const controlPlaneAuthToken = optionalString("control-plane-auth-token", flags["control-plane-auth-token"]);
  const afterEventId = optionalString("after-event-id", flags["after-event-id"]);
  const outputHtmlFlag = optionalString("output-html", flags["output-html"]);
  const maxReplayRaw = optionalString("max-replay", flags["max-replay"]);
  const maxReplay = maxReplayRaw ? Number.parseInt(maxReplayRaw, 10) : undefined;

  if (maxReplayRaw && Number.isNaN(maxReplay)) {
    throw new Error("Flag '--max-replay' must be an integer.");
  }
  if (follow && !runId) {
    throw new Error("Flag '--run-id' is required when '--follow' is enabled.");
  }

  const session = await attachOperatorConsoleSession({
    cwd: process.cwd(),
    projectRef,
    runtimeRoot,
    runId,
    follow,
    afterEventId,
    maxReplay,
    controlPlane,
    controlPlaneAuthToken,
  });

  const html = session.render();
  const outputHtml =
    outputHtmlFlag ??
    path.join(
      session.snapshot.project.runtime_root,
      "web",
      `operator-console-${session.snapshot.selected_run_id ?? "no-run"}.html`,
    );
  ensureParentDir(outputHtml);
  fs.writeFileSync(outputHtml, html, "utf8");
  const domSnapshotFile = siblingEvidencePath(outputHtml, "dom-snapshot", ".json");
  const accessibilitySummaryFile = siblingEvidencePath(outputHtml, "accessibility", ".json");
  const visualSnapshotFile = siblingEvidencePath(outputHtml, "visual-snapshot", ".svg");
  const domSnapshot = buildDomSnapshot(session, html);
  const accessibilitySummary = buildAccessibilitySummary(domSnapshot);
  fs.writeFileSync(domSnapshotFile, `${JSON.stringify(domSnapshot, null, 2)}\n`, "utf8");
  fs.writeFileSync(accessibilitySummaryFile, `${JSON.stringify(accessibilitySummary, null, 2)}\n`, "utf8");
  writeSvgSnapshot(visualSnapshotFile, {
    project_id: session.snapshot.project.project_id,
    selected_run_id: session.snapshot.selected_run_id,
    run_count: session.snapshot.runs.length,
    interaction_count: Array.isArray(session.snapshot.run_detail.interactions)
      ? session.snapshot.run_detail.interactions.length
      : 0,
    guided_lifecycle_state: session.snapshot.guided_lifecycle?.state ?? "unknown",
  });

  const detachSummary = session.detach();
  await session.awaitStreamIdle();
  const checkedTasks = [
    "run-list-rendered",
    "selected-run-detail-rendered",
    "operator-request-surface-rendered",
    "evidence-links-rendered",
    "closure-state-rendered",
  ];
  const taskOutcome = {
    status: accessibilitySummary.status === "pass" || accessibilitySummary.status === "warn" ? "pass" : "not_pass",
    checked_tasks: checkedTasks,
    findings: accessibilitySummary.findings,
  };
  const summary = {
    mode: session.mode,
    project_id: session.snapshot.project.project_id,
    selected_run_id: session.snapshot.selected_run_id,
    run_count: session.snapshot.runs.length,
    follow_enabled: session.follow_enabled,
    stream_protocol: session.stream_protocol,
    detached: detachSummary.detached,
    captured_event_count: detachSummary.captured_event_count,
    lifecycle_command_count: Array.isArray(session.snapshot.api_ui_contract_alignment.lifecycle_commands)
      ? session.snapshot.api_ui_contract_alignment.lifecycle_commands.length
      : 0,
    interaction_count: Array.isArray(session.snapshot.run_detail.interactions)
      ? session.snapshot.run_detail.interactions.length
      : 0,
    guided_lifecycle_state: session.snapshot.guided_lifecycle?.state ?? "unknown",
    guided_current_stage_id: session.snapshot.guided_lifecycle?.current_stage_id ?? "unknown",
    guided_stage_count: Array.isArray(session.snapshot.guided_lifecycle?.stages)
      ? session.snapshot.guided_lifecycle.stages.length
      : 0,
    rendered_html_file: outputHtml,
    dom_snapshot_file: domSnapshotFile,
    accessibility_summary_file: accessibilitySummaryFile,
    screenshot_files: [visualSnapshotFile],
    task_outcome: taskOutcome,
    ux_findings: accessibilitySummary.findings,
    contract_alignment: session.snapshot.api_ui_contract_alignment,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exit(0);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
