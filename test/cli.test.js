import { test } from "node:test";
import assert from "node:assert/strict";

import { run } from "../src/cli.js";

test("rejects --by-model together with --by-month", async () => {
  await assert.rejects(
    run(["--by-model", "--by-month"]),
    /use either --by-model or --by-month, not both/,
  );
});

test("rejects an invalid --since before scanning anything", async () => {
  await assert.rejects(run(["--since", "1"]), /invalid --since value: "1"/);
});
