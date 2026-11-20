// The home teaser's budgets: a front-row card must never cover the stage line
// at the bottom of the back-row cards behind it, and every row's small lines
// must still draw at 11px. Also checks that the fit settles the text floors,
// and the two-row layout small phones get (needsFewerRows, neighbourGap).
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/timeline3d/tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { MilestoneView } from "@/lib/estimates";
import type { Milestone } from "@/lib/types";

import type { TimelineItem } from "../../timeline/timelineModel";
import {
  CARD_WIDTH,
  FEWER_ROW_COUNT,
  fitScale,
  frontRowClearance,
  layoutTrack,
  MIN_DRAWN_TEXT,
  needsFewerRows,
  neighbourGap,
  ROW_COUNT,
  rowDrawScale,
  settleScale,
  TEASER_CAMERA,
  TEASER_MIN_HEIGHT,
  TEASER_SHORT_CAMERA,
  textFloors,
  type FloorView,
  type TrackItem,
} from "../trackLayout";

// The tallest card in each row of the home teaser (rows 0, 1 and 2), in
// world pixels, with a little room for longer text. Measured 2026-11-17 on
// the home page, 480px tall with TEASER_CAMERA, with the type line on every
// card and the text floors settled (20.1, 22.9 and 25.7px): the front row's
// tallest was 380 (WBE-03: the longest name, and "Welfare and governance" on
// two lines), the back row's 311 (WBE-02 and WBE-04). Row 1 is empty there.
// These are fixed numbers, so a CSS change that makes cards taller never
// reaches this test on its own: if a card gains a line, re-measure and update
// them. The tests then fail if ROW_DEPTHS, the teaser camera or its height
// no longer leave room (with these heights, a 474px teaser would draw the
// back row's small lines at 10.997px).
const TEASER_ROW_HEIGHTS = [385, 0, 315];
// The same on a short window, where the CSS caps the teaser and it switches
// to TEASER_SHORT_CAMERA. Measured 2026-11-17 at 420px tall, with the floors
// at 23.6, 24.7 and 25.7px: the front row's tallest was 400, the back row's 311.
// 420px is TEASER_MIN_HEIGHT, the shortest the cap can make the teaser
// (checked 2026-11-17: windows 501 to 516px tall all gave 420px, where
// before the floor a 501px window gave 405px and drew the back row at 10.75px).
const SHORT_TEASER_ROW_HEIGHTS = [405, 0, 315];
const SHORT_TEASER_HEIGHT = TEASER_MIN_HEIGHT;
// The least room, in screen pixels, between a front card's top and the back
// row's feet. The back cards' bottom padding sits on top of that.
const MIN_CLEARANCE = 8;

interface TeaserCase {
  name: string;
  view: FloorView;
  rowHeights: number[];
}

function teaserView(camera: typeof TEASER_CAMERA, height: number): FloorView {
  return {
    height,
    floorBottom: camera.floorBottom,
    horizon: camera.horizon,
    perspective: camera.perspective,
    tiltDeg: camera.tiltDeg,
  };
}

const TEASER_CASES: TeaserCase[] = [
  {
    name: `the teaser at its full ${TEASER_CAMERA.height}px`,
    view: teaserView(TEASER_CAMERA, TEASER_CAMERA.height),
    rowHeights: TEASER_ROW_HEIGHTS,
  },
  {
    name: `the teaser at its shortest, ${SHORT_TEASER_HEIGHT}px, on a short window`,
    view: teaserView(TEASER_SHORT_CAMERA, SHORT_TEASER_HEIGHT),
    rowHeights: SHORT_TEASER_ROW_HEIGHTS,
  },
];

// The teaser at its full height, for the settleScale test.
const fullTeaserView = TEASER_CASES[0].view;

function teaserScale(teaser: TeaserCase): number {
  return fitScale(teaser.view, teaser.rowHeights, TEASER_CAMERA.safeTop, TEASER_CAMERA.maxScale);
}

