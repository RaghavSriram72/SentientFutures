"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import type { PipelineStatus, QueueFilters, QueueItem, QueuePage } from "@/lib/adminTypes";
import {
  getPipelineStatus,
  getPublishProblems,
  getQueue,
  QUEUE_PAGE_SIZE,
  queueSearchParams,
  toApiError,
  type ApiError,
} from "@/lib/api";
import { enumLabel, enumValues } from "@/lib/enums";

import { AdminPageHead } from "./AdminPageHead";
import {
  formatCount,
  formatDay,
  hasQueueFilters,
  kindFilterApplies,
  kindFilterReadsDecision,
  kindFilterShown,
  queueHref,
  queueStatusHref,
  readQueueFilters,
  reviewHref,
} from "./adminFormat";
import { AiChip, ChipRow, FlagChip, PlainChip, WarningChip } from "./Chips";
import forms from "./forms.module.css";
import {
  COLLECTOR_LABELS,
  FLAG_LABELS,
  FLAGS,
  QUEUE_STATUSES,
  REJECT_REASON_CHIP_LABELS,
  RELEVANT_LABELS,
  REVIEW_STATUS_LABELS,
} from "./labels";
import { ApiErrorNotice, Notice } from "./Notice";
import styles from "./Queue.module.css";
import { useApiData } from "./useApiData";
import { useClearAfterSignIn } from "./useClearAfterSignIn";

// What an empty tab says, when no filters are on.
const EMPTY_MESSAGES: Record<QueueFilters["status"], string> = {
  pending_review: "Nothing is waiting for review.",
  new: "No papers are waiting for the AI.",
  approved: "Nothing has been approved yet.",
  rejected: "Nothing has been rejected yet.",
  triaged_out: "The AI hasn't ruled anything out yet.",
};

// When nothing in the URL picks a tab, the queue opens on Pending review,
// unless the AI is off and the papers are all waiting in New. Then it opens on New.
function opensOnNew(status: PipelineStatus): boolean {
  const pending = status.counts.pending_review ?? 0;
  const waitingInNew = status.counts.new ?? 0;
  return status.triage_configured === false && pending === 0 && waitingInNew > 0;
}

