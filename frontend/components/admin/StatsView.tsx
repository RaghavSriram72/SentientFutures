"use client";

import type { AiRelevantGroup, FieldStats, PromptVersionStats, ReviewField, StatsValue, ValuePair } from "@/lib/adminTypes";
import { getReviewStats } from "@/lib/api";
import { enumLabel } from "@/lib/enums";

import { AdminPageHead } from "./AdminPageHead";
import { formatCount } from "./adminFormat";
import detail from "./Detail.module.css";
import forms from "./forms.module.css";
import { FIELD_ENUMS, FIELD_LABELS, REVIEW_FIELDS } from "./labels";
import { ApiErrorNotice } from "./Notice";
import runs from "./runs.module.css";
import styles from "./Stats.module.css";
import { useApiData } from "./useApiData";

// How many of the most common changes to list for each field.
const TOP_CHANGES = 3;

// The rows of the approval table, in the order a paper meets them.
const RELEVANT_GROUPS: { key: AiRelevantGroup; label: string }[] = [
  { key: "yes", label: "The AI said relevant" },
  { key: "unsure", label: "The AI was unsure" },
  { key: "no_spot_check", label: "The AI said no, picked for a spot check" },
  { key: "no_rescued", label: "The AI said no, opened from Triaged out" },
  { key: "no_answer", label: "No usable AI answer" },
];

function percent(rate: number | null): string {
  if (rate === null) {
    return "No decisions yet";
  }
  return `${Math.round(rate * 100)}%`;
}

function valueText(field: ReviewField, value: StatsValue): string {
  if (value === null) {
    return "Not set";
  }
  if (typeof value === "string") {
    return enumLabel(FIELD_ENUMS[field], value);
  }
  if (value.length === 0) {
    return "Nothing";
  }
  const labels: string[] = [];
  for (const item of value) {
    labels.push(enumLabel(FIELD_ENUMS[field], item));
  }
  return labels.join(", ");
}

function sameStatsValue(a: StatsValue, b: StatsValue): boolean {
  // Tag lists are compared as sets, like the API does.
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (const item of a) {
      if (!b.includes(item)) {
        return false;
      }
    }
    return true;
  }
  return a === b;
}

// The most common AI value -> final value pairs where the reviewer changed it.
function topChanges(stats: FieldStats): ValuePair[] {
  const changes: ValuePair[] = [];
  for (const pair of stats.pairs) {
    if (!sameStatsValue(pair.ai, pair.final)) {
      changes.push(pair);
    }
  }
  return changes.slice(0, TOP_CHANGES);
}

// /admin/stats/: how often reviewers change what the AI said, per prompt
// version. If they keep changing one field, the prompt needs work there.
export function StatsView() {
  const stats = useApiData("review-stats", getReviewStats);

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Review <em>stats</em>
          </>
        }
        lede="How often the team approves what the AI sends, and how often reviewers change its categories, for each version of the AI's instructions. Only each paper's latest decision counts."
        actions={
          <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={stats.reload}>
            Refresh
          </button>
        }
      />
      <div className={`container ${detail.page}`}>
        {stats.error && <ApiErrorNotice error={stats.error} title="Couldn't load the stats" onRetry={stats.reload} />}
        {!stats.error && !stats.data && <p className={detail.muted}>Loading&hellip;</p>}
        {stats.data && stats.data.by_prompt_version.length === 0 && (
          <p className={detail.muted}>No decisions yet. These numbers fill in as the team reviews papers.</p>
        )}
        {stats.data &&
          stats.data.by_prompt_version.map((version) => (
            <PromptVersionSection key={version.prompt_version ?? "none"} version={version} />
          ))}
      </div>
    </>
  );
}