describe("frontRowClearance", () => {
  for (const teaser of TEASER_CASES) {
    test(`${teaser.name}: the front cards stay below the back row's feet`, () => {
      const clearance = frontRowClearance(teaser.view, teaserScale(teaser), teaser.rowHeights[0]);
      assert.ok(
        clearance >= MIN_CLEARANCE,
        `front cards end ${clearance.toFixed(1)}px below the back row's feet, less than ${MIN_CLEARANCE}px`,
      );
    });
  }

  test("a front card tall enough to reach the back row gives a negative clearance", () => {
    const teaser = TEASER_CASES[0];
    assert.ok(frontRowClearance(teaser.view, teaserScale(teaser), teaser.rowHeights[0] * 2) < 0);
  });
});

describe("textFloors", () => {
  for (const teaser of TEASER_CASES) {
    test(`${teaser.name}: every row can draw its small lines at 11px`, () => {
      const scale = teaserScale(teaser);
      const floors = textFloors(teaser.view, scale);
      for (let row = 0; row < floors.length; row++) {
        const drawn = floors[row] * rowDrawScale(teaser.view, scale, row);
        assert.ok(drawn >= MIN_DRAWN_TEXT, `row ${row}'s small lines draw at ${drawn.toFixed(2)}px`);
      }
    });
  }
});

describe("settleScale", () => {
  test("the floors it leaves set still draw at 11px at the scale it returns", () => {
    // A stand-in for the cards: each pixel of text floor makes the front
    // card 3px taller and the back card 4px taller (the back one has more
    // floored lines that wrap).
    let floors = [0, 0, 0];
    const heightsNow = () => [300 + 3 * floors[0], 0, 210 + 4 * floors[2]];
    const scale = settleScale(
      () => fitScale(fullTeaserView, heightsNow(), TEASER_CAMERA.safeTop, TEASER_CAMERA.maxScale),
      (fitted) => {
        floors = textFloors(fullTeaserView, fitted);
      },
    );
    for (const row of [0, 2]) {
      const drawn = floors[row] * rowDrawScale(fullTeaserView, scale, row);
      assert.ok(drawn >= MIN_DRAWN_TEXT - 0.05, `row ${row}'s small lines draw at ${drawn.toFixed(2)}px`);
    }
  });
});

// ---------- Two rows on a small phone ----------

// The full track's camera on a phone (TrackScene's geometryFor: tilt 50,
// perspective 2400, horizon 0.06, world scale at most 0.62), with the floor's
// front edge and the top bar's bottom as measured 2026-11-17 on the dev
// server, touch, DPR 2. The safe top is the top bar's bottom (139) + 12.
const PHONE = { horizon: 0.06, perspective: 2400, tiltDeg: 50, maxScale: 0.62, safeTop: 151 };

function phoneView(height: number, floorBottom: number): FloorView {
  return { height, floorBottom, horizon: PHONE.horizon, perspective: PHONE.perspective, tiltDeg: PHONE.tiltDeg };
}

describe("needsFewerRows", () => {
  // The tallest card in each of the three rows, with the floors the three
  // rows settle at, measured 2026-11-17 on /styleguide/track/ (Show: All),
  // whose sample cards carry estimate text as dated milestones will. At
  // 320x700 the floors all hit their 26px cap and the back row's small lines
  // drew at 9.99px.
  test("a 320x700 phone with dated cards gets two rows", () => {
    assert.equal(needsFewerRows(phoneView(700, 119), [414, 515, 451], PHONE.safeTop, PHONE.maxScale, false), true);
  });

  // Today's real /timeline/ at 320x700 (no dates yet, rows 0 and 2 only):
  // its small lines drew at 11.01px in three rows.
  test("today's real timeline at 320x700 keeps three rows", () => {
    assert.equal(needsFewerRows(phoneView(700, 119), [401, 0, 347], PHONE.safeTop, PHONE.maxScale, false), false);
  });

  test("once in two rows, going back to three takes a margin", () => {
    // The same cards as above, 0.01px over the line: not enough to switch back.
    assert.equal(needsFewerRows(phoneView(700, 119), [401, 0, 347], PHONE.safeTop, PHONE.maxScale, true), true);
  });

  // /styleguide/track/ at 390x844, where three rows drew at 11.03px.
  test("a 390x844 phone keeps three rows, even with dated cards", () => {
    assert.equal(needsFewerRows(phoneView(844, 143), [376, 435, 379], PHONE.safeTop, PHONE.maxScale, false), false);
  });
});

