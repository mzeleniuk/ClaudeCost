import { test } from "node:test";
import assert from "node:assert/strict";

import { fileLink } from "../src/dashboard/output.js";

test("fileLink turns a path into a file:// link", () => {
  assert.equal(
    fileLink("/Users/me/claude-cost/data/dashboard.html", { windows: false }),
    "file:///Users/me/claude-cost/data/dashboard.html",
  );
});

test("fileLink percent-encodes characters that would break the link", () => {
  assert.equal(
    fileLink("/Users/me/My Stuff/#1 100%/проект.html", { windows: false }),
    "file:///Users/me/My%20Stuff/%231%20100%25/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82.html",
  );
});

test("fileLink builds a Windows link from a drive path", () => {
  assert.equal(
    fileLink("C:\\Users\\me\\My Stuff\\dashboard.html", { windows: true }),
    "file:///C:/Users/me/My%20Stuff/dashboard.html",
  );
});
