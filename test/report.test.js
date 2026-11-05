import { test } from "node:test";
import assert from "node:assert/strict";

import { warningLines } from "../src/report/table.js";

test("unknown-model warning names the pricing file in use", () => {
  const result = { unknownModels: ["claude-opus-9"], notInRegion: [] };

  assert.match(
    warningLines(result).join("\n"),
    /add them to pricing\.config\.json/,
  );
  assert.match(
    warningLines(result, { pricingFile: "./pricing.work.json" }).join("\n"),
    /add them to \.\/pricing\.work\.json/,
  );
});

test("not-in-region warning names the endpoint", () => {
  const lines = warningLines(
    { unknownModels: [], notInRegion: ["claude-opus-5-5"] },
    { region: "us-east5" },
  );

  assert.match(lines.join("\n"), /Not offered at the us-east5 endpoint/);
  assert.ok(lines.includes("   - claude-opus-5-5"));
});