// The least room, in screen pixels, between a front card and a middle-row card
// beside it in the two-row layout.
const MIN_SIDE_GAP = 4;

describe("neighbourGap", () => {
  // The two-row layout is only used on a phone, under 600px wide, so a card's
  // edge is at most 300px from the middle of the screen. The largest world
  // scale draws the front card the most spread out.
  test("on the widest phone at the largest scale, a front card stays clear of the card beside it", () => {
    const gap = neighbourGap(phoneView(844, 143), PHONE.maxScale, 300);
    assert.ok(gap >= MIN_SIDE_GAP, `the cards are ${gap.toFixed(1)}px apart at the screen's side, less than ${MIN_SIDE_GAP}px`);
  });

  test("the gap shrinks toward the sides of the screen", () => {
    const view = phoneView(844, 143);
    assert.ok(neighbourGap(view, PHONE.maxScale, 300) < neighbourGap(view, PHONE.maxScale, 100));
  });
});

// A stand-in for a milestone on the track, with only what layoutTrack reads:
// achieved in `year`, or with no date at all (it then stands in the Timing
// unknown zone).
function fakeItem(id: string, year: number | null): TimelineItem {
  const view = {
    barMode: year === null ? "none" : "achieved",
    bar: null,
    achievedIn: year,
    forecasts: [],
  } as unknown as MilestoneView;
  return { milestone: { id, technology: "wbe" } as unknown as Milestone, view, code: id };
}

// Eight dated milestones bunched into two years, so they crowd every row,
// and five with no date.
const CROWDED: TimelineItem[] = [];
for (let i = 0; i < 8; i++) {
  CROWDED.push(fakeItem(`dated-${i}`, i < 4 ? 2030 : 2031));
}
for (let i = 0; i < 5; i++) {
  CROWDED.push(fakeItem(`unknown-${i}`, null));
}

function overlap(a: TrackItem, b: TrackItem): boolean {
  return Math.abs(a.x - b.x) < CARD_WIDTH;
}

describe("layoutTrack with two rows", () => {
  const two = layoutTrack(CROWDED, new Set(["wbe"]), 2026, FEWER_ROW_COUNT);

  test("uses only the front row and the middle row", () => {
    for (const trackItem of two.items) {
      assert.ok(trackItem.row === 0 || trackItem.row === 1, `${trackItem.item.milestone.id} stands in row ${trackItem.row}`);
    }
  });

  test("never stands two cards at the same x, dated or in a zone", () => {
    for (const a of two.items) {
      for (const b of two.items) {
        if (a !== b) {
          assert.ok(!overlap(a, b), `${a.item.milestone.id} and ${b.item.milestone.id} overlap`);
        }
      }
    }
  });

  test("still zigzags the Timing unknown cards between its two rows", () => {
    const rows = two.items.filter((trackItem) => trackItem.placement === "unknown").map((trackItem) => trackItem.row);
    assert.deepEqual(rows, [0, 1, 0, 1, 0]);
    assert.ok(two.unknownZone !== null && two.items.every((t) => t.placement !== "unknown" || t.x + CARD_WIDTH < two.unknownZone!.end));
  });

  test("the same milestones in three rows share x between the front and back rows", () => {
    const three = layoutTrack(CROWDED, new Set(["wbe"]), 2026, ROW_COUNT);
    const shared = three.items.some((a) => a.row === 0 && three.items.some((b) => b.row === 2 && overlap(a, b)));
    assert.ok(shared);
  });
});
