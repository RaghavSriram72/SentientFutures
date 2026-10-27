// Copies the shared enums (generated from shared/sf_shared/enums.py) into the
// frontend so client components can import labels. Runs before dev and build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "..", "shared", "schema", "enums.json");
const targetDir = path.resolve(here, "..", "lib", "generated");
const target = path.join(targetDir, "enums.json");

if (!fs.existsSync(source)) {
  console.error(`Missing ${source}. Run: python -m sf_shared.export_schema`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log("Synced shared/schema/enums.json -> frontend/lib/generated/enums.json");
