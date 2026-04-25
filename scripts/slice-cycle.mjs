#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import {
  VALID_STATES,
  applySliceStateTransition,
  applyStateSyncChanges,
  computeStateSyncChanges,
  getSlicePlan,
  loadBacklogModel,
  selectNextSlice,
  summarizeStates,
} from "./slice-cycle-lib.mjs";

function usage() {
  console.log(`Slice cycle helper for AOR backlog.

Usage:
  node scripts/slice-cycle.mjs status
  node scripts/slice-cycle.mjs next [--json]
  node scripts/slice-cycle.mjs plan [SLICE_ID] [--json]
  node scripts/slice-cycle.mjs gate
  node scripts/slice-cycle.mjs transition SLICE_ID STATE [--apply] [--force]
  node scripts/slice-cycle.mjs complete SLICE_ID [--apply] [--force]
  node scripts/slice-cycle.mjs sync-ready [--apply]

Notes:
- 'transition', 'complete', and 'sync-ready' default to dry-run unless '--apply' is provided.
- STATE must be one of: ready, blocked, active, done.
`);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printSelection(selection) {
  if (selection.mode === "complete") {
    console.log("All slices are done. No next slice to pick.");
    return;
  }

  if (!selection.slice) {
    console.log("No slice selected.");
    return;
  }

  console.log(`Mode: ${selection.mode}`);
  console.log(`Slice: ${selection.slice.sliceId} — ${selection.slice.title}`);
  console.log(`State: ${selection.slice.state}`);

  if (selection.mode === "ready" && selection.readyCandidates.length > 1) {
    console.log(`Ready candidates (topological order): ${selection.readyCandidates.join(", ")}`);
  }

  if (selection.mode === "unblocker" && selection.blockedTarget) {
    console.log(`Blocked target: ${selection.blockedTarget.sliceId} — ${selection.blockedTarget.title}`);
    if (selection.blockedChain.length > 0) {
      console.log(`Unresolved dependency chain: ${selection.blockedChain.join(" -> ")}`);
    }
    if (selection.externalBlocker) {
      console.log(`External blocker: ${selection.externalBlocker}`);
    }
  }
}

function printPlan(plan) {
  console.log(`Slice: ${plan.sliceId} — ${plan.title}`);
  console.log(`Epic: ${plan.epic}`);
  console.log(`State: ${plan.state}`);
  console.log(`Wave doc: ${plan.waveFile}`);
  console.log(
    `Hard dependencies: ${plan.hardDependencies.length > 0 ? plan.hardDependencies.join(", ") : "none"}`,
  );
  if (plan.externalBlocker) {
    console.log(`External blocker: ${plan.externalBlocker}`);
  }

  console.log("\nLocal tasks:");
  if (plan.localTasks.length === 0) {
    console.log("- none");
  } else {
    plan.localTasks.forEach((item, index) => console.log(`${index + 1}. ${item}`));
  }

  console.log("\nAcceptance criteria:");
  if (plan.acceptanceCriteria.length === 0) {
    console.log("- none");
  } else {
    plan.acceptanceCriteria.forEach((item, index) => console.log(`${index + 1}. ${item}`));
  }

  console.log("\nDone evidence:");
  if (plan.doneEvidence.length === 0) {
    console.log("- none");
  } else {
    for (const item of plan.doneEvidence) {
      console.log(`- ${item}`);
    }
  }
}

function runPnpmScript(scriptName) {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpmCmd, [scriptName], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`Command failed: pnpm ${scriptName}`);
    process.exit(code);
  }
}

function runGate() {
  const commands = ["lint", "test", "build", "check"];
  for (const command of commands) {
    runPnpmScript(command);
  }
  console.log("Check gate passed: lint, test, build, and check completed successfully.");
}

