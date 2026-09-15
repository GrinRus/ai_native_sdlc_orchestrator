#!/usr/bin/env node
import process from "node:process";

import {
  isSupportedNodeVersion,
  unsupportedNodeVersionMessage,
} from "../../../packages/orchestrator-core/src/node-runtime.mjs";

if (!isSupportedNodeVersion()) {
  process.stderr.write(`[AOR] ${unsupportedNodeVersionMessage()}\n`);
  process.exit(1);
}