function PromptVersionSection({ version }: { version: PromptVersionStats }) {
  const name = version.prompt_version;
  const headingId = `version-${name ?? "none"}`;
  // Decisions with no AI answer behind them can only land in one row, so a
  // table of mostly zeros would say nothing the line above doesn't.
  const groups: { key: AiRelevantGroup; label: string }[] = [];
  for (const group of RELEVANT_GROUPS) {
    if (version.by_ai_relevant[group.key].reviews > 0) {
      groups.push(group);
    }
  }

  return (
    <section className={`paper ${detail.card}`} aria-labelledby={headingId}>
      <div className={styles.versionHead}>
        <h2 id={headingId} className={detail.cardTitle}>
          {name ? (
            <>
              Prompt <span className={styles.versionName}>{name}</span>
            </>
          ) : (
            "Papers the AI didn't read"
          )}
        </h2>
        <p className={detail.muted}>
          {version.reviews === 1 ? "1 decision" : `${formatCount(version.reviews)} decisions`}:{" "}
          {formatCount(version.approved)} approved, {formatCount(version.rejected)} rejected. Approval rate{" "}
          {percent(version.approval_rate)}.
        </p>
      </div>

      {name && groups.length > 0 && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Approvals by what the AI said</h3>
          <p className={detail.muted}>
            If fewer than 1 in 5 papers the AI calls relevant get approved, the searches or the AI are letting too much
            through. Approvals in the &ldquo;said no&rdquo; rows are relevant papers the AI would have dropped.
          </p>
          <table className={runs.table}>
            <caption className="visually-hidden">Decisions and approval rate, by what the AI said about relevance</caption>
            <thead>
              <tr>
                <th scope="col">What the AI said</th>
                <th scope="col" className={runs.numeric}>
                  Decisions
                </th>
                <th scope="col" className={runs.numeric}>
                  Approved
                </th>
                <th scope="col" className={runs.numeric}>
                  Approval rate
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const counts = version.by_ai_relevant[group.key];
                return (
                  <tr key={group.key}>
                    <th scope="row" className={styles.rowLabel}>
                      {group.label}
                    </th>
                    <td data-label="Decisions" className={runs.numeric}>
                      {formatCount(counts.reviews)}
                    </td>
                    <td data-label="Approved" className={runs.numeric}>
                      {formatCount(counts.approved)}
                    </td>
                    <td data-label="Approval rate" className={runs.numeric}>
                      {percent(counts.approval_rate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {name && (
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>How often reviewers change each category</h3>
          <p className={detail.muted}>
            Approvals only, and only where the AI gave the field a value. A rejection doesn&rsquo;t judge the AI&rsquo;s
            categories, so it isn&rsquo;t counted here.
          </p>
          <table className={runs.table}>
            <caption className="visually-hidden">For each category, how often reviewers changed the AI&rsquo;s value</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" className={runs.numeric}>
                  Compared
                </th>
                <th scope="col" className={runs.numeric}>
                  Changed
                </th>
                <th scope="col" className={runs.numeric}>
                  Change rate
                </th>
                <th scope="col" className={runs.numeric}>
                  Kept the AI&rsquo;s value
                </th>
                <th scope="col">Most common changes</th>
              </tr>
            </thead>
            <tbody>
              {REVIEW_FIELDS.map((field) => (
                <FieldRow key={field} field={field} stats={version.fields[field]} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FieldRow({ field, stats }: { field: ReviewField; stats: FieldStats }) {
  const changes = topChanges(stats);
  return (
    <tr>
      <th scope="row" className={styles.rowLabel}>
        {FIELD_LABELS[field]}
      </th>
      <td data-label="Compared" className={runs.numeric}>
        {formatCount(stats.compared)}
      </td>
      <td data-label="Changed" className={runs.numeric}>
        {formatCount(stats.changed)}
      </td>
      <td data-label="Change rate" className={runs.numeric}>
        {stats.change_rate === null ? "Nothing compared" : percent(stats.change_rate)}
      </td>
      <td data-label="Kept the AI's value" className={runs.numeric}>
        {formatCount(stats.ai_values_used)}
      </td>
      <td data-label="Most common changes">
        {changes.length === 0 ? (
          <span className={detail.muted}>None</span>
        ) : (
          <ul className={styles.changes}>
            {changes.map((pair) => (
              <li key={`${valueText(field, pair.ai)}>${valueText(field, pair.final)}`}>
                {valueText(field, pair.ai)} <span aria-hidden="true">&rarr;</span>
                <span className="visually-hidden">changed to</span> {valueText(field, pair.final)}{" "}
                <span className={styles.changeCount}>({formatCount(pair.count)})</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