function executeTransition(args) {
  const sliceId = args[0];
  const nextState = args[1];

  if (!sliceId || !nextState) {
    throw new Error("transition requires SLICE_ID and STATE arguments.");
  }

  if (!VALID_STATES.has(nextState)) {
    throw new Error(`Unsupported state '${nextState}'. Expected one of: ${[...VALID_STATES].join(", ")}.`);
  }

  const apply = hasFlag(args, "--apply");
  const force = hasFlag(args, "--force");

  const model = loadBacklogModel(process.cwd());

  if (!apply) {
    console.log(`Dry-run: would set ${sliceId} -> ${nextState}. Use --apply to write changes.`);
    return;
  }

  applySliceStateTransition(model, sliceId, nextState, { force });
  console.log(`Updated state: ${sliceId} -> ${nextState}`);
}

function executeSyncReady(args) {
  const apply = hasFlag(args, "--apply");
  const model = loadBacklogModel(process.cwd());
  const changes = computeStateSyncChanges(model);

  if (changes.length === 0) {
    console.log("No state sync changes required.");
    return;
  }

  for (const change of changes) {
    console.log(`${change.sliceId}: ${change.currentState} -> ${change.nextState}`);
  }

  if (!apply) {
    console.log("Dry-run complete. Use --apply to write changes.");
    return;
  }

  applyStateSyncChanges(model, changes);
  console.log(`Applied ${changes.length} state sync change(s).`);
}

function executeStatus() {
  const model = loadBacklogModel(process.cwd());
  const summary = summarizeStates(model);
  const selection = selectNextSlice(model);

  console.log(`Slices: total=${summary.total}, ready=${summary.ready}, active=${summary.active}, blocked=${summary.blocked}, done=${summary.done}`);
  printSelection(selection);
}

function executeNext(args) {
  const asJson = hasFlag(args, "--json");
  const model = loadBacklogModel(process.cwd());
  const selection = selectNextSlice(model);

  if (asJson) {
    const payload = {
      mode: selection.mode,
      slice: selection.slice
        ? {
            slice_id: selection.slice.sliceId,
            title: selection.slice.title,
            state: selection.slice.state,
            epic: selection.slice.epic,
            wave_file: selection.slice.waveFile,
            hard_dependencies: selection.slice.hardDependencies,
            external_blocker: selection.slice.externalBlocker ?? null,
          }
        : null,
      ready_candidates: selection.readyCandidates,
      blocked_target: selection.blockedTarget
        ? {
            slice_id: selection.blockedTarget.sliceId,
            title: selection.blockedTarget.title,
          }
        : null,
      blocked_chain: selection.blockedChain,
      external_blocker: selection.externalBlocker ?? null,
    };

    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printSelection(selection);
}

function executePlan(args) {
  const asJson = hasFlag(args, "--json");
  const explicitSliceId = args.find((item) => /^W\d+-S\d+$/.test(item));

  const model = loadBacklogModel(process.cwd());

  let sliceId = explicitSliceId;
  if (!sliceId) {
    const selection = selectNextSlice(model);
    if (!selection.slice) {
      throw new Error("No slice selected for plan output. Backlog may already be complete.");
    }
    sliceId = selection.slice.sliceId;
  }

  const plan = getSlicePlan(model, sliceId);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          slice_id: plan.sliceId,
          title: plan.title,
          epic: plan.epic,
          state: plan.state,
          wave_file: plan.waveFile,
          hard_dependencies: plan.hardDependencies,
          external_blocker: plan.externalBlocker ?? null,
          local_tasks: plan.localTasks,
          acceptance_criteria: plan.acceptanceCriteria,
          done_evidence: plan.doneEvidence,
          out_of_scope: plan.outOfScope,
        },
        null,
        2,
      ),
    );
    return;
  }

  printPlan(plan);
}

function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  switch (command) {
    case "status": {
      executeStatus();
      return;
    }
    case "next": {
      executeNext(args);
      return;
    }
    case "plan": {
      executePlan(args);
      return;
    }
    case "gate": {
      runGate();
      return;
    }
    case "transition": {
      executeTransition(args);
      return;
    }
    case "complete": {
      if (args.length === 0) {
        throw new Error("complete requires SLICE_ID argument.");
      }
      executeTransition([args[0], "done", ...args.slice(1)]);
      return;
    }
    case "sync-ready": {
      executeSyncReady(args);
      return;
    }
    default: {
      throw new Error(`Unknown command '${command}'. Run with 'help' to see available commands.`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
