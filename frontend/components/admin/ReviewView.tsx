"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ExternalLink } from "@/components/common/ExternalLink";
import type { AiAssessment, Candidate, Decision, QueueFilters, Review } from "@/lib/adminTypes";
import { getPublishProblems, getQueue, getQueueItem, toApiError, type ApiError } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { enumLabel } from "@/lib/enums";

import { AdminPageHead } from "./AdminPageHead";
import {
  changeDecisionHref,
  formatCost,
  formatDateTime,
  formatDay,
  hasQueueFilters,
  queueHref,
  readQueueFilters,
  reviewHref,
} from "./adminFormat";
import { ApprovedSummary } from "./ApprovedSummary";
import { AuditTrail } from "./AuditTrail";
import { AiChip, ChipRow, FlagChip, PlainChip, QuoteCheck, StatusChip } from "./Chips";
import forms from "./forms.module.css";
import { COLLECTOR_LABELS, FLAG_DESCRIPTIONS, RELEVANT_LABELS, REVIEW_STATUS_LABELS } from "./labels";
import { ApiErrorNotice, Notice } from "./Notice";
import { PublishProblems } from "./PublishProblems";
import { decisionBefore, rememberDecision } from "./recentDecision";
import styles from "./Review.module.css";
import { ReviewForm } from "./ReviewForm";
import { currentAssessment, evidenceFor, paperLinks, reviewsNewestFirst } from "./reviewModel";
import { confirmLeaving } from "./unsavedWork";
import { useApiData } from "./useApiData";

// /admin/review/?id=<source id>&status=...  The queue filters ride along in the
// query string, so after a decision the next paper comes from the same list.
export function ReviewView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const filters = readQueueFilters(params);

  if (id === "") {
    return (
      <>
        <AdminPageHead eyebrow="Review" title={<>No paper <em>chosen</em></>} />
        <div className={`container ${styles.page}`}>
          <Notice tone="info">
            <p>
              This page needs a paper id. Pick one from the <Link href={queueHref(filters)}>review queue</Link>.
            </p>
          </Notice>
        </div>
      </>
    );
  }
  // A fresh screen per paper, so no half-filled form carries over.
  // ?again=1 opens the form straight away, to change a decision.
  return <ReviewScreen key={id} id={id} filters={filters} startReviewing={params.get("again") === "1"} />;
}

type AfterDecision =
  | { state: "finding"; decision: Decision }
  | { state: "last"; decision: Decision }
  | { state: "error"; decision: Decision; error: ApiError }
  // Approved, but something in the record keeps it off the public site.
  | { state: "problems"; decision: Decision; problems: string[] }
  // An earlier decision was replaced. The screen stays on this paper.
  | { state: "changed"; decision: Decision; problems: string[] };

const DECISION_DONE: Record<Decision, string> = {
  approve: "Approved.",
  reject: "Rejected.",
};

const DECISION_VERB: Record<Decision, string> = {
  approve: "approved",
  reject: "rejected",
};

// "You" when the review is the signed-in person's own, from another tab.
function reviewerName(review: Review): string {
  const session = getSession();
  if (session !== null && session.user.email.toLowerCase() === review.reviewer.toLowerCase()) {
    return "You";
  }
  return review.reviewer_name;
}

interface ReviewScreenProps {
  id: string;
  filters: QueueFilters;
  startReviewing: boolean;
}

