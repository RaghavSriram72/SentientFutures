"use client";

// A small window onto the 3D track, for the home page. It uses the same
// layout and cards as /timeline/, at a smaller scale and a fixed height
// (lower in a short window, so it fits under the site header, and then seen
// from further away so the far cards stay readable).
// It moves by dragging, by its two arrow buttons, by the arrow keys while it
// has focus, and by horizontal trackpad swipes. It never takes over the
// page's vertical scrolling. A card opens that milestone on /timeline/.
// Below 600px wide, or on a screen 500px tall or less (a phone held
// sideways), it becomes a plain list of the first few milestones, grouped by
// technology, with a link to all of them on /timeline/. A printout always
// gets the list (see "On paper" in TrackTeaser.module.css).
//
// Sample milestones never show here, even if the caller passes them in.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { TypeMark } from "@/components/common/TypeMark";
import {
  buildTimeline,
  estimateSummary,
  flattenItems,
  hasEstimate,
  stageKey,
  stageTag,
  TECHNOLOGY_ORDER,
  type TimelineGroup,
} from "@/components/timeline/timelineModel";
import { milestoneTypeOf } from "@/lib/enums";
import { withBase } from "@/lib/paths";
import type { Milestone, MilestoneCategory } from "@/lib/types";

import {
  AXIS_DEPTH,
  centerOf,
  CARD_WIDTH,
  FLOOR_DEPTH,
  fitScale,
  layoutTrack,
  ROW_DEPTHS,
  settleScale,
  TEASER_CAMERA,
  TEASER_MIN_HEIGHT,
  TEASER_SHORT_CAMERA,
  textFloors,
  type FloorView,
  type TrackLayout,
} from "./trackLayout";
import { FloorMarks, FloorTrace, TrackCard } from "./TrackParts";
import parts from "./TrackParts.module.css";
import styles from "./TrackTeaser.module.css";

interface TrackTeaserProps {
  milestones: Milestone[];
  nowYear: number;
  height?: number;
}

// The teaser's two cameras are set in trackLayout.ts (TEASER_CAMERA, and
// TEASER_SHORT_CAMERA for a window too short for its height), where the
// tests that keep front cards off the back row's stage lines, and every row's
// small lines at 11px, can read them. Both share these.
const HORIZON = TEASER_CAMERA.horizon;
const FLOOR_BOTTOM = TEASER_CAMERA.floorBottom;
const SAFE_TOP = TEASER_CAMERA.safeTop;
const MAX_SCALE = TEASER_CAMERA.maxScale;
const EASE = 0.16;
const DRAG_THRESHOLD = 4;
// Room kept between the outermost card (or zone sign) and the teaser's side, in screen pixels.
const EDGE_MARGIN = 16;
// How far in front of the axis the zone signs stand, in world pixels (as in FloorMarks).
const SIGN_DEPTH = AXIS_DEPTH - 34;
// Where a zone sign starts, from the zone's left edge (as in FloorMarks).
const SIGN_INSET = 40;

// How many milestones the phone list shows before its "See all" link. The
// rest are cut here, not hidden with CSS, so screen readers skip them too.
const LIST_LIMIT = 3;

// The camera's range, as offsets (the world x at the teaser's left edge).
interface CameraRange {
  min: number;
  max: number;
}

// How the camera looks at the floor: TEASER_CAMERA or TEASER_SHORT_CAMERA.
interface Lens {
  tiltDeg: number;
  perspective: number;
}

// The deep camera when the teaser shows at its full height. A short window
// caps the height (see .viewport in TrackTeaser.module.css), and then the
// camera looks from further away, so the far cards' small lines stay readable.
function lensFor(shownHeight: number): Lens {
  return shownHeight >= TEASER_CAMERA.height ? TEASER_CAMERA : TEASER_SHORT_CAMERA;
}

function publicOnly(milestones: Milestone[]): Milestone[] {
  const visible: Milestone[] = [];
  for (const milestone of milestones) {
    if (!milestone.sample) {
      visible.push(milestone);
    }
  }
  return visible;
}

// The groups cut down to their first `limit` milestones in all, in order.
// A group with nothing left is dropped.
function firstItems(groups: TimelineGroup[], limit: number): TimelineGroup[] {
  const kept: TimelineGroup[] = [];
  let left = limit;
  for (const group of groups) {
    if (left <= 0) {
      break;
    }
    const items = group.items.slice(0, left);
    left -= items.length;
    kept.push({ ...group, items });
  }
  return kept;
}

