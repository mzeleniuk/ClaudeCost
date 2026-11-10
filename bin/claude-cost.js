#!/usr/bin/env node
// @ts-check
import { run } from "../src/cli.js";

run(process.argv.slice(2)).catch((err) => {
  console.error(`claude-cost: ${err.message}`);
  process.exit(1);
});