function ReviewScreen({ id, filters, startReviewing }: ReviewScreenProps) {
  const router = useRouter();
  const detail = useApiData(`queue-item:${id}`, () => getQueueItem(id));
  const [after, setAfter] = useState<AfterDecision | null>(null);
  const [reviewAgain, setReviewAgain] = useState(startReviewing);
  // The paper decided just before this one, so this screen can say it saved.
  const previous = decisionBefore(id);
  // Set by "Load the latest" after a 409. The form then stays open with what
  // was typed, even if someone else decided the paper in the meantime.
  const [keepForm, setKeepForm] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = detail.data !== null;
  const approved = detail.data !== null && detail.data.source.review_status === "approved";
  // Why an approved paper is missing from the public site, if it is. Only
  // asked while no decision notice is showing: that notice has its own list.
  const publishProblems = useApiData(approved && after === null ? "publish-problems" : null, getPublishProblems);

  // Put keyboard and screen reader focus on the paper's title once it loads,
  // which matters most after "next paper" swaps the content in place.
  useEffect(() => {
    if (loaded) {
      headingRef.current?.focus();
    }
  }, [loaded]);

  async function goToNextPaper(decision: Decision) {
    setAfter({ state: "finding", decision });
    try {
      const { items } = await getQueue(filters);
      for (const item of items) {
        if (item.source.id !== id) {
          rememberDecision({
            id,
            title: detail.data ? detail.data.source.title : "the last paper",
            decision,
            nextId: item.source.id,
          });
          router.push(reviewHref(item.source.id, filters));
          return;
        }
      }
      setAfter({ state: "last", decision });
    } catch (error) {
      setAfter({ state: "error", decision, error: toApiError(error) });
    }
  }

  const backLink = (
    <Link href={queueHref(filters)} onClick={confirmLeaving}>
      Back to {REVIEW_STATUS_LABELS[filters.status]}
    </Link>
  );

  if (!detail.data && detail.error && detail.error.status === 404) {
    return (
      <>
        <AdminPageHead eyebrow="Review" title={<>Paper not <em>found</em></>} kicker={backLink} />
        <div className={`container ${styles.page}`}>
          <Notice tone="info" title="There's no paper with this id.">
            <p>
              The link may be old, or the paper may have been in a database that has since been reset. The{" "}
              <Link href={queueHref(filters)}>review queue</Link> lists the papers there are.
            </p>
          </Notice>
        </div>
      </>
    );
  }

  if (!detail.data) {
    return (
      <>
        <AdminPageHead
          eyebrow="Review"
          title={
            detail.error ? (
              <>
                This paper didn&rsquo;t <em>load</em>
              </>
            ) : (
              <>
                Loading the <em>paper</em>
              </>
            )
          }
          kicker={backLink}
        />
        <div className={`container ${styles.page}`}>
          {detail.error ? (
            <ApiErrorNotice error={detail.error} title="Couldn't load this paper" onRetry={detail.reload} />
          ) : (
            <p className={styles.muted}>Loading&hellip;</p>
          )}
        </div>
      </>
    );
  }

  const { source } = detail.data;
  const assessment = currentAssessment(detail.data);
  const reviews = reviewsNewestFirst(detail.data);
  const alreadyDecided = source.review_status === "approved" || source.review_status === "rejected";
  const decidedBy = alreadyDecided ? currentReview(source, reviews) : null;
  const showForm = !alreadyDecided || ((reviewAgain || keepForm) && decidedBy !== null);
  // The decision a submit replaces. It's the paper's current one whenever the
  // paper is already decided, including one someone made while the form was open.
  const replacing = showForm && alreadyDecided ? decidedBy : null;
  const decidedWhileOpen = keepForm && !reviewAgain && decidedBy !== null;
  const exportProblems = publishProblems.data ? (publishProblems.data[source.id] ?? []) : [];

  function loadLatest() {
    setKeepForm(true);
    detail.reload();
  }

  function onSubmitted(decision: Decision, problems: string[]) {
    // Whatever comes next, reload the paper so its status, abstract and record
    // match what was saved, even when the screen stays on it.
    detail.reload();
    setKeepForm(false);
    // A changed decision stays on this paper, so the record shows both
    // reviews. "Next paper" only makes sense when working a queue.
    if (replacing !== null) {
      setReviewAgain(false);
      setAfter({ state: "changed", decision, problems: decision === "approve" ? problems : [] });
      return;
    }
    // Stop here when the approval can't be published yet, so the reviewer sees why.
    if (decision === "approve" && problems.length > 0) {
      setAfter({ state: "problems", decision, problems });
      return;
    }
    void goToNextPaper(decision);
  }

  return (
    <>
      <AdminPageHead
        eyebrow={`Review · ${REVIEW_STATUS_LABELS[source.review_status] ?? source.review_status}`}
        title={source.title}
        kicker={backLink}
        headingRef={headingRef}
      />
      <div className={`container ${styles.page}`}>
        {previous && after === null && (
          <Notice
            tone="success"
            title={`Saved. You ${DECISION_VERB[previous.decision]} \u201c${previous.title}\u201d.`}
            action={
              <Link href={changeDecisionHref(previous.id, filters)} className={styles.changeLink}>
                Change that decision
              </Link>
            }
          />
        )}
        <PaperDetails source={source} />
        <AiTriageSummary
          byHand={source.origin === "manual"}
          assessment={assessment}
          hasOtherAssessments={detail.data.assessments.length > 0}
          formShown={showForm && after === null}
        />

        {after ? (
          <AfterDecisionPanel after={after} filters={filters} onNext={() => void goToNextPaper(after.decision)} />
        ) : (
          <>
            {decidedBy && !showForm && (
              <Notice
                tone="info"
                title={`${reviewerName(decidedBy)} ${DECISION_VERB[decidedBy.decision]} this on ${formatDay(decidedBy.created_at)}.`}
                action={
                  <button
                    type="button"
                    className={`btn btn-secondary ${forms.smallButton}`}
                    onClick={() => setReviewAgain(true)}
                  >
                    Review it again
                  </button>
                }
              >
                <p>
                  {decidedBy.decision === "approve"
                    ? "Review it again to change this. The form starts from this decision, and both reviews stay in the record."
                    : "Review it again to change this. You'll set the categories from scratch, and both reviews stay in the record."}
                </p>
              </Notice>
            )}
            {decidedWhileOpen && decidedBy && (
              <Notice
                tone="warning"
                title={
                  reviewerName(decidedBy) === "You"
                    ? `You ${DECISION_VERB[decidedBy.decision]} this in another tab at ${formatDateTime(decidedBy.created_at)}.`
                    : `${decidedBy.reviewer_name} ${DECISION_VERB[decidedBy.decision]} this at ${formatDateTime(decidedBy.created_at)}, while you were reviewing it.`
                }
              >
                <p>
                  Your form is still here. If you decide now, your decision replaces theirs, and both stay in the
                  record below.
                </p>
              </Notice>
            )}
            {approved && exportProblems.length > 0 && (
              <Notice tone="warning" title="This paper is approved, but it can't go on the public site yet.">
                <p>The public export skips it because:</p>
                <PublishProblems problems={exportProblems} />
              </Notice>
            )}
            {approved && decidedBy && decidedBy.decision === "approve" && !showForm && (
              <ApprovedSummary
                candidateId={source.id}
                review={decidedBy}
                skippedByExport={exportProblems.length > 0}
              />
            )}
            {showForm && (
              <ReviewForm
                source={source}
                assessment={assessment}
                replacing={replacing}
                refresh={{ loading: detail.loading, error: detail.error }}
                onLoadLatest={loadLatest}
                onSubmitted={onSubmitted}
              />
            )}
          </>
        )}

        <AuditTrail detail={detail.data} currentAssessmentId={assessment ? assessment.id : null} />
      </div>
    </>
  );
}