export function QueueView() {
  const params = useSearchParams();
  const filters = readQueueFilters(params);
  const tabChosen = params.get("status") !== null;
  const router = useRouter();
  const key = queueSearchParams(filters).toString();
  // For the counts on the tabs, and for picking the tab to open on.
  const pipeline = useApiData("pipeline-status", getPipelineStatus);
  const deciding = !tabChosen && pipeline.data === null && pipeline.error === null;
  const switchToNew = !tabChosen && pipeline.data !== null && opensOnNew(pipeline.data);
  useEffect(() => {
    if (switchToNew) {
      router.replace(queueStatusHref("new"), { scroll: false });
    }
  }, [switchToNew, router]);
  const queue = useApiData(deciding || switchToNew ? null : `queue:${key}`, () => getQueue(filters));
  const triageOff = pipeline.data !== null && pipeline.data.triage_configured === false;
  // The same, but null until the pipeline status answers. The AI's kind
  // select waits for it, so it doesn't show and then go away when the AI
  // turns out to be off, and so do the tab links that carry a kind along.
  // If the status can't load, the select shows.
  const triageOffOrUnknown = pipeline.data === null && pipeline.error === null ? null : triageOff;
  // The queue's own counts come back with each page, so they match the list.
  let counts = pipeline.data ? pipeline.data.counts : null;
  if (queue.data && queue.data.counts) {
    counts = queue.data.counts;
  }
  // Approved papers the public export skips, so the Approved tab can mark them.
  const publishProblems = useApiData(filters.status === "approved" ? "publish-problems" : null, getPublishProblems);
  // Counted so Refresh also drops any pages loaded with "Show more".
  const [refreshes, setRefreshes] = useState(0);
  // "Clear them" and "Clear the filters" sit inside the results, which are
  // drawn again from scratch once the filters change (see the key on
  // QueueResults). The button that was pressed goes away with them, so focus
  // would drop to the page. Instead it moves to the results heading, which
  // stays put, so keyboard and screen reader users keep their place.
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusResultsAfterClear = useRef(false);

  // Runs each time the filters in the URL change. Clearing always changes
  // them, because the clear buttons only show while a filter is on.
  useEffect(() => {
    if (focusResultsAfterClear.current) {
      focusResultsAfterClear.current = false;
      resultsHeadingRef.current?.focus();
    }
  }, [key]);

  function applyFilters(next: QueueFilters) {
    router.replace(queueHref(next), { scroll: false });
  }

  // For "Clear them" and "Clear the filters": the same tab, with no filters.
  function clearFilters() {
    focusResultsAfterClear.current = true;
    applyFilters({ status: filters.status, kind: "", flag: "", q: "" });
  }

  function refresh() {
    setRefreshes((count) => count + 1);
    queue.reload();
    pipeline.reload();
    publishProblems.reload();
  }

  let unpublishableCount = 0;
  if (publishProblems.data) {
    unpublishableCount = Object.keys(publishProblems.data).length;
  }

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Review <em>queue</em>
          </>
        }
        lede={
          triageOff
            ? "Oldest first. Open a paper to read it, then approve or reject it."
            : "Oldest first. Open a paper to compare what the AI said with your own read, then approve or reject it."
        }
        actions={
          <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={refresh}>
            Refresh
          </button>
        }
      />

      <div className={`container ${styles.page}`}>
        <nav aria-label="Queue status">
          <ul className={styles.tabs}>
            {QUEUE_STATUSES.map((status) => (
              <li key={status}>
                <Link
                  // A tab that doesn't offer the kind filter drops it, so it never filters out of sight.
                  href={queueHref({
                    ...filters,
                    status,
                    kind: kindFilterShown(status, triageOffOrUnknown) ? filters.kind : "",
                  })}
                  className={styles.tab}
                  aria-current={status === filters.status ? "page" : undefined}
                  scroll={false}
                >
                  {REVIEW_STATUS_LABELS[status]}
                  {counts && <span className={styles.tabCount}>{formatCount(counts[status] ?? 0)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Stays mounted across searches, so the search box keeps its focus. It
            picks up a search the URL gets from elsewhere by itself. */}
        <FilterBar filters={filters} triageOff={triageOffOrUnknown} onApply={applyFilters} />

        <section aria-labelledby="results-heading" className={styles.results}>
          {/* tabIndex={-1} lets clearFilters() move focus here; Tab still skips it. */}
          <h2 id="results-heading" className="visually-hidden" ref={resultsHeadingRef} tabIndex={-1}>
            {REVIEW_STATUS_LABELS[filters.status]} papers
          </h2>
          {queue.error && <ApiErrorNotice error={queue.error} title="Couldn't load the queue" onRetry={queue.reload} />}
          {!queue.error && !queue.data && <p className={styles.muted}>Loading&hellip;</p>}
          {unpublishableCount > 0 && (
            <Notice
              tone="warning"
              title={
                unpublishableCount === 1
                  ? "1 approved paper can't be published yet."
                  : `${unpublishableCount} approved papers can't be published yet.`
              }
            >
              <p>Each one is marked below, and its page says why.</p>
            </Notice>
          )}
          {publishProblems.error && (
            <p className={styles.muted}>Couldn&rsquo;t check which approved papers can be published.</p>
          )}
          {queue.data && (
            <QueueResults
              key={`${key}:${refreshes}`}
              firstPage={queue.data}
              filters={filters}
              publishProblems={publishProblems.data}
              waitingInNew={counts ? (counts.new ?? 0) : 0}
              triageOff={triageOff}
              onClear={clearFilters}
            />
          )}
        </section>
      </div>
    </>
  );
}

interface FilterBarProps {
  filters: QueueFilters;
  // null until the pipeline status says whether the AI is on.
  triageOff: boolean | null;
  onApply: (filters: QueueFilters) => void;
}

// The selects apply as soon as they change; the search applies on Enter or the button.
function FilterBar({ filters, triageOff, onApply }: FilterBarProps) {
  const [search, setSearch] = useState(filters.q);
  // The search in the URL when the box last took it. When the URL's search
  // changes (a search applied here, "Clear the filters", or Back and Forward),
  // the box shows the new one. Adjusting state while rendering, as React's
  // docs suggest, rather than remounting the form, because a remount would
  // throw away the focus in the search box.
  const [searchFromUrl, setSearchFromUrl] = useState(filters.q);
  if (filters.q !== searchFromUrl) {
    setSearchFromUrl(filters.q);
    setSearch(filters.q);
  }
  // Hidden in New, where nothing has an AI kind yet, and where it would only
  // read the AI's kind while the AI is off, or might be. A kind already in the
  // address (an old link) keeps its select there, so it can be cleared.
  let showKind = kindFilterShown(filters.status, triageOff);
  if (kindFilterApplies(filters.status) && filters.kind !== "") {
    showKind = true;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...filters, q: search });
  }

  return (
    <form className={styles.filters} onSubmit={onSubmit} role="search" aria-label="Filter the queue">
      {showKind && (
        <div className={forms.field}>
          <label htmlFor="filter-kind" className={forms.label}>
            {kindFilterReadsDecision(filters.status) ? "Kind" : <>Kind (the AI&rsquo;s)</>}
          </label>
          <select
            id="filter-kind"
            className={forms.select}
            value={filters.kind}
            onChange={(event) => onApply({ ...filters, kind: event.target.value as QueueFilters["kind"] })}
          >
            <option value="">Any kind</option>
            {enumValues("SourceKind").map((info) => (
              <option key={info.value} value={info.value}>
                {info.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={forms.field}>
        <label htmlFor="filter-flag" className={forms.label}>
          Flag
        </label>
        <select
          id="filter-flag"
          className={forms.select}
          value={filters.flag}
          onChange={(event) => onApply({ ...filters, flag: event.target.value as QueueFilters["flag"] })}
        >
          <option value="">Any or none</option>
          {FLAGS.map((flag) => (
            <option key={flag} value={flag}>
              {FLAG_LABELS[flag]}
            </option>
          ))}
        </select>
      </div>
      <div className={`${forms.field} ${styles.searchField}`}>
        <label htmlFor="filter-q" className={forms.label}>
          Search
        </label>
        <div className={styles.searchRow}>
          <input
            id="filter-q"
            type="search"
            className={forms.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-describedby="filter-q-hint"
          />
          <button type="submit" className={`btn btn-secondary ${forms.smallButton}`}>
            Search
          </button>
        </div>
        <p id="filter-q-hint" className={forms.hint}>
          Searches titles and author names.
        </p>
      </div>
    </form>
  );
}

interface QueueResultsProps {
  firstPage: QueuePage;
  filters: QueueFilters;
  // Approved papers the public export skips, by id. null until known, or outside the Approved tab.
  publishProblems: Record<string, string[]> | null;
  // How many papers sit in New, for pointing there from an empty Pending review.
  waitingInNew: number;
  triageOff: boolean;
  onClear: () => void;
}

// The list, a page at a time. Remounted (see its key) when the filters change.
function QueueResults({ firstPage, filters, publishProblems, waitingInNew, triageOff, onClear }: QueueResultsProps) {
  const [laterItems, setLaterItems] = useState<QueueItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);
  // If "Show the next ..." failed because the session ended, "Your session
  // ended." is out of date once someone signs in again, so it goes away then.
  // Focus goes back to the "Show the next ..." button (see AdminShell), ready
  // to press again.
  useClearAfterSignIn(moreError, () => setMoreError(null));

  // Keyboard and screen reader users shouldn't lose their place when they
  // load more papers. So focus moves to the first new paper once it's drawn,
  // and they carry on reading from there. These keep track of that row.
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  // Where the papers from the last "Show the next ..." start in the list. null before the first.
  const [newPapersStart, setNewPapersStart] = useState<number | null>(null);
  // The title link of the paper at newPapersStart.
  const firstNewLinkRef = useRef<HTMLAnchorElement>(null);
  // Set by showMore() when focus should move to that link after the next render.
  const focusFirstNewPaper = useRef(false);

  // Runs after each batch of papers from "Show the next ..." is drawn.
  useEffect(() => {
    if (focusFirstNewPaper.current) {
      focusFirstNewPaper.current = false;
      firstNewLinkRef.current?.focus();
    }
  }, [laterItems]);

  const items = [...firstPage.items, ...laterItems];
  const total = Math.max(firstPage.total, items.length);
  const remaining = total - items.length;
  const filtered = hasQueueFilters(filters);

  async function showMore() {
    // The button stays focusable while it loads (aria-disabled rather than
    // disabled, so focus doesn't drop to the page), which means it can still
    // be pressed. A second press while loading does nothing.
    if (loadingMore) {
      return;
    }
    // The new papers will start right after the ones already listed.
    const start = items.length;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await getQueue(filters, start);
      // Focus only moves if it's still on the button. Someone who moved on
      // while it loaded (to the search box, say) stays where they are. And
      // if nothing new came back, the button stays, so focus does too.
      if (page.items.length > 0 && document.activeElement === moreButtonRef.current) {
        focusFirstNewPaper.current = true;
      }
      setNewPapersStart(start);
      setLaterItems((previous) => [...previous, ...page.items]);
    } catch (error) {
      setMoreError(toApiError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  // "Try again" in the error notice. Loading again takes the notice away,
  // and its "Try again" button with it, so focus moves first to "Show the next ...",
  // which stays put and says "Loading…". From there it goes on to the new
  // papers, or stays on that button if the load fails again. It's also what
  // gets focus back after signing in again, if the session ended.
  function retryShowMore() {
    moreButtonRef.current?.focus();
    void showMore();
  }

  if (items.length === 0) {
    const pointToNew = !filtered && filters.status === "pending_review" && waitingInNew > 0;
    let waitingNote = "";
    if (pointToNew) {
      const papers = waitingInNew === 1 ? "1 paper is" : `${formatCount(waitingInNew)} papers are`;
      waitingNote = triageOff
        ? `${papers} in New. The AI is off, so they won't move here on their own.`
        : `${papers} in New, waiting for the AI.`;
    }
    return (
      <div className={styles.empty}>
        <p>{filtered ? "No papers here match these filters." : EMPTY_MESSAGES[filters.status]}</p>
        {pointToNew && (
          <p>
            {waitingNote} <Link href={queueStatusHref("new")}>Review them in New</Link>
          </p>
        )}
        {filtered && (
          <button type="button" className={forms.linkButton} onClick={onClear}>
            Clear the filters
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <p className={styles.count}>
        {remaining > 0 && `Showing ${items.length} of `}
        {total === 1 ? "1 paper" : `${total.toLocaleString("en-US")} papers`}
        {filtered && (
          <>
            {" "}
            matching the filters.{" "}
            <button type="button" className={forms.linkButton} onClick={onClear}>
              Clear them
            </button>
          </>
        )}
      </p>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <QueueRow
            key={item.source.id}
            item={item}
            filters={filters}
            cantPublish={publishProblems !== null && publishProblems[item.source.id] !== undefined}
            linkRef={index === newPapersStart ? firstNewLinkRef : undefined}
          />
        ))}
      </ol>
      {moreError && <ApiErrorNotice error={moreError} title="Couldn't load more papers" onRetry={retryShowMore} />}
      {remaining > 0 && (
        <div className={styles.more}>
          {/* aria-disabled, not disabled, while it loads: a disabled button
              drops keyboard focus to the page. showMore() ignores presses
              until it's done, and forms.button makes it look disabled. */}
          <button
            ref={moreButtonRef}
            type="button"
            className={`btn btn-secondary ${forms.button}`}
            onClick={() => void showMore()}
            aria-disabled={loadingMore ? true : undefined}
          >
            {loadingMore ? "Loading…" : `Show the next ${Math.min(remaining, QUEUE_PAGE_SIZE)}`}
          </button>
        </div>
      )}
    </>
  );
}

function authorsText(authors: string[]): string {
  if (authors.length === 0) {
    return "Authors not listed";
  }
  if (authors.length <= 3) {
    return authors.join(", ");
  }
  return `${authors.slice(0, 3).join(", ")} and ${authors.length - 3} more`;
}

// One paper. The title is the link; a stretched ::after makes the whole card clickable.
interface QueueRowProps {
  item: QueueItem;
  filters: QueueFilters;
  // Approved, but the public export skips it.
  cantPublish: boolean;
  // Only on the first paper "Show the next ..." added, so focus can move to its title link.
  linkRef?: Ref<HTMLAnchorElement>;
}

function QueueRow({ item, filters, cantPublish, linkRef }: QueueRowProps) {
  const { source, assessment } = item;
  const parsed = assessment ? assessment.parsed : null;
  // Why it was rejected, so nobody has to open each paper to find out.
  const rejectReason = source.review_status === "rejected" ? item.reject_reason : null;

  const byHand = source.origin === "manual";
  const meta: string[] = byHand
    ? [`Added ${formatDay(source.found_at)}`]
    : [COLLECTOR_LABELS[source.collector] ?? source.collector, `Found ${formatDay(source.found_at)}`];
  // "Not triaged yet" only means something while a paper waits for a decision,
  // and papers added by hand never go to the AI.
  const undecided = source.review_status === "new" || source.review_status === "pending_review";
  if (source.year) {
    meta.push(String(source.year));
  }
  if (source.venue) {
    meta.push(source.venue);
  }

  return (
    <li className={styles.row}>
      <p className={styles.rowMeta}>{meta.join(" · ")}</p>
      <h3 className={styles.rowTitle}>
        <Link href={reviewHref(source.id, filters)} className={styles.rowLink} ref={linkRef}>
          {source.title}
        </Link>
      </h3>
      <p className={styles.rowAuthors}>{authorsText(source.authors)}</p>
      <ChipRow>
        {parsed && <AiChip>{RELEVANT_LABELS[parsed.relevant]}</AiChip>}
        {parsed && parsed.kind && <AiChip>{enumLabel("SourceKind", parsed.kind)}</AiChip>}
        {byHand && <PlainChip>{COLLECTOR_LABELS.manual}</PlainChip>}
        {rejectReason && <PlainChip>{REJECT_REASON_CHIP_LABELS[rejectReason]}</PlainChip>}
        {!assessment && !byHand && undecided && <PlainChip>Not triaged yet</PlainChip>}
        {cantPublish && (
          <WarningChip title="The public export skips this paper. Open it to see why.">Can&rsquo;t be published</WarningChip>
        )}
        {source.flags.map((flag) => (
          <FlagChip key={flag} flag={flag} />
        ))}
      </ChipRow>
    </li>
  );
}
