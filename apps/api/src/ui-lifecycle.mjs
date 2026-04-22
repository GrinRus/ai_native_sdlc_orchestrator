import fs from "node:fs";
import path from "node:path";

import { initializeProjectRuntime } from "../../../packages/orchestrator-core/src/project-init.mjs";

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {ReturnType<typeof initializeProjectRuntime>} init
 * @returns {string}
 */
function resolveUiLifecycleStateFile(init) {
  return path.join(init.runtimeLayout.stateRoot, "ui-lifecycle-state.json");
}

/**
 * @param {string} stateFile
 * @param {Record<string, unknown>} state
 */
function writeState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * @returns {Record<string, unknown>}
 */
function defaultState() {
  return {
    schema_version: 1,
    ui_attached: false,
    connection_state: "detached",
    attached_run_id: null,
    last_run_id: null,
    control_plane: null,
    headless_safe: true,
    last_action: null,
    attached_at: null,
    detached_at: null,
    updated_at: nowIso(),
    attach_count: 0,
    detach_count: 0,
  };
}

/**
 * @param {string} stateFile
 * @returns {Record<string, unknown>}
 */
function readState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  return {
    ...defaultState(),
    ...(typeof parsed === "object" && parsed !== null ? parsed : {}),
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 * }} options
 */
export function readUiLifecycleState(options) {
  const init = initializeProjectRuntime(options);
  const stateFile = resolveUiLifecycleStateFile(init);
  const state = readState(stateFile);

  return {
    projectRoot: init.projectRoot,
    projectProfileRef: init.projectProfileRef,
    runtimeRoot: init.runtimeRoot,
    runtimeLayout: init.runtimeLayout,
    stateFile,
    state,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 *   controlPlane?: string,
 * }} options
 */
export function attachUiLifecycle(options) {
  const snapshot = readUiLifecycleState(options);
  const runId = asString(options.runId);
  const controlPlane = asString(options.controlPlane);
  const connectionState = controlPlane ? "connected" : "disconnected";

  const wasAttached = snapshot.state.ui_attached === true;
  const sameRun = asString(snapshot.state.attached_run_id) === runId;
  const sameControlPlane = asString(snapshot.state.control_plane) === controlPlane;
  const sameConnection = asString(snapshot.state.connection_state) === connectionState;
  const idempotent = wasAttached && sameRun && sameControlPlane && sameConnection;

  const attachCountRaw = Number(snapshot.state.attach_count);
  const attachCount = Number.isFinite(attachCountRaw) ? attachCountRaw : 0;

  const nextState = {
    ...snapshot.state,
    ui_attached: true,
    connection_state: connectionState,
    attached_run_id: runId,
    last_run_id: runId ?? asString(snapshot.state.last_run_id),
    control_plane: controlPlane,
    headless_safe: true,
    last_action: "attach",
    attached_at: idempotent ? snapshot.state.attached_at : nowIso(),
    updated_at: nowIso(),
    attach_count: idempotent ? attachCount : attachCount + 1,
  };

  writeState(snapshot.stateFile, nextState);

  return {
    ...snapshot,
    action: "attach",
    idempotent,
    state: nextState,
  };
}

/**
 * @param {{
 *   cwd?: string,
 *   projectRef: string,
 *   runtimeRoot?: string,
 *   runId?: string,
 * }} options
 */
export function detachUiLifecycle(options) {
  const snapshot = readUiLifecycleState(options);
  const requestedRunId = asString(options.runId);
  const previouslyAttached = snapshot.state.ui_attached === true;
  const idempotent = !previouslyAttached;

  const detachCountRaw = Number(snapshot.state.detach_count);
  const detachCount = Number.isFinite(detachCountRaw) ? detachCountRaw : 0;
  const lastRunId = requestedRunId ?? asString(snapshot.state.attached_run_id) ?? asString(snapshot.state.last_run_id);

  const nextState = {
    ...snapshot.state,
    ui_attached: false,
    connection_state: "detached",
    attached_run_id: null,
    last_run_id: lastRunId,
    control_plane: null,
    headless_safe: true,
    last_action: "detach",
    detached_at: idempotent ? snapshot.state.detached_at : nowIso(),
    updated_at: nowIso(),
    detach_count: idempotent ? detachCount : detachCount + 1,
  };

  writeState(snapshot.stateFile, nextState);

  return {
    ...snapshot,
    action: "detach",
    idempotent,
    state: nextState,
  };
}
