import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const workerHomeRoot = process.env.AOR_TEST_WORKER_HOME_ROOT;

if (workerHomeRoot) {
  const workerHome = path.join(workerHomeRoot, `worker-${process.pid}`);
  fs.mkdirSync(workerHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(workerHome, 0o700);
  process.env.AOR_HOME = workerHome;
}
