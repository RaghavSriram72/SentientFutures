"use client";

import Link from "next/link";

import type { Review, ReviewFinal } from "@/lib/adminTypes";
import { getPublishStatus } from "@/lib/api";
import { enumLabel, type EnumName } from "@/lib/enums";

import { formatDay } from "./adminFormat";
import detail from "./Detail.module.css";
import styles from "./Review.module.css";
import { RUBRIC_FIELDS } from "./reviewModel";
import { useApiData } from "./useApiData";

// The public site's id for an approved paper, as the export makes it
// (backend/sf_api/publish.py public_id): lowercase, anything else a hyphen.
export function publicSourceId(candidateId: string): string {
  return candidateId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function labels(enumName: EnumName, values: string[], empty: string): string {
  if (values.length === 0) {
    return empty;
  }
  const names: string[] = [];
  for (const value of values) {
    names.push(enumLabel(enumName, value));
  }
  return names.join(", ");
}

function oneLabel(enumName: EnumName, value: string | null, empty: string): string {
  return value ? enumLabel(enumName, value) : empty;
}

function credibilityText(final: ReviewFinal): string {
  if (!final.credibility) {
    return "Not rated yet";
  }
  const rating = enumLabel("Credibility", final.credibility);
  if (final.credibility === "unclear" && final.credibility_unclear_reason) {
    return `${rating}: ${enumLabel("UnclearReason", final.credibility_unclear_reason).toLowerCase()}`;
  }
  return rating;
}

interface ApprovedSummaryProps {
  candidateId: string;
  review: Review;
  // True when the export skips this paper. The page says why above this card.
  skippedByExport: boolean;
}

// What the team approved, as readers will see it, and whether it has reached
// the public site yet.
export function ApprovedSummary({ candidateId, review, skippedByExport }: ApprovedSummaryProps) {
  const publish = useApiData(skippedByExport ? null : "publish-status", getPublishStatus);
  const final = review.final;

  // Only a publish that went through GitHub rebuilt the public site. A local
  // server just hands out a command, so nothing went live from it.
  let publishedOn: string | null = null;
  if (publish.data && publish.data.last && publish.data.last.mode === "github" && publish.data.last.requested_at) {
    const lastPublish = Date.parse(publish.data.last.requested_at);
    if (lastPublish > Date.parse(review.created_at)) {
      publishedOn = publish.data.last.requested_at;
    }
  }

  const facts: { label: string; value: string }[] = [
    { label: "Kind", value: oneLabel("SourceKind", final.kind, "Not set") },
    {
      label: "Technology",
      value: labels("Technology", final.technology, final.general_background ? "General background" : "None picked"),
    },
    { label: "Problem", value: oneLabel("Problem", final.problem, "Not set") },
    { label: "Claim direction", value: labels("ClaimDirection", final.claim_directions, "None") },
    { label: "Source type", value: oneLabel("SourceType", final.source_type, "From the paper's details") },
  ];
  for (const item of RUBRIC_FIELDS) {
    if (item.key === "credibility") {
      facts.push({ label: item.label, value: credibilityText(final) });
    } else {
      facts.push({ label: item.label, value: oneLabel(item.enumName, final[item.key], "Not rated yet") });
    }
  }

  return (
    <section className={`paper ${detail.card}`} aria-labelledby="approved-heading">
      <h2 id="approved-heading" className={detail.cardTitle}>
        What was <em>approved</em>
      </h2>
      {!skippedByExport && (
        <p className={styles.publishLine}>
          {publishedOn ? (
            <>
              Included in the publish on {formatDay(publishedOn)}.{" "}
              <Link href={`/sources/#${publicSourceId(candidateId)}`}>See it on the public site</Link>
            </>
          ) : (
            "Not on the public site yet. It goes up with the next publish."
          )}
        </p>
      )}
      <div className={styles.approvedSummary}>
        <p className="eyebrow">Team summary</p>
        <p>{final.summary ?? "No summary was saved."}</p>
      </div>
      <dl className={detail.facts}>
        {facts.map((fact) => (
          <div key={fact.label} className={detail.fact}>
            <dt className={detail.factLabel}>{fact.label}</dt>
            <dd className={detail.factValue}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
