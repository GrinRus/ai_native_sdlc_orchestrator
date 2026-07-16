import fs from "node:fs";

import { harnessStatePath, readHarnessState } from "./harness.mjs";

export default async function globalTeardown() {
  if (!fs.existsSync(harnessStatePath)) return;
  const state = readHarnessState();
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  fs.rmSync(state.temp_root, { recursive: true, force: true });
  fs.rmSync(harnessStatePath, { force: true });
}
