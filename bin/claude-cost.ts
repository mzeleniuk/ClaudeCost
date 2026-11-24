#!/usr/bin/env node
import { run } from "../src/cli.ts";
import { errorMessage } from "../src/validate.ts";

run(process.argv.slice(2)).catch((err) => {
  console.error(`claude-cost: ${errorMessage(err)}`);
  process.exit(1);
});
