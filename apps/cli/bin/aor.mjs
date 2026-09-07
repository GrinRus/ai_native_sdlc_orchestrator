#!/usr/bin/env node
import process from "node:process";

// A follow-mode child can receive SIGINT while the CLI's static module graph
// is still loading. Install a temporary guard before the dynamic import so
// the signal is handed to the follow lifecycle instead of terminating the
// process with the default signal action.
const cliArgs = process.argv.slice(2);
const followFlagIndex = cliArgs.indexOf("--follow");
const followFlag = followFlagIndex >= 0
  ? cliArgs[followFlagIndex + 1] ?? "true"
  : cliArgs.find((arg) => arg.startsWith("--follow="))?.slice("--follow=".length);
const isFollowInvocation =
  cliArgs[0] === "run" &&
  cliArgs[1] === "status" &&
  followFlag !== undefined &&
  followFlag !== "false";
let interruptedDuringBootstrap = false;
const onBootstrapSigint = () => {
  interruptedDuringBootstrap = true;
};
if (isFollowInvocation) process.once("SIGINT", onBootstrapSigint);
const { runCli } = await import("../src/index.mjs");
if (isFollowInvocation) process.off("SIGINT", onBootstrapSigint);

process.exitCode = await runCli(cliArgs, {
  interruptedDuringBootstrap,
});
