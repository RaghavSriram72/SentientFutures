"use client";

import Link from "next/link";

import type { MilestoneRecord } from "@/lib/adminTypes";
import { listMilestones } from "@/lib/api";
import { enumLabel } from "@/lib/enums";
import type { Milestone, Technology } from "@/lib/types";

import { AdminPageHead } from "./AdminPageHead";
import { formatDateTime, formatDay } from "./adminFormat";
import { PublishStateChip, SampleChip } from "./Chips";
import styles from "./Editor.module.css";
import forms from "./forms.module.css";
import { ApiErrorNotice } from "./Notice";
import runs from "./runs.module.css";
import { useApiData } from "./useApiData";

const TECHNOLOGY_ORDER: Technology[] = ["wbe", "bci", "neuromorphic", "hybrid"];

export function milestoneEditHref(id: string): string {
  return `/admin/milestones/edit/?id=${encodeURIComponent(id)}`;
}

function years(start: number | null, end: number | null): string {
  if (start !== null && end !== null) {
    return start === end ? String(start) : `${start} to ${end}`;
  }
  if (start !== null) {
    return `${start} onward`;
  }
  if (end !== null) {
    return `by ${end}`;
  }
  return "open";
}

// What the timeline has to go on for this milestone, in a few words.
export function estimateText(milestone: Milestone): string {
  const parts: string[] = [];
  if (milestone.achieved_in !== null) {
    parts.push(`Achieved ${milestone.achieved_in}`);
  } else if (milestone.estimate) {
    parts.push(`Team range ${years(milestone.estimate.earliest, milestone.estimate.latest)}`);
  }
  const count = milestone.forecasts.length;
  if (count > 0) {
    parts.push(count === 1 ? "1 forecast" : `${count} forecasts`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No estimate yet";
}

interface Group {
  technology: Technology;
  records: MilestoneRecord[];
}

// By technology, with real milestones before samples.
function groupRecords(records: MilestoneRecord[]): Group[] {
  const groups: Group[] = [];
  for (const technology of TECHNOLOGY_ORDER) {
    const real: MilestoneRecord[] = [];
    const samples: MilestoneRecord[] = [];
    for (const record of records) {
      if (record.milestone.technology !== technology) {
        continue;
      }
      if (record.milestone.sample) {
        samples.push(record);
      } else {
        real.push(record);
      }
    }
    if (real.length + samples.length > 0) {
      groups.push({ technology, records: [...real, ...samples] });
    }
  }
  return groups;
}

function groupSummary(records: MilestoneRecord[]): string {
  let real = 0;
  let published = 0;
  let samples = 0;
  for (const record of records) {
    if (record.milestone.sample) {
      samples += 1;
    } else {
      real += 1;
      if (record.published) {
        published += 1;
      }
    }
  }
  const parts: string[] = [];
  if (real === 0) {
    parts.push("No real milestones yet");
  } else {
    parts.push(real === published ? `${real} real, all published` : `${real} real, ${published} published`);
  }
  if (samples > 0) {
    parts.push(samples === 1 ? "1 sample" : `${samples} samples`);
  }
  return parts.join(" · ");
}

// /admin/milestones/: every milestone, grouped by technology.
export function MilestoneList() {
  const milestones = useApiData("milestones", listMilestones);

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            The <em>milestones</em>
          </>
        }
        lede="The steps on the timeline. Published milestones go on the site with the next publish. Samples are made-up worked examples, and the public site never shows them."
        actions={
          <Link href="/admin/milestones/edit/" className={`btn btn-primary ${forms.smallButton}`}>
            Add a milestone
          </Link>
        }
      />
      <div className={`container ${styles.listPage}`}>
        {milestones.error && (
          <ApiErrorNotice error={milestones.error} title="Couldn't load the milestones" onRetry={milestones.reload} />
        )}
        {!milestones.error && !milestones.data && <p className={styles.muted}>Loading&hellip;</p>}
        {milestones.data && milestones.data.length === 0 && (
          <p className={styles.muted}>
            No milestones yet. <Link href="/admin/milestones/edit/">Add the first one</Link>.
          </p>
        )}
        {milestones.data &&
          groupRecords(milestones.data).map((group) => (
            <section key={group.technology} className={styles.group} aria-labelledby={`group-${group.technology}`}>
              <div className={styles.groupHead}>
                <h2 id={`group-${group.technology}`} className={styles.groupTitle}>
                  {enumLabel("Technology", group.technology)}
                </h2>
                <p className={styles.muted}>{groupSummary(group.records)}</p>
              </div>
              <MilestoneTable records={group.records} technology={group.technology} />
            </section>
          ))}
      </div>
    </>
  );
}

function MilestoneTable({ records, technology }: { records: MilestoneRecord[]; technology: Technology }) {
  return (
    <table className={`${runs.table} ${styles.fixedTable}`}>
      <caption className="visually-hidden">{enumLabel("Technology", technology)} milestones</caption>
      {/* Fixed widths, so the columns line up from one technology's table to the next */}
      <colgroup>
        <col className={styles.colMain} />
        <col className={styles.colStage} />
        <col className={styles.colEstimate} />
        <col className={styles.colState} />
        <col className={styles.colSaved} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Milestone</th>
          <th scope="col">Stage</th>
          <th scope="col">Estimate</th>
          <th scope="col">On the site</th>
          <th scope="col">Last saved</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const milestone = record.milestone;
          return (
            <tr key={milestone.id}>
              <th scope="row">
                <Link href={milestoneEditHref(milestone.id)} className={styles.nameLink}>
                  {milestone.name || milestone.id}
                </Link>
                <div className={styles.idCell}>{milestone.id}</div>
              </th>
              <td data-label="Stage">{enumLabel("Stage", milestone.stage)}</td>
              <td data-label="Estimate">{estimateText(milestone)}</td>
              <td data-label="On the site">
                <span className={styles.chipLine}>
                  {milestone.sample ? <SampleChip /> : <PublishStateChip published={record.published} />}
                </span>
              </td>
              <td data-label="Last saved" className={runs.startedBy}>
                <span title={formatDateTime(record.updated_at)}>{formatDay(record.updated_at)}</span>
                {record.updated_by && <span className={styles.byLine}>by {record.updated_by}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
