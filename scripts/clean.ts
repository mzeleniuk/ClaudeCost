import fs from "node:fs";
import path from "node:path";

// tsc does not delete outputs of removed or renamed sources, so start each build empty.
fs.rmSync(path.join(import.meta.dirname, "../dist"), { recursive: true, force: true });
