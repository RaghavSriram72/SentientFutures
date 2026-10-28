// Curved links painted on the floor between the milestone in focus and the
// milestones it depends on (arrows point into it) or that depend on it (arrows
// point out of it). The SVG lies in the floor's own coordinates, so it tilts
// with the floor and stays under the cards.
import { centerOf, FLOOR_DEPTH, AXIS_DEPTH, rowY, type TrackItem } from "./trackLayout";
import styles from "./TrackScene.module.css";

interface DependencyLinksProps {
  worldWidth: number;
  active: TrackItem | null;
  prerequisites: TrackItem[];
  dependents: TrackItem[];
}

interface Point {
  x: number;
  y: number;
}

// Links bow toward the front of the floor, between the cards and the year
// axis, where nothing stands in front of them.
const FRONT_LIMIT = FLOOR_DEPTH - AXIS_DEPTH - 14;
const BASE_OFFSET = 16; // start just in front of a card's foot
const ARROW_LENGTH = 26;
const ARROW_HALF_WIDTH = 12;

function footOf(trackItem: TrackItem): Point {
  return { x: centerOf(trackItem), y: rowY(trackItem.row) + BASE_OFFSET };
}

function linkPath(from: Point, to: Point): { d: string; arrow: string } {
  const dx = to.x - from.x;
  const bow = Math.min(240, 70 + Math.abs(dx) * 0.08);
  const controlY = Math.min(FRONT_LIMIT, Math.max(from.y, to.y) + bow);
  const c1: Point = { x: from.x + dx * 0.25, y: controlY };
  const c2: Point = { x: to.x - dx * 0.25, y: controlY };
  const d = `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;

  // The arrowhead follows the curve's direction where it arrives.
  let angle = Math.atan2(to.y - c2.y, to.x - c2.x);
  if (Math.abs(to.x - c2.x) < 0.01 && Math.abs(to.y - c2.y) < 0.01) {
    angle = -Math.PI / 2;
  }
  const backX = to.x - ARROW_LENGTH * Math.cos(angle);
  const backY = to.y - ARROW_LENGTH * Math.sin(angle);
  const sideX = ARROW_HALF_WIDTH * Math.sin(angle);
  const sideY = -ARROW_HALF_WIDTH * Math.cos(angle);
  const arrow = `${to.x},${to.y} ${backX + sideX},${backY + sideY} ${backX - sideX},${backY - sideY}`;
  return { d, arrow };
}

export function DependencyLinks({ worldWidth, active, prerequisites, dependents }: DependencyLinksProps) {
  if (!active || (prerequisites.length === 0 && dependents.length === 0)) {
    return null;
  }
  const links: { key: string; from: Point; to: Point }[] = [];
  for (const prerequisite of prerequisites) {
    links.push({ key: `in-${prerequisite.item.milestone.id}`, from: footOf(prerequisite), to: footOf(active) });
  }
  for (const dependent of dependents) {
    links.push({ key: `out-${dependent.item.milestone.id}`, from: footOf(active), to: footOf(dependent) });
  }

  return (
    <svg
      className={styles.links}
      width={worldWidth}
      height={FLOOR_DEPTH}
      viewBox={`0 0 ${worldWidth} ${FLOOR_DEPTH}`}
      aria-hidden="true"
    >
      {links.map((link) => {
        const { d, arrow } = linkPath(link.from, link.to);
        return (
          <g key={link.key}>
            <path d={d} className={styles.linkHalo} />
            <path d={d} className={styles.linkLine} />
            <polygon points={arrow} className={styles.linkArrow} />
          </g>
        );
      })}
    </svg>
  );
}