// The tallest card in each row. offsetHeight ignores 3D transforms, so it's
// the card's real height in world pixels.
function measureRowHeights(viewport: HTMLElement): number[] {
  const heights = [0, 0, 0];
  for (const card of viewport.querySelectorAll<HTMLElement>("[data-card-id]")) {
    const row = Number(card.dataset.row ?? 0);
    heights[row] = Math.max(heights[row], card.offsetHeight);
  }
  return heights;
}

// How much perspective draws something at this depth into the floor, compared
// with the front edge. Smaller things also sit closer to the teaser's middle.
function depthShrink(lens: Lens, scale: number, depth: number): number {
  const z = scale * depth * Math.sin((lens.tiltDeg * Math.PI) / 180);
  return lens.perspective / (lens.perspective + z);
}

// The camera goes from where the leftmost card (or the zone sign before it)
// sits EDGE_MARGIN in from the left side, to where the rightmost card sits
// EDGE_MARGIN in from the right side, so the arrows never show bare floor.
// Each edge is worked out at its own row's depth. When everything fits at
// once, both ends are the offset that centers it.
function cameraRange(layout: TrackLayout, lens: Lens, scale: number, pixels: number): CameraRange {
  const middle = pixels / 2;
  const room = middle - EDGE_MARGIN;
  // For each edge, the offset that puts it exactly at its margin.
  let leftEnd = Number.POSITIVE_INFINITY;
  let rightEnd = Number.NEGATIVE_INFINITY;
  for (const trackItem of layout.items) {
    const shrink = depthShrink(lens, scale, ROW_DEPTHS[trackItem.row]);
    leftEnd = Math.min(leftEnd, trackItem.x - (middle - room / shrink) / scale);
    rightEnd = Math.max(rightEnd, trackItem.x + CARD_WIDTH - (middle + room / shrink) / scale);
  }
  const signShrink = depthShrink(lens, scale, SIGN_DEPTH);
  for (const zone of [layout.neverZone, layout.unknownZone]) {
    if (zone) {
      leftEnd = Math.min(leftEnd, zone.start + SIGN_INSET - (middle - room / signShrink) / scale);
    }
  }
  if (rightEnd <= leftEnd) {
    const centered = (leftEnd + rightEnd) / 2;
    return { min: centered, max: centered };
  }
  return { min: leftEnd, max: rightEnd };
}

// Where the camera starts: on the first dated card if there is one (or Now,
// if that comes later), otherwise at the start of the Never or Timing unknown
// cards, so the zone's sign and its first card show in full.
function startOffset(layout: TrackLayout, range: CameraRange, width: number): number {
  for (const trackItem of layout.items) {
    if (trackItem.placement === "dated") {
      return Math.max(layout.nowX, centerOf(trackItem)) - width / 2;
    }
  }
  return range.min;
}

