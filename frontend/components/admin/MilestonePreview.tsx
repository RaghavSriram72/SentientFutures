"use client";

import { Component, type ReactNode } from "react";

import { MilestonePanel } from "@/components/timeline/MilestonePanel";
import { buildTimeline, dependents, indexItems } from "@/components/timeline/timelineModel";
import type { CatalogSource } from "@/lib/adminTypes";
import { withBase } from "@/lib/paths";
import type { SourceRef } from "@/lib/sources";
import type { Milestone } from "@/lib/types";

import styles from "./Editor.module.css";

// What the dossier needs to cite a source. A source without a link points at
// its entry in the public source database instead.
function sourceRefs(catalog: CatalogSource[]): Record<string, SourceRef> {
  const refs: Record<string, SourceRef> = {};
  for (const source of catalog) {
    refs[source.id] = {
      id: source.id,
      register_id: source.register_id,
      title: source.title,
      authors: source.authors,
      year: source.year ?? 0,
      url: source.url ?? withBase(`/sources/#${source.id}`),
      venue: null,
      sample: source.sample,
    };
  }
  return refs;
}

// The other milestones with this one in its place, so codes like "WBE-03"
// and the depends-on links come out as they will on the timeline.
function withDraft(milestone: Milestone, others: Milestone[]): Milestone[] {
  const all: Milestone[] = [];
  let placed = false;
  for (const other of others) {
    if (other.id === milestone.id) {
      all.push(milestone);
      placed = true;
    } else {
      all.push(other);
    }
  }
  if (!placed) {
    all.push(milestone);
  }
  return all;
}

interface MilestonePreviewProps {
  milestone: Milestone;
  others: Milestone[];
  catalog: CatalogSource[];
  nowYear: number;
}

// The milestone as the timeline's dossier shows it, redrawn on every change.
export function MilestonePreview({ milestone, others, catalog, nowYear }: MilestonePreviewProps) {
  // A milestone without an id yet still needs one to be drawn.
  const shown = milestone.id === "" ? { ...milestone, id: "new-milestone" } : milestone;
  return (
    <PreviewBoundary resetKey={JSON.stringify(shown)}>
      <PreviewPanel milestone={shown} others={others} catalog={catalog} nowYear={nowYear} />
    </PreviewBoundary>
  );
}

function PreviewPanel({ milestone, others, catalog, nowYear }: MilestonePreviewProps) {
  const groups = buildTimeline(withDraft(milestone, others), nowYear);
  const itemsById = indexItems(groups);
  const item = itemsById[milestone.id];
  if (!item) {
    return <p className={styles.muted}>The preview shows up once the milestone has a name.</p>;
  }
  return (
    <MilestonePanel
      item={item}
      itemsById={itemsById}
      neededFor={dependents(milestone.id, groups)}
      sources={sourceRefs(catalog)}
      headingId="milestone-preview-title"
    />
  );
}

interface PreviewBoundaryProps {
  // Any change to the milestone tries drawing it again.
  resetKey: string;
  children: ReactNode;
}

interface PreviewBoundaryState {
  failedFor: string | null;
}

// A half-filled form can be something the dossier can't draw yet (a range with
// no start year, say). This keeps that from taking the editor down with it.
class PreviewBoundary extends Component<PreviewBoundaryProps, PreviewBoundaryState> {
  state: PreviewBoundaryState = { failedFor: null };

  static getDerivedStateFromError(): Partial<PreviewBoundaryState> {
    return { failedFor: "pending" };
  }

  componentDidCatch() {
    this.setState({ failedFor: this.props.resetKey });
  }

  render() {
    const { failedFor } = this.state;
    if (failedFor !== null && (failedFor === "pending" || failedFor === this.props.resetKey)) {
      return (
        <p className={styles.muted}>
          The preview can&rsquo;t draw this yet. It comes back once the fields with problems are filled in.
        </p>
      );
    }
    return this.props.children;
  }
}