// The review the source's status comes from, or the newest one if it doesn't say.
function currentReview(source: Candidate, reviewsNewest: Review[]): Review | null {
  for (const review of reviewsNewest) {
    if (review.id === source.current_review_id) {
      return review;
    }
  }
  return reviewsNewest.length > 0 ? reviewsNewest[0] : null;
}

interface AfterDecisionPanelProps {
  after: AfterDecision;
  filters: QueueFilters;
  onNext: () => void;
}

function AfterDecisionPanel({ after, filters, onNext }: AfterDecisionPanelProps) {
  const done = DECISION_DONE[after.decision];
  // The form that had focus is gone, so focus moves to the result.
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, [after.state]);

  if (after.state === "changed") {
    return (
      <Notice
        tone={after.problems.length > 0 ? "warning" : "success"}
        title={`Decision changed: ${DECISION_VERB[after.decision]}.`}
        titleRef={titleRef}
      >
        <p>
          It&rsquo;s saved as a new review, and the earlier one is still in the record below.{" "}
          <Link href={queueHref(filters)}>Back to {REVIEW_STATUS_LABELS[filters.status]}</Link>.
        </p>
        {after.problems.length > 0 && (
          <>
            <p>It won&rsquo;t appear on the public site until the record is fixed:</p>
            <PublishProblems problems={after.problems} />
          </>
        )}
      </Notice>
    );
  }
  if (after.state === "problems") {
    return (
      <Notice
        tone="warning"
        title={`${done} It won't appear on the public site until the record is fixed.`}
        titleRef={titleRef}
        action={
          <button type="button" className={`btn btn-primary ${forms.smallButton}`} onClick={onNext}>
            Next paper
          </button>
        }
      >
        <p>The decision is saved. The public export skips this source because:</p>
        <PublishProblems problems={after.problems} />
      </Notice>
    );
  }
  if (after.state === "finding") {
    return (
      <Notice tone="success" title={`${done} Opening the next paper…`} titleRef={titleRef}>
        <p>The decision is saved.</p>
      </Notice>
    );
  }
  if (after.state === "last") {
    const tab = REVIEW_STATUS_LABELS[filters.status];
    if (hasQueueFilters(filters)) {
      // Only the last one the filters let through. There may be more in the tab.
      const what = filters.kind === "" && filters.flag === "" ? "your search" : "your filters";
      return (
        <Notice
          tone="success"
          title={`${done} That was the last paper in ${tab} matching ${what}.`}
          titleRef={titleRef}
        >
          <p>
            <Link href={queueHref({ status: filters.status, kind: "", flag: "", q: "" })}>
              Clear {what} and see the rest of {tab}
            </Link>{" "}
            or go to <Link href="/admin/">the dashboard</Link>.
          </p>
        </Notice>
      );
    }
    return (
      <Notice tone="success" title={`${done} That was the last paper in ${tab}.`} titleRef={titleRef}>
        <p>
          <Link href={queueHref(filters)}>Back to the queue</Link> or <Link href="/admin/">the dashboard</Link>.
        </p>
      </Notice>
    );
  }
  return (
    <Notice
      tone="warning"
      title={`${done} The decision is saved, but the next paper didn't load.`}
      titleRef={titleRef}
    >
      <p>
        {after.error.message} <Link href={queueHref(filters)}>Go back to the queue</Link> to pick the next one.
      </p>
    </Notice>
  );
}