export function TrackTeaser({ milestones, nowYear, height = TEASER_CAMERA.height }: TrackTeaserProps) {
  const router = useRouter();
  const visibleMilestones = useMemo(() => publicOnly(milestones), [milestones]);
  const groups = useMemo(() => buildTimeline(visibleMilestones, nowYear), [visibleMilestones, nowYear]);
  const items = useMemo(() => flattenItems(groups), [groups]);
  const layout = useMemo(() => layoutTrack(items, new Set(TECHNOLOGY_ORDER), nowYear), [items, nowYear]);
  const listGroups = useMemo(() => firstItems(groups, LIST_LIMIT), [groups]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  // offset is the world x at the teaser's left edge; width is how much world
  // fits across it (its pixel width / scale).
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const sizeRef = useRef({ width: 1000, scale: 0.6, pixels: 600 });
  const rangeRef = useRef<CameraRange>({ min: 0, max: 0 });
  const frameRef = useRef(0);
  const placedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean; captured: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const [scale, setScale] = useState(0.6);
  const [lens, setLens] = useState<Lens>(() => lensFor(height));
  const [inView, setInView] = useState<[number, number] | null>(null);
  const [edges, setEdges] = useState({ atStart: false, atEnd: false });
  // False when every card fits in the window, so there is nowhere to move.
  // null until the first measurement, as in the prerendered page: the arrows
  // then show only below 818px, where the cards don't all fit, so the row
  // under the teaser keeps its height when the measurement lands (see
  // .unmeasured in TrackTeaser.module.css).
  const [canMove, setCanMove] = useState<boolean | null>(null);

  const clamp = useCallback((value: number) => {
    const { min, max } = rangeRef.current;
    return Math.min(max, Math.max(min, value));
  }, []);

  // Paint the camera, and keep animating only while it's still moving.
  const paint = useCallback(() => {
    function frame() {
      const current = offsetRef.current;
      const target = targetRef.current;
      const next = Math.abs(target - current) < 0.5 ? target : current + (target - current) * EASE;
      offsetRef.current = next;
      if (floorRef.current) {
        floorRef.current.style.setProperty("--offset", `${-next * sizeRef.current.scale}px`);
      }
      if (next !== target) {
        frameRef.current = requestAnimationFrame(frame);
        return;
      }
      frameRef.current = 0;
      const width = sizeRef.current.width;
      setInView([next - 120, next + width + 60]);
      setEdges({ atStart: next <= clamp(-Infinity) + 1, atEnd: next >= clamp(Infinity) - 1 });
    }
    frame();
  }, [clamp]);

  const moveTo = useCallback(
    (offset: number, instant = false) => {
      targetRef.current = clamp(offset);
      if (instant || reducedMotionRef.current) {
        offsetRef.current = targetRef.current;
      }
      if (frameRef.current === 0) {
        frameRef.current = requestAnimationFrame(paint);
      }
    },
    [clamp, paint],
  );

  // Measure the teaser, fit the cards under its top edge, and place the camera
  // the first time.
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    // The height on screen, which the CSS caps on a short window. While the
    // teaser is hidden (the list shows instead on a phone) it has none, so
    // the height asked for stands in.
    const shownHeight = viewport.offsetHeight > 0 ? viewport.offsetHeight : height;
    const shownLens = lensFor(shownHeight);
    const view: FloorView = {
      height: shownHeight,
      floorBottom: FLOOR_BOTTOM,
      horizon: HORIZON,
      perspective: shownLens.perspective,
      tiltDeg: shownLens.tiltDeg,
    };
    // As on /timeline/, the far rows' small lines get bigger minimums so they
    // stay readable. That makes those cards a little taller, so settleScale
    // fits again with the new heights until the scale stops moving.
    const fitted = settleScale(
      () => fitScale(view, measureRowHeights(viewport), SAFE_TOP, MAX_SCALE),
      (scale) => {
        const floors = textFloors(view, scale);
        for (let row = 0; row < floors.length; row++) {
          floorRef.current?.style.setProperty(`--text-floor-${row}`, `${floors[row].toFixed(1)}px`);
        }
      },
    );
    const pixels = viewport.clientWidth;
    sizeRef.current = { width: pixels / fitted, scale: fitted, pixels };
    rangeRef.current = cameraRange(layout, shownLens, fitted, pixels);
    setLens(shownLens);
    setScale(fitted);
    setCanMove(rangeRef.current.max - rangeRef.current.min > 1);
    if (!placedRef.current) {
      placedRef.current = true;
      moveTo(startOffset(layout, rangeRef.current, sizeRef.current.width), true);
    } else {
      moveTo(targetRef.current, true);
    }
  }, [height, layout, moveTo]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    measure();
    const viewport = viewportRef.current;
    const observer = new ResizeObserver(() => measure());
    if (viewport) {
      observer.observe(viewport);
    }
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) {
        measure();
      }
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [measure]);

  // Horizontal trackpad swipes move the teaser. Vertical wheel movement is
  // left alone, so the page scrolls as usual.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    function onWheel(event: WheelEvent) {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        return;
      }
      event.preventDefault();
      moveTo(targetRef.current + event.deltaX / sizeRef.current.scale);
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [moveTo]);

  function step(direction: number) {
    moveTo(targetRef.current + direction * sizeRef.current.width * 0.45);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  // ---------- Dragging ----------
  // Pointer capture starts only once the pointer has really moved, so a plain
  // click on a card still reaches the card.

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: targetRef.current, moved: false, captured: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) {
      if (!drag.captured) {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.captured = true;
      }
      moveTo(drag.startOffset - dx / sizeRef.current.scale, true);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      suppressClickRef.current = drag.moved;
      dragRef.current = null;
    }
  }

  // A card reached with the keyboard slides into the middle of the window.
  function onFocusCard(id: string, event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.matches(":focus-visible")) {
      return;
    }
    for (const trackItem of layout.items) {
      if (trackItem.item.milestone.id === id) {
        moveTo(centerOf(trackItem) - sizeRef.current.width / 2);
      }
    }
  }

  function openCard(id: string, event: MouseEvent<HTMLElement>) {
    // The click that ends a drag opens nothing, even with a key held.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }
    // Cmd, Ctrl, Shift or Alt (a new tab or window, say): the browser
    // follows the card's own link.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    router.push(`/timeline/#${id}`);
  }

  if (items.length === 0) {
    return <p className={styles.empty}>No milestones are on the timeline yet.</p>;
  }

  return (
    <div className={styles.teaser}>
      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{
          height,
          // The CSS caps the height on a short window, but never below this.
          minHeight: Math.min(height, TEASER_MIN_HEIGHT),
          ["--tilt" as string]: `${lens.tiltDeg}deg`,
          ["--world-scale" as string]: String(scale),
        }}
        data-still={canMove === false ? "true" : undefined}
        tabIndex={0}
        role="group"
        aria-roledescription="timeline preview"
        aria-label={
          canMove === false
            ? "Timeline preview."
            : "Timeline preview. Use the left and right arrow keys or the buttons to move through time."
        }
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.sky} aria-hidden="true" />
        <div className={styles.stage} style={{ perspective: `${lens.perspective}px`, perspectiveOrigin: `50% ${HORIZON * 100}%` }}>
          <div
            ref={floorRef}
            className={parts.floor}
            style={{ width: layout.worldWidth, height: FLOOR_DEPTH, bottom: FLOOR_BOTTOM }}
          >
            <FloorMarks layout={layout} nowYear={nowYear} compact />
            {layout.items.map((trackItem) => (
              <FloorTrace key={`trace-${trackItem.item.milestone.id}`} trackItem={trackItem} layout={layout} />
            ))}
            {layout.items.map((trackItem, index) => {
              const up = inView !== null && trackItem.x + CARD_WIDTH > inView[0] && trackItem.x < inView[1];
              const id = trackItem.item.milestone.id;
              return (
                <TrackCard
                  key={id}
                  trackItem={trackItem}
                  up={up}
                  delay={(index % 4) * 60}
                  needs={trackItem.item.milestone.depends_on.length}
                  href={withBase(`/timeline/#${id}`)}
                  variant="large"
                  numberedStage={false}
                  onActivate={openCard}
                  onFocusCard={onFocusCard}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* When every card already fits, there is nothing to move to, so the
          arrows and the part of the hint about them go. */}
      <div className={styles.controls}>
        <p className={styles.hint}>
          {canMove !== false && <span className={canMove === null ? styles.unmeasured : undefined}>Drag or use the arrows. </span>}
          Select a card to open it on the timeline.
        </p>
        {canMove !== false && (
          <div className={`${styles.buttons} ${canMove === null ? styles.unmeasured : ""}`}>
            {/* aria-disabled, not disabled: a disabled button drops keyboard focus
                the moment the track reaches its end. */}
            <button
              type="button"
              className={styles.arrow}
              onClick={() => {
                if (!edges.atStart) {
                  step(-1);
                }
              }}
              aria-disabled={edges.atStart}
              aria-label="Move back in time"
            >
              <span aria-hidden="true">&larr;</span>
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => {
                if (!edges.atEnd) {
                  step(1);
                }
              }}
              aria-disabled={edges.atEnd}
              aria-label="Move forward in time"
            >
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        )}
      </div>

      <div className={styles.list}>
        {listGroups.map((group) => (
          <section key={group.technology} className={styles.group} aria-labelledby={`teaser-${group.technology}`}>
            <h3 id={`teaser-${group.technology}`} className={styles.groupTitle}>
              {group.label}
            </h3>
            <ul className={styles.rows}>
              {group.items.map((item) => (
                <li key={item.milestone.id}>
                  <Link href={`/timeline/#${item.milestone.id}`} className={styles.row}>
                    <span className={`${styles.dot} ${styles[`stage_${stageKey(item.milestone.stage)}`]}`} aria-hidden="true" />
                    <span className={styles.rowText}>
                      <span className={styles.rowCode}>
                        {item.code} &middot; {stageTag(item.milestone.stage)}
                      </span>
                      <span className={styles.rowName}>{item.milestone.name}</span>
                      <RowType category={item.milestone.category} />
                      {/* Without an estimate there's nothing to add: the caption
                          above says none has a date yet. */}
                      {hasEstimate(item) && <span className={styles.rowEstimate}>{estimateSummary(item)}</span>}
                    </span>
                    <span className={styles.rowArrow} aria-hidden="true">
                      &rarr;
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {items.length > LIST_LIMIT && (
          <Link href="/timeline/" className={styles.allLink}>
            See all {items.length} on the timeline<span aria-hidden="true"> &rarr;</span>
          </Link>
        )}
      </div>
    </div>
  );
}

// A phone row's type, under its name. With a stale enums.json there is no
// type, and the row leaves the line out.
function RowType({ category }: { category: MilestoneCategory }) {
  const type = milestoneTypeOf(category);
  if (type === null) {
    return null;
  }
  return <TypeMark type={type} className={styles.rowType} />;
}
