"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import type { DuplicateSource, NewSourceRequest } from "@/lib/adminTypes";
import { addSource, duplicateFrom, fieldErrorsFrom, toApiError, type ApiError } from "@/lib/api";
import { enumValues } from "@/lib/enums";
import type { SourceType } from "@/lib/types";

import { AdminPageHead } from "./AdminPageHead";
import { reviewHref } from "./adminFormat";
import detail from "./Detail.module.css";
import forms from "./forms.module.css";
import { ApiErrorNotice, Notice } from "./Notice";
import styles from "./Editor.module.css";
import { arxivIdFromLink, doiFromLink, isWebLink, namesItsPaper } from "./sourceLinks";
import { useUnsavedWork } from "./unsavedWork";
import { useClearAfterSignIn } from "./useClearAfterSignIn";

// Text while editing, so the year can be empty or half typed.
interface SourceDraft {
  url: string;
  title: string;
  authors: string;
  year: string;
  doi: string;
  arxivId: string;
  venue: string;
  sourceType: SourceType | "";
  abstract: string;
  note: string;
}

const EMPTY_DRAFT: SourceDraft = {
  url: "",
  title: "",
  authors: "",
  year: "",
  doi: "",
  arxivId: "",
  venue: "",
  sourceType: "",
  abstract: "",
  note: "",
};

// Field name as the API names it -> message.
type Errors = Record<string, string>;

// The inputs in page order, keyed by the API's field names, for moving focus
// to the first problem.
const FIELD_IDS: { key: string; id: string }[] = [
  { key: "url", id: "source-url" },
  { key: "title", id: "source-title" },
  { key: "authors", id: "source-authors" },
  { key: "year", id: "source-year" },
  { key: "source_type", id: "source-type" },
  { key: "venue", id: "source-venue" },
  { key: "doi", id: "source-doi" },
  { key: "arxiv_id", id: "source-arxiv" },
  { key: "abstract", id: "source-abstract" },
  { key: "note", id: "source-note" },
];

const FIRST_YEAR = 1800;
const LAST_YEAR = 2100;

const LINK_INCOMPLETE = "The link looks incomplete. Copy it from your browser's address bar.";
// How the API starts its message for a link it can't read (is_web_link).
const API_LINK_INCOMPLETE = "looks incomplete";

// The input of the first field with a problem, in page order.
function firstErrorId(errors: Errors): string | null {
  for (const field of FIELD_IDS) {
    if (errors[field.key]) {
      return field.id;
    }
  }
  return null;
}

function focusFirstError(errors: Errors): void {
  const id = firstErrorId(errors);
  if (id !== null) {
    document.getElementById(id)?.focus();
  }
}

function authorList(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() !== "") {
      names.push(line.trim());
    }
  }
  return names;
}

function sameDraft(a: SourceDraft, b: SourceDraft): boolean {
  for (const key of Object.keys(a) as (keyof SourceDraft)[]) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

// Checks what the API would refuse anyway, so the problem shows next to its field.
function check(draft: SourceDraft): Errors {
  const errors: Errors = {};
  const url = draft.url.trim();
  if (url === "") {
    errors.url = "Add a link to the paper.";
  } else if (!url.startsWith("https://") && !url.startsWith("http://")) {
    errors.url = "The link has to start with https:// or http://.";
  } else if (!isWebLink(url) || !namesItsPaper(url)) {
    errors.url = LINK_INCOMPLETE;
  }
  if (draft.title.trim() === "") {
    errors.title = "Add the paper's title.";
  }
  // The public site lists every source with its year, and reviewing can't add one later.
  const yearText = draft.year.trim();
  const year = Number(yearText);
  if (yearText === "") {
    errors.year = "Add the year it came out.";
  } else if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) {
    errors.year = `Use a year from ${FIRST_YEAR} to ${LAST_YEAR}.`;
  }
  return errors;
}

function optional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toRequest(draft: SourceDraft): NewSourceRequest {
  const yearText = draft.year.trim();
  return {
    url: draft.url.trim(),
    title: draft.title.trim(),
    authors: authorList(draft.authors),
    year: yearText === "" ? null : Number(yearText),
    doi: optional(draft.doi),
    arxiv_id: optional(draft.arxivId),
    venue: optional(draft.venue),
    source_type: draft.sourceType === "" ? undefined : draft.sourceType,
    abstract: optional(draft.abstract),
    note: optional(draft.note),
  };
}

function hasText(draft: SourceDraft): boolean {
  for (const value of Object.values(draft)) {
    if (value.trim() !== "") {
      return true;
    }
  }
  return false;
}

