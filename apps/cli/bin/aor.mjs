#!/usr/bin/env node
import process from "node:process";

import { runCli } from "../src/index.mjs";

process.exitCode = runCli(process.argv.slice(2));
