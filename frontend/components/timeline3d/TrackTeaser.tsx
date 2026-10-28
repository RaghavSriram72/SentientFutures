"use client";

// A small window onto the 3D track, for the home page. It uses the same
// layout and cards as /timeline/, at a smaller scale and a fixed height.
// It moves by dragging, by its two arrow buttons, by the arrow keys while it
// has focus, and by horizontal trackpad swipes. It never takes over the
// page's vertical scrolling. A card opens that milestone on /timeline/.
// Below 600px it becomes a plain list grouped by technology.
//
// Sample milestones never show here, even if the caller passes them in.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { buildTimeline, estimateSummary, flattenItems, stageKey, TECHNOLOGY_ORDER } from "@/components/timeline/timelineModel";
import { enumLabel } from "@/lib/enums";
import { withBase } from "@/lib/paths";
import type { Milestone } from "@/lib/types";

import { centerOf, CARD_WIDTH, FLOOR_DEPTH, fitScale, layoutTrack, zoneCenter, type FloorView, type TrackLayout } from "./trackLayout";
import { FloorMarks, FloorTrace, TrackCard } from "./TrackParts";
import parts from "./TrackParts.module.css";
import styles from "./TrackTeaser.module.css";

interface TrackTeaserProps {
  milestones: Milestone[];
  nowYear: number;
  height?: number;
}

// The teaser's camera: a gentler tilt and a closer perspective than the full
// track, since the window is short.
const TILT_DEG = 56;
const PERSPECTIVE = 1000;
const HORIZON = 0.04;
const FLOOR_BOTTOM = 0; // the floor runs right to the teaser's bottom edge
const SAFE_TOP = 16;
const MAX_SCALE = 0.7;
const EASE = 0.16;
const DRAG_THRESHOLD = 4;

function publicOnly(milestones: Milestone[]): Milestone[] {
  const visible: Milestone[] = [];
  for (const milestone of milestones) {
    if (!milestone.sample) {
      visible.push(milestone);
    }
  }
  return visible;
}

// Where the camera starts: the first dated card if there is one, otherwise
// the cards waiting under Never or Timing unknown, otherwise Now.
function startCenter(layout: TrackLayout): number {
  for (const trackItem of layout.items) {
    if (trackItem.placement === "dated") {
      return Math.max(layout.nowX, centerOf(trackItem));
    }
  }
  if (layout.unknownZone) {
    return zoneCenter(layout, layout.unknownZone);
  }
  if (layout.neverZone) {
    return zoneCenter(layout, layout.neverZone);
  }
  return layout.nowX;
}

export function TrackTeaser({ milestones, nowYear, height = 420 }: TrackTeaserProps) {
  const router = useRouter();
  const visibleMilestones = useMemo(() => publicOnly(milestones), [milestones]);
  const groups = useMemo(() => buildTimeline(visibleMilestones, nowYear), [visibleMilestones, nowYear]);
  const items = useMemo(() => flattenItems(groups), [groups]);
  const layout = useMemo(() => layoutTrack(items, new Set(TECHNOLOGY_ORDER), nowYear), [items, nowYear]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  // offset is the world x at the teaser's left edge; width is how much world
  // fits across it (its pixel width / scale).
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const sizeRef = useRef({ width: 1000, scale: 0.6, pixels: 600 });
  const frameRef = useRef(0);
  const placedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean; captured: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const [scale, setScale] = useState(0.6);
  const [inView, setInView] = useState<[number, number] | null>(null);
  const [edges, setEdges] = useState({ atStart: false, atEnd: false });

  const clamp = useCallback(
    (value: number) => {
      const width = sizeRef.current.width;
      const min = -width * 0.08;
      const max = Math.max(min, layout.worldWidth - width * 0.92);
      return Math.min(max, Math.max(min, value));
    },
    [layout.worldWidth],
  );

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
    const rowHeights = [0, 0, 0];
    for (const card of viewport.querySelectorAll<HTMLElement>("[data-card-id]")) {
      const row = Number(card.dataset.row ?? 0);
      rowHeights[row] = Math.max(rowHeights[row], card.offsetHeight);
    }
    const view: FloorView = { height, floorBottom: FLOOR_BOTTOM, horizon: HORIZON, perspective: PERSPECTIVE, tiltDeg: TILT_DEG };
    const fitted = fitScale(view, rowHeights, SAFE_TOP, MAX_SCALE);
    const pixels = viewport.clientWidth;
    sizeRef.current = { width: pixels / fitted, scale: fitted, pixels };
    setScale(fitted);
    if (!placedRef.current) {
      placedRef.current = true;
      moveTo(startCenter(layout) - sizeRef.current.width / 2, true);
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
    event.preventDefault();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
        style={{ height, ["--tilt" as string]: `${TILT_DEG}deg`, ["--world-scale" as string]: String(scale) }}
        tabIndex={0}
        role="group"
        aria-roledescription="timeline preview"
        aria-label="Timeline preview. Use the left and right arrow keys or the buttons to move through time."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className={styles.sky} aria-hidden="true" />
        <div className={styles.stage} style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: `50% ${HORIZON * 100}%` }}>
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
                  onActivate={openCard}
                  onFocusCard={onFocusCard}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <p className={styles.hint}>Drag or use the arrows. Select a card to open it on the timeline.</p>
        <div className={styles.buttons}>
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
      </div>

      <div className={styles.list}>
        {groups.map((group) => (
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
                        {item.code} &middot; {enumLabel("Stage", item.milestone.stage)}
                      </span>
                      <span className={styles.rowName}>{item.milestone.name}</span>
                      <span className={styles.rowEstimate}>{estimateSummary(item)}</span>
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
      </div>
    </div>
  );
}
