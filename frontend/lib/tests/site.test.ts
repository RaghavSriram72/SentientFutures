// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "lib/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRIMARY_NAV, SECONDARY_NAV, startsMenuOnlyEnd, type NavItem } from "../site";

describe("startsMenuOnlyEnd", () => {
  test("puts the line above Methodology only, not above Compare", () => {
    const marked: string[] = [];
    for (let i = 0; i < PRIMARY_NAV.length; i++) {
      if (startsMenuOnlyEnd(PRIMARY_NAV, i)) {
        marked.push(PRIMARY_NAV[i].label);
      }
    }
    assert.deepEqual(marked, ["Methodology"]);
  });

  test("marks nothing when the list doesn't end on menu-only pages", () => {
    const items: NavItem[] = [
      { href: "/a/", label: "A" },
      { href: "/b/", label: "B", menuOnly: true },
      { href: "/c/", label: "C" },
    ];
    assert.equal(startsMenuOnlyEnd(items, 1), false);
  });
});

describe("the evidence register link", () => {
  test("is in the footer", () => {
    const hrefs = SECONDARY_NAV.map((item) => item.href);
    assert.ok(hrefs.includes("/evidence/"));
  });

  test("is not in the header or the phone menu", () => {
    const hrefs = PRIMARY_NAV.map((item) => item.href);
    assert.ok(!hrefs.includes("/evidence/"));
  });
});