function PaperDetails({ source }: { source: Candidate }) {
  const links = paperLinks(source);
  // A hand-added paper never goes to the AI, so "no abstract for the AI" says
  // nothing the abstract line below doesn't.
  const visibleFlags = source.flags.filter((flag) => !(source.origin === "manual" && flag === "no_abstract"));
  const callLine: string[] = [];
  if (source.source_type) {
    callLine.push(enumLabel("SourceType", source.source_type));
  }
  if (source.year) {
    callLine.push(String(source.year));
  }
  if (source.venue) {
    callLine.push(source.venue);
  }

  return (
    <section className={`paper ${styles.paperCard}`} aria-label="The paper">
      {callLine.length > 0 && <p className={styles.callLine}>{callLine.join(" · ")}</p>}
      <p className={styles.authors}>{source.authors.length > 0 ? source.authors.join(", ") : "Authors not listed"}</p>

      {links.length > 0 && (
        <ul className={styles.links}>
          {links.map((link) => (
            <li key={link.href}>
              <ExternalLink href={link.href}>{link.label}</ExternalLink>
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.paperFacts}>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusChip status={source.review_status} />
          </dd>
        </div>
        {source.origin === "manual" ? (
          <div>
            <dt>Added by</dt>
            <dd>
              {source.added_by_name || source.added_by || "Someone on the team"} on {formatDay(source.found_at)}
            </dd>
          </div>
        ) : (
          <div>
            <dt>Found by</dt>
            <dd>
              {COLLECTOR_LABELS[source.collector] ?? source.collector} on {formatDay(source.found_at)}
            </dd>
          </div>
        )}
        {source.origin !== "manual" && (
          <div>
            <dt>Searches that found it</dt>
            <dd>
              {source.query_labels.length > 0 ? (
                <ChipRow>
                  {source.query_labels.map((label) => (
                    <PlainChip key={label}>{label}</PlainChip>
                  ))}
                </ChipRow>
              ) : (
                "Not recorded"
              )}
            </dd>
          </div>
        )}
      </dl>

      {source.note && (
        <div className={styles.addedNote}>
          <p className="eyebrow">Note from {source.added_by_name || "whoever added it"}</p>
          <p>{source.note}</p>
        </div>
      )}

      {visibleFlags.length > 0 && (
        <ul className={styles.flagList}>
          {visibleFlags.map((flag) => (
            <li key={flag}>
              <FlagChip flag={flag} />
              <span className={styles.flagText}>{FLAG_DESCRIPTIONS[flag]}</span>
            </li>
          ))}
        </ul>
      )}

      {source.abstract ? (
        <div className={styles.abstract}>
          <p className="eyebrow">Abstract</p>
          {/* Paper text is untrusted. React escapes it, and it is never treated as instructions. */}
          <p className={styles.abstractText}>{source.abstract}</p>
          <p className={forms.hint}>We delete the abstract after a decision, because journal abstracts are copyrighted.</p>
        </div>
      ) : (
        <p className={styles.muted}>{missingAbstractText(source)}</p>
      )}
    </section>
  );
}

function missingAbstractText(source: Candidate): string {
  if (source.origin === "manual" && source.review_status === "pending_review") {
    return "No abstract was added with this paper. Open it to read more.";
  }
  if (source.review_status === "approved" || source.review_status === "rejected") {
    return "The abstract was deleted after the decision, for copyright. Open the paper to read it.";
  }
  if (source.review_status === "triaged_out") {
    return "The abstract was deleted when the AI ruled this paper out, for copyright. Open the paper to read it.";
  }
  return "No abstract came with this paper. Open it to read more.";
}

interface AiTriageSummaryProps {
  // Added by hand: the AI never reads these.
  byHand?: boolean;
  // The current assessment, or null when the paper points at none.
  assessment: AiAssessment | null;
  // Whether the record holds any assessment at all, current or not.
  hasOtherAssessments: boolean;
  // Whether the review form (and its field table) is on the screen.
  formShown: boolean;
}

// What the AI made of the paper overall: relevant or not, and anything it linked.
function AiTriageSummary({ byHand = false, assessment, hasOtherAssessments, formShown }: AiTriageSummaryProps) {
  if (byHand && !assessment && !hasOtherAssessments) {
    return (
      <Notice tone="info" title="Added by hand, so the AI hasn't read it.">
        {formShown && <p>The table below only has your column.</p>}
      </Notice>
    );
  }
  if (!assessment && hasOtherAssessments) {
    // A run can save an assessment and stop before attaching it to the paper,
    // and a person can decide a paper while a run is assessing it.
    return (
      <Notice tone="info" title="There's no current AI assessment to compare against.">
        <p>
          The AI looked at this paper, but its answer was never attached to it. That happens when a run stops partway,
          or when someone decides the paper while a run is reading it. The answer is in the record at the bottom of the
          page.
        </p>
        {formShown && <p>The table below only has your column.</p>}
      </Notice>
    );
  }
  if (!assessment) {
    return (
      <Notice tone="info" title="The AI hasn't triaged this paper.">
        {formShown && <p>There&rsquo;s nothing to compare against, so the table below only has your column.</p>}
      </Notice>
    );
  }

  const meta = `${assessment.model} · prompt ${assessment.prompt_version} · ${formatDateTime(assessment.created_at)} · ${formatCost(assessment.cost_usd)}`;

  if (!assessment.parsed) {
    return (
      <Notice tone="warning" title="The AI call didn't give a usable answer.">
        <p>Sort this one yourself. The raw output is in the assessment record at the bottom of the page.</p>
        <dl className={styles.failFacts}>
          {assessment.error && (
            <div>
              <dt>Error</dt>
              <dd>{assessment.error}</dd>
            </div>
          )}
          {assessment.stop_reason && (
            <div>
              <dt>Stop reason</dt>
              <dd>{assessment.stop_reason}</dd>
            </div>
          )}
          {assessment.refusal_category && (
            <div>
              <dt>Refusal</dt>
              <dd>{assessment.refusal_category}</dd>
            </div>
          )}
        </dl>
        <p className={styles.aiMeta}>{meta}</p>
      </Notice>
    );
  }

  const parsed = assessment.parsed;
  const evidence = evidenceFor(parsed, "relevant");
  return (
    <section className={styles.aiSummary} aria-labelledby="ai-summary-heading">
      <div className={styles.aiSummaryHead}>
        <h2 id="ai-summary-heading" className={styles.aiSummaryTitle}>
          The AI&rsquo;s triage
        </h2>
        <AiChip>{RELEVANT_LABELS[parsed.relevant]}</AiChip>
      </div>
      {evidence && (
        <>
          <p className={styles.reason}>{evidence.reason}</p>
          {evidence.quote && <p className={styles.quote}>&ldquo;{evidence.quote}&rdquo;</p>}
          <QuoteCheck found={assessment.quote_checks.relevant} />
        </>
      )}
      {parsed.milestone_ids.length > 0 && (
        <p className={styles.milestones}>
          <span className={styles.milestonesLabel}>Milestones it linked</span>
          <ChipRow>
            {parsed.milestone_ids.map((milestoneId) => (
              <AiChip key={milestoneId}>{milestoneId}</AiChip>
            ))}
          </ChipRow>
        </p>
      )}
      <p className={styles.aiMeta}>{meta}</p>
    </section>
  );
}
