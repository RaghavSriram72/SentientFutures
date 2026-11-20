// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

// The production build orders its CSS the way app/layout.tsx imports it. When
// globals.css came after the components there, the build put the home page's
// own styles first, and global classes such as .chip and .eyebrow overrode
// them. The dev server never shows this, so the check reads the source.
describe("app/layout.tsx", () => {
  test("imports globals.css before anything else", () => {
    const source = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
    const imports: string[] = [];
    for (const line of source.split("\n")) {
      if (line.startsWith("import ")) {
        imports.push(line);
      }
    }
    assert.equal(imports[0], 'import "./globals.css";');
  });
});
