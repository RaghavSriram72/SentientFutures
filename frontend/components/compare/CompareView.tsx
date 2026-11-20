"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

import { ownHistoryState } from "@/components/common/HashLinkHistory";
import { COMPARE_PARAM, compareHref } from "@/lib/dimensions";

import {
  chosenDimension,
  compareAddress,
  dimensionGroups,
  nextDimension,
  panelTitleId,
  type CompareDimension,
} from "./compareModel";
import styles from "./Compare.module.css";

interface CompareViewProps {
  dimensions: CompareDimension[];
  // One server-rendered panel per dimension, keyed by the dimension's key.
  panels: Record<string, ReactNode>;
  // The "How to read the marks" disclosure, beside the select.
  marks: ReactNode;
}

// The dimension select, every panel, and the Next card. The address is the
// only state: /compare/?dimension=<key>. Every panel stays in the HTML, and
// the one the address names is the one not hidden.
//
// The static export can't know the address, so the HTML shows the first
// dimension (the fallback), and the browser swaps in the chosen one as soon
// as the page's scripts run, as /sources/ does with its filters. On a reload,
// HashLinkHistory holds the scroll position while that happens.
export function CompareView(props: CompareViewProps) {
  return (
    <Suspense fallback={<DimensionSwitch {...props} chosenKey={props.dimensions[0].key} />}>
      <DimensionFromAddress {...props} />
    </Suspense>
  );
}

// Reads the dimension from the address. useSearchParams renders this again
// whenever the address changes, by a pick, Back, Forward or a link, so the
// panel always matches the address. A value that names no dimension shows
// the first one and is taken out of the address, so a reload or a shared link
// doesn't carry it on.
function DimensionFromAddress(props: CompareViewProps) {
  const params = useSearchParams();
  const raw = params.get(COMPARE_PARAM);
  const { dimension, unknown } = chosenDimension(props.dimensions, raw);

  useEffect(() => {
    if (unknown) {
      showDimension(null);
    }
  }, [raw, unknown]);

  return <DimensionSwitch {...props} chosenKey={dimension.key} />;
}

// Puts the dimension in the address (or takes it out, for null) without a
// navigation. Next.js passes the new address to useSearchParams, which shows
// the panel. replaceState keeps the history entry, so picking adds none, and
// ownHistoryState keeps what the site stored on it, such as the scroll
// position HashLinkHistory puts back on a reload.
function showDimension(key: string | null) {
  const { pathname, search, hash } = window.location;
  // The path has the base path in it, and a whole path is always passed:
  // Next.js ignores an empty one, so "" would leave a stale value in place.
  const address = pathname + compareAddress(key, new URLSearchParams(search)) + hash;
  if (address === pathname + search + hash) {
    return;
  }
  try {
    window.history.replaceState(ownHistoryState(), "", address);
  } catch {
    // Safari throws after about 100 calls in 30 seconds. The address then
    // lags until the next pick.
  }
}

interface DimensionSwitchProps extends CompareViewProps {
  chosenKey: string;
}

function DimensionSwitch({ dimensions, panels, marks, chosenKey }: DimensionSwitchProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  // Set by the Next card: the dimension whose heading gets focus once its
  // panel shows.
  const focusOnShow = useRef<string | null>(null);
  const next = nextDimension(dimensions, chosenKey);

  // The select is uncontrolled. The new address reaches useSearchParams a
  // moment after a pick, and a controlled select would show the old option
  // until then. This keeps it in step when the address changes another way
  // (the Next card, Back, a link), and does nothing after a pick.
  useEffect(() => {
    const select = selectRef.current;
    if (select !== null && select.value !== chosenKey) {
      select.value = chosenKey;
    }
  }, [chosenKey]);

  // After the Next card: focus the new panel's heading, so the keyboard and
  // screen readers carry on from there, and bring the panel's top into view.
  // The smooth scrolling in globals.css applies, and turns off for readers
  // who asked for reduced motion.
  useEffect(() => {
    if (focusOnShow.current !== chosenKey) {
      return;
    }
    focusOnShow.current = null;
    const heading = document.getElementById(panelTitleId(chosenKey));
    if (heading === null) {
      return;
    }
    heading.focus({ preventScroll: true });
    const panel = heading.closest("section") ?? heading;
    panel.scrollIntoView({ block: "start" });
  }, [chosenKey]);

  // A plain click shows the next panel in place. A click with a modifier key
  // (Cmd, Ctrl, Shift or Alt) opens the link's address in a new tab or window
  // as usual; a middle click never reaches onClick.
  function onNextClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    focusOnShow.current = next.key;
    showDimension(next.key);
  }

  return (
    <div className={styles.compare}>
      <div className={styles.controls}>
        <label htmlFor="compare-dimension" className={styles.controlLabel}>
          Dimension
        </label>
        <div className={styles.selectWrap}>
          <select
            ref={selectRef}
            id="compare-dimension"
            className={styles.select}
            aria-controls="compare-panels"
            defaultValue={chosenKey}
            onChange={(event) => showDimension(event.target.value)}
          >
            {dimensionGroups(dimensions).map((run) => {
              const options = run.dimensions.map((dimension) => (
                <option key={dimension.key} value={dimension.key}>
                  {dimension.label}
                </option>
              ));
              if (run.group === null) {
                return options;
              }
              return (
                <optgroup key={run.group} label={run.group}>
                  {options}
                </optgroup>
              );
            })}
          </select>
        </div>
        <div className={styles.marks}>{marks}</div>
      </div>

      {/* hidden takes the other panels out of the tab order and the
          accessibility tree, and out of a printout. */}
      <div id="compare-panels" className={styles.panels}>
        {dimensions.map((dimension) => (
          <div key={dimension.key} hidden={dimension.key !== chosenKey}>
            {panels[dimension.key]}
          </div>
        ))}
      </div>

      <Link href={compareHref(next.key)} className={styles.next} onClick={onNextClick}>
        <span className={`eyebrow ${styles.nextEyebrow}`}>{next.group ? `Next · ${next.group}` : "Next"}</span>
        <span className={styles.nextName}>{next.label}</span>
        <span className={styles.nextArrow} aria-hidden="true">
          &rarr;
        </span>
      </Link>
    </div>
  );
}