// /admin/sources/new/: a paper someone found themselves goes into Pending
// review, where it's approved or rejected like any other.
export function AddSourceView() {
  const router = useRouter();
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Errors>({});
  const [otherProblems, setOtherProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateSource | null>(null);
  // The draft the API called a duplicate. It can't be added as it is.
  const [duplicateDraft, setDuplicateDraft] = useState<SourceDraft | null>(null);
  // What the link last filled into the DOI and arXiv id fields. A new link
  // replaces its own fill, but never a DOI or id someone typed.
  const filledFromLink = useRef({ doi: "", arxivId: "" });
  // A field to move focus to once saving is over. Every input is disabled
  // while saving, so a problem the API finds can't take focus right away.
  const focusAfterSave = useRef<string | null>(null);
  // The button is disabled while adding, so focus would drop to the page.
  // When the paper isn't added, focus goes to the title of the notice that
  // says why. (When it is, the review page that opens focuses its heading.)
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusResultAfterSave = useRef(false);

  // A draft the API already has can't be added, so the notice's link to that
  // paper goes there without asking. Changing the draft makes it worth asking
  // again. Back, the other links and closing the tab still ask, because a
  // typed abstract or note may be worth copying first.
  const isDuplicate = duplicate !== null && duplicateDraft !== null && sameDraft(draft, duplicateDraft);
  useUnsavedWork(hasText(draft) && !saved);

  // A 401 means the session ended before the paper was added. The page stays
  // open under the sign-in card, so once someone signs in again that error
  // is out of date and goes, and the form is ready to try again.
  useClearAfterSignIn(saveError, () => setSaveError(null));

  useEffect(() => {
    if (saving) {
      return;
    }
    if (focusAfterSave.current !== null) {
      document.getElementById(focusAfterSave.current)?.focus();
    } else if (focusResultAfterSave.current) {
      resultRef.current?.focus();
    }
    focusAfterSave.current = null;
    focusResultAfterSave.current = false;
  }, [saving]);

  function update(patch: Partial<SourceDraft>, clears: string | null = null) {
    setDraft((previous) => ({ ...previous, ...patch }));
    if (clears && errors[clears]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[clears];
        return next;
      });
    }
  }

  // The DOI and arXiv id the link gives, for the fields the API would fill
  // from it anyway, so the person sees them before adding. Returns only the
  // fields that change.
  function idsFromLink(current: SourceDraft): Partial<SourceDraft> {
    const url = current.url.trim();
    const filled = filledFromLink.current;
    const patch: Partial<SourceDraft> = {};
    if (current.doi.trim() === "" || current.doi === filled.doi) {
      const doi = doiFromLink(url);
      if (doi !== current.doi) {
        patch.doi = doi;
      }
      filled.doi = doi;
    }
    if (current.arxivId.trim() === "" || current.arxivId === filled.arxivId) {
      const arxivId = arxivIdFromLink(url);
      if (arxivId !== current.arxivId) {
        patch.arxivId = arxivId;
      }
      filled.arxivId = arxivId;
    }
    return patch;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in the link field submits without leaving it, so fill here too.
    const filledDraft = { ...draft, ...idsFromLink(draft) };
    setDraft(filledDraft);
    const found = check(filledDraft);
    setErrors(found);
    setOtherProblems([]);
    setSaveError(null);
    setDuplicate(null);
    setDuplicateDraft(null);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    setSaving(true);
    focusResultAfterSave.current = true;
    try {
      const id = await addSource(toRequest(filledDraft));
      setSaved(true);
      // added=1 has the review page confirm it ("Added to the review queue.").
      router.push(`${reviewHref(id, { status: "pending_review", kind: "", flag: "", q: "" })}&added=1`);
    } catch (caught) {
      const apiError = toApiError(caught);
      const match = duplicateFrom(apiError);
      if (match) {
        setDuplicate(match);
        setDuplicateDraft(filledDraft);
      } else {
        placeApiErrors(apiError);
      }
      setSaving(false);
    }
  }

  // The API's "url: must start with https://" lines go next to their fields.
  function placeApiErrors(apiError: ApiError) {
    const mapped: Errors = {};
    const unplaced: string[] = [];
    for (const item of fieldErrorsFrom(apiError)) {
      const known = FIELD_IDS.some((field) => field.key === item.path);
      if (item.path === "url" && item.message.startsWith(API_LINK_INCOMPLETE)) {
        // A link the check above let through but the API reads differently.
        // It gets the same sentence the check would have shown.
        mapped.url = LINK_INCOMPLETE;
      } else if (known) {
        mapped[item.path] = item.message;
      } else {
        unplaced.push(item.path ? `${item.path}: ${item.message}` : item.message);
      }
    }
    setErrors(mapped);
    setOtherProblems(unplaced);
    if (Object.keys(mapped).length > 0) {
      focusAfterSave.current = firstErrorId(mapped);
    } else {
      setSaveError(apiError);
    }
  }

  function fieldProps(key: string, id: string, hintId?: string) {
    const error = errors[key];
    const described: string[] = [];
    if (hintId) {
      described.push(hintId);
    }
    if (error) {
      described.push(`${id}-error`);
    }
    return {
      id,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": described.length > 0 ? described.join(" ") : undefined,
      disabled: saving,
    };
  }

  function errorFor(key: string, id: string) {
    if (!errors[key]) {
      return null;
    }
    return (
      <p id={`${id}-error`} className={forms.error}>
        {errors[key]}
      </p>
    );
  }

  return (
    <>
      <AdminPageHead
        eyebrow="Team admin"
        title={
          <>
            Add a <em>source</em>
          </>
        }
        lede="For a paper the pipeline didn't find. It goes into Pending review, where someone approves or rejects it like any other paper."
      />
      <div className={`container ${detail.page}`}>
        <form className={`paper ${styles.card} ${styles.narrow}`} onSubmit={onSubmit} noValidate aria-label="The paper">
          <div className={forms.field}>
            <label htmlFor="source-url" className={forms.label}>
              Link
            </label>
            <input
              {...fieldProps("url", "source-url", "source-url-hint")}
              type="url"
              inputMode="url"
              className={`${forms.input} ${errors.url ? forms.invalid : ""}`}
              value={draft.url}
              onChange={(event) => update({ url: event.target.value }, "url")}
              onBlur={() => update(idsFromLink(draft))}
              spellCheck={false}
            />
            <p id="source-url-hint" className={forms.hint}>
              The paper&rsquo;s own page. A doi.org or arXiv link fills in the DOI or arXiv id for you.
            </p>
            {errorFor("url", "source-url")}
          </div>

          <div className={forms.field}>
            <label htmlFor="source-title" className={forms.label}>
              Title
            </label>
            <input
              {...fieldProps("title", "source-title")}
              className={`${forms.input} ${errors.title ? forms.invalid : ""}`}
              value={draft.title}
              onChange={(event) => update({ title: event.target.value }, "title")}
            />
            {errorFor("title", "source-title")}
          </div>

          <div className={forms.field}>
            <label htmlFor="source-authors" className={forms.label}>
              Authors <span className={forms.optional}>(optional)</span>
            </label>
            <textarea
              {...fieldProps("authors", "source-authors", "source-authors-hint")}
              className={`${forms.textarea} ${styles.shortText}`}
              value={draft.authors}
              onChange={(event) => update({ authors: event.target.value }, "authors")}
            />
            <p id="source-authors-hint" className={forms.hint}>
              One per line, as they appear on the paper.
            </p>
            {errorFor("authors", "source-authors")}
          </div>

          <div className={styles.grid3}>
            <div className={forms.field}>
              <label htmlFor="source-year" className={forms.label}>
                Year
              </label>
              <input
                {...fieldProps("year", "source-year")}
                type="text"
                inputMode="numeric"
                className={`${forms.input} ${errors.year ? forms.invalid : ""}`}
                value={draft.year}
                onChange={(event) => update({ year: event.target.value }, "year")}
              />
              {errorFor("year", "source-year")}
            </div>
            <div className={forms.field}>
              <label htmlFor="source-type" className={forms.label}>
                Source type <span className={forms.optional}>(optional)</span>
              </label>
              <select
                {...fieldProps("source_type", "source-type")}
                className={forms.select}
                value={draft.sourceType}
                onChange={(event) => update({ sourceType: event.target.value as SourceType | "" }, "source_type")}
              >
                <option value="">Not sure yet</option>
                {enumValues("SourceType").map((info) => (
                  <option key={info.value} value={info.value}>
                    {info.label}
                  </option>
                ))}
              </select>
              {errorFor("source_type", "source-type")}
            </div>
            <div className={forms.field}>
              <label htmlFor="source-venue" className={forms.label}>
                Venue <span className={forms.optional}>(optional)</span>
              </label>
              <input
                {...fieldProps("venue", "source-venue", "source-venue-hint")}
                className={forms.input}
                value={draft.venue}
                onChange={(event) => update({ venue: event.target.value }, "venue")}
              />
              <p id="source-venue-hint" className={forms.hint}>
                A journal, conference or publisher.
              </p>
              {errorFor("venue", "source-venue")}
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={forms.field}>
              <label htmlFor="source-doi" className={forms.label}>
                DOI <span className={forms.optional}>(optional)</span>
              </label>
              <input
                {...fieldProps("doi", "source-doi", "source-doi-hint")}
                className={`${forms.input} ${errors.doi ? forms.invalid : ""}`}
                value={draft.doi}
                onChange={(event) => update({ doi: event.target.value }, "doi")}
                spellCheck={false}
              />
              <p id="source-doi-hint" className={forms.hint}>
                Starts with 10., like 10.1038/s41586-024-07558-y.
              </p>
              {errorFor("doi", "source-doi")}
            </div>
            <div className={forms.field}>
              <label htmlFor="source-arxiv" className={forms.label}>
                arXiv id <span className={forms.optional}>(optional)</span>
              </label>
              <input
                {...fieldProps("arxiv_id", "source-arxiv", "source-arxiv-hint")}
                className={`${forms.input} ${errors.arxiv_id ? forms.invalid : ""}`}
                value={draft.arxivId}
                onChange={(event) => update({ arxivId: event.target.value }, "arxiv_id")}
                spellCheck={false}
              />
              <p id="source-arxiv-hint" className={forms.hint}>
                Like 2411.18526.
              </p>
              {errorFor("arxiv_id", "source-arxiv")}
            </div>
          </div>

          <div className={forms.field}>
            <label htmlFor="source-abstract" className={forms.label}>
              Abstract <span className={forms.optional}>(optional)</span>
            </label>
            <textarea
              {...fieldProps("abstract", "source-abstract", "source-abstract-hint")}
              className={forms.textarea}
              value={draft.abstract}
              onChange={(event) => update({ abstract: event.target.value }, "abstract")}
            />
            <p id="source-abstract-hint" className={forms.hint}>
              Helps whoever reviews it. Like every abstract, it&rsquo;s deleted once the paper is decided, because
              abstracts are usually copyrighted.
            </p>
            {errorFor("abstract", "source-abstract")}
          </div>

          <div className={forms.field}>
            <label htmlFor="source-note" className={forms.label}>
              Note for the reviewer <span className={forms.optional}>(optional, never published)</span>
            </label>
            <textarea
              {...fieldProps("note", "source-note")}
              className={`${forms.textarea} ${styles.shortText}`}
              value={draft.note}
              onChange={(event) => update({ note: event.target.value }, "note")}
            />
            {errorFor("note", "source-note")}
          </div>

          {duplicate && <DuplicateNotice duplicate={duplicate} leaveWithoutAsking={isDuplicate} titleRef={resultRef} />}
          {otherProblems.length > 0 && (
            <Notice tone="error" title="The source wasn't added." titleRef={resultRef}>
              <ul className={styles.problemList}>
                {otherProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Notice>
          )}
          {saveError && <ApiErrorNotice error={saveError} title="The source wasn't added" titleRef={resultRef} />}

          <div className={forms.actions}>
            <button type="submit" className={`btn btn-primary ${forms.button}`} disabled={saving}>
              {saving ? "Adding…" : "Add to the review queue"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

const MATCH_TEXT: Record<string, string> = {
  doi: "It has the same DOI",
  arxiv_id: "It has the same arXiv id",
  url: "It has the same link",
  title: "It has the same title",
};

interface DuplicateNoticeProps {
  duplicate: DuplicateSource;
  // True while the form still holds the duplicate draft, so its link skips
  // the unsaved-work question (leavesWithoutAsking in unsavedWork.ts).
  leaveWithoutAsking: boolean;
  titleRef: Ref<HTMLParagraphElement>;
}

function DuplicateNotice({ duplicate, leaveWithoutAsking, titleRef }: DuplicateNoticeProps) {
  const why = duplicate.match ? MATCH_TEXT[duplicate.match] : undefined;
  const leaveMark = leaveWithoutAsking ? "true" : undefined;
  if (duplicate.in_content) {
    return (
      <Notice tone="warning" title="The site already cites this paper." titleRef={titleRef}>
        <p>
          {why ? `${why} as a source on the public site. ` : ""}
          <Link href={`/sources/#${duplicate.existing_id}`} data-leave-without-asking={leaveMark}>
            See it on the Sources page
          </Link>
        </p>
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title="This paper is already in admin." titleRef={titleRef}>
      <p>
        {why ? `${why} as a paper someone added or the pipeline found. ` : ""}
        <Link
          href={reviewHref(duplicate.existing_id, { status: "pending_review", kind: "", flag: "", q: "" })}
          data-leave-without-asking={leaveMark}
        >
          Open that paper
        </Link>
      </p>
    </Notice>
  );
}
