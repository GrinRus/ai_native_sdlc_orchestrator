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

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const projectRef = optionalString("project-ref", flags["project-ref"]);
  if (!projectRef) {
    throw new Error("Missing required flag '--project-ref'.");
  }

  const runId = optionalString("run-id", flags["run-id"]);
  const follow = optionalBoolean("follow", flags.follow);
  const runtimeRoot = optionalString("runtime-root", flags["runtime-root"]);
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

  const session = attachOperatorConsoleSession({
    cwd: process.cwd(),
    projectRef,
    runtimeRoot,
    runId,
    follow,
    afterEventId,
    maxReplay,
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

  const detachSummary = session.detach();
  const summary = {
    mode: session.mode,
    project_id: session.snapshot.project.project_id,
    selected_run_id: session.snapshot.selected_run_id,
    run_count: session.snapshot.runs.length,
    follow_enabled: session.follow_enabled,
    stream_protocol: session.stream_protocol,
    detached: detachSummary.detached,
    captured_event_count: detachSummary.captured_event_count,
    rendered_html_file: outputHtml,
    contract_alignment: session.snapshot.api_ui_contract_alignment,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
