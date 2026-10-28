"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PostBody } from "@/components/blog/PostBody";
import { EmphasisText } from "@/components/common/Emphasis";
import type { AdminPost, PostInput, PostStatus } from "@/lib/adminTypes";
import { createPost, fieldErrorsFrom, getAdminPost, savePost, toApiError, type ApiError } from "@/lib/api";
import { getSession } from "@/lib/auth";

import { AdminPageHead } from "./AdminPageHead";
import { formatDateTime, formatDay } from "./adminFormat";
import { PublishStateChip } from "./Chips";
import styles from "./Editor.module.css";
import { flashAfterNavigation, useFlash } from "./editorFlash";
import {
  hasLongDash,
  isIsoDate,
  isSlug,
  LONG_DASH_FIX,
  savedFirstFrom,
  slugify,
  todayIso,
} from "./editorModel";
import forms from "./forms.module.css";
import { ConflictNotice } from "./ConflictNotice";
import { ApiErrorNotice, Notice } from "./Notice";
import { postEditHref } from "./PostList";
import { useUnsavedWork } from "./unsavedWork";
import { useApiData } from "./useApiData";
import { useWideScreen } from "./useWideScreen";

interface PostDraft {
  title: string;
  slug: string;
  date: string;
  author: string;
  summary: string;
  body: string;
}

type DraftField = keyof PostDraft;

// Field -> message. Keys match the API's field names.
type Errors = Partial<Record<DraftField, string>>;

// In page order, for moving focus to the first problem.
const FIELDS: { key: DraftField; id: string; label: string }[] = [
  { key: "title", id: "post-title", label: "Title" },
  { key: "slug", id: "post-slug", label: "Address" },
  { key: "date", id: "post-date", label: "Date" },
  { key: "author", id: "post-author", label: "Author" },
  { key: "summary", id: "post-summary", label: "Summary" },
  { key: "body", id: "post-body", label: "Post" },
];

function focusFirstError(errors: Errors): void {
  for (const field of FIELDS) {
    if (errors[field.key]) {
      document.getElementById(field.id)?.focus();
      return;
    }
  }
}

// The same rules the API applies to every save, draft or not.
function check(draft: PostDraft): Errors {
  const errors: Errors = {};
  if (draft.title.trim() === "") {
    errors.title = "Give the post a title.";
  }
  if (draft.slug.trim() === "") {
    errors.slug = "Give the post an address.";
  } else if (!isSlug(draft.slug.trim())) {
    errors.slug = "Use lowercase letters, numbers and single hyphens, like why-we-show-every-forecast.";
  }
  if (!isIsoDate(draft.date.trim())) {
    errors.date = "Write the date as YYYY-MM-DD, like 2026-10-27.";
  }
  if (draft.author.trim() === "") {
    errors.author = "Say who wrote it.";
  }
  if (draft.summary.trim() === "") {
    errors.summary = "Add a one-line summary. It shows on the blog's list of posts.";
  }
  if (draft.body.trim() === "") {
    errors.body = "The post has no text yet.";
  }
  for (const field of FIELDS) {
    if (!errors[field.key] && hasLongDash(draft[field.key])) {
      errors[field.key] = `Has a long dash. ${LONG_DASH_FIX}`;
    }
  }
  return errors;
}

function toDraft(post: AdminPost | null): PostDraft {
  if (post === null) {
    const session = getSession();
    return {
      title: "",
      slug: "",
      date: todayIso(),
      author: session ? session.user.display_name : "",
      summary: "",
      body: "",
    };
  }
  return {
    title: post.title,
    slug: post.slug,
    date: post.date,
    author: post.author,
    summary: post.summary,
    body: post.body,
  };
}

function toInput(draft: PostDraft, status: PostStatus): PostInput {
  return {
    title: draft.title.trim(),
    slug: draft.slug.trim(),
    date: draft.date.trim(),
    author: draft.author.trim(),
    summary: draft.summary.trim(),
    body: draft.body,
    status,
  };
}

function savedMessage(status: PostStatus): string {
  return status === "published"
    ? "Saved. It goes on the site with the next publish."
    : "Draft saved. It stays off the site until you mark it published.";
}

// /admin/posts/edit/?slug=<slug>, or no slug for a new post.
export function PostEditor() {
  const slug = useSearchParams().get("slug") ?? "";
  // A fresh screen per post, so nothing typed carries over.
  return <PostScreen key={slug} slug={slug} />;
}

function BackLink() {
  return <Link href="/admin/posts/">Back to the posts</Link>;
}

function PostScreen({ slug }: { slug: string }) {
  const loaded = useApiData(slug === "" ? null : `post:${slug}`, () => getAdminPost(slug));
  const flash = useFlash(`post:${slug}`);

  if (slug !== "" && !loaded.data) {
    const notFound = loaded.error !== null && loaded.error.status === 404;
    return (
      <>
        <AdminPageHead
          eyebrow="Blog post"
          title={notFound ? <>Post not <em>found</em></> : <>Loading the <em>post</em></>}
          kicker={<BackLink />}
        />
        <div className={`container ${styles.listPage}`}>
          {notFound && (
            <Notice tone="info" title="There's no post with this address.">
              <p>
                It may have been renamed. The <Link href="/admin/posts/">list of posts</Link> has every one.
              </p>
            </Notice>
          )}
          {loaded.error && !notFound && (
            <ApiErrorNotice error={loaded.error} title="Couldn't load this post" onRetry={loaded.reload} />
          )}
          {!loaded.error && <p className={styles.muted}>Loading&hellip;</p>}
        </div>
      </>
    );
  }

  // A newer version from "Load their version" remounts the form with it.
  return (
    <PostForm
      key={loaded.data ? loaded.data.version : "new"}
      initial={loaded.data}
      flash={flash}
      onReload={loaded.reload}
    />
  );
}

interface PostFormProps {
  // null for a new post.
  initial: AdminPost | null;
  flash: string | null;
  onReload: () => void;
}

function PostForm({ initial, flash, onReload }: PostFormProps) {
  const router = useRouter();
  // What the server has: the version to save against and the post's status.
  const [record, setRecord] = useState<AdminPost | null>(initial);
  const [draft, setDraft] = useState<PostDraft>(() => toDraft(initial));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(toDraft(initial)));
  // A new post's address follows its title until someone edits the address.
  const [slugEdited, setSlugEdited] = useState(initial !== null);
  const [errors, setErrors] = useState<Errors>({});
  const [otherProblems, setOtherProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState<PostStatus | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(flash);

  const dirty = JSON.stringify(draft) !== baseline;
  useUnsavedWork(dirty);

  const status: PostStatus = record ? record.status : "draft";
  const wide = useWideScreen();
  // The address is the post's URL, so it's fixed once the post has gone public.
  const slugLocked = record !== null && record.published_at !== null;
  const savedFirst = savedFirstFrom(saveError);

  function update(field: DraftField, value: string) {
    setDraft((previous) => {
      const next = { ...previous, [field]: value };
      if (field === "title" && !slugEdited) {
        next.slug = slugify(value);
      }
      return next;
    });
    if (field === "slug") {
      setSlugEdited(true);
    }
    if (errors[field]) {
      setErrors((previous) => ({ ...previous, [field]: undefined }));
    }
    setMessage(null);
  }

  async function save(nextStatus: PostStatus, overVersion: number | null = null) {
    const found = check(draft);
    setErrors(found);
    setOtherProblems([]);
    setSaveError(null);
    setMessage(null);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    setSaving(nextStatus);
    const input = toInput(draft, nextStatus);
    try {
      let saved: AdminPost | null;
      if (record === null) {
        saved = await createPost(input);
      } else {
        const version = overVersion ?? record.version;
        saved = await savePost(record.slug, { ...input, version });
      }
      const text = savedMessage(nextStatus);
      // A new post, or a renamed draft, lives at a new address now.
      if (record === null || input.slug !== record.slug) {
        setBaseline(JSON.stringify(draft));
        flashAfterNavigation(`post:${input.slug}`, text);
        router.replace(postEditHref(input.slug));
        return;
      }
      setRecord(
        saved ?? { ...record, ...input, version: record.version + 1, updated_at: new Date().toISOString() },
      );
      setBaseline(JSON.stringify(draft));
      setMessage(text);
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.status === 409 && apiError.code === "slug_taken") {
        setErrors({ slug: "Another post already has this address. Pick another." });
        document.getElementById("post-slug")?.focus();
      } else {
        placeApiErrors(apiError);
      }
    } finally {
      setSaving(null);
    }
  }

  // "Save mine over it" after a conflict: save against the newest version.
  async function saveOver() {
    if (record === null) {
      return;
    }
    try {
      const latest = await getAdminPost(record.slug);
      await save(status, latest.version);
    } catch (caught) {
      setSaveError(toApiError(caught));
    }
  }

  function placeApiErrors(apiError: ApiError) {
    const mapped: Errors = {};
    const unplaced: string[] = [];
    for (const item of fieldErrorsFrom(apiError)) {
      const field = FIELDS.find((entry) => entry.key === item.path);
      if (field) {
        mapped[field.key] = item.message;
      } else if (apiError.status === 422) {
        unplaced.push(item.path ? `${item.path}: ${item.message}` : item.message);
      }
    }
    setErrors(mapped);
    setOtherProblems(unplaced);
    if (Object.keys(mapped).length > 0) {
      focusFirstError(mapped);
    } else if (unplaced.length === 0) {
      setSaveError(apiError);
    }
  }

  function inputProps(key: DraftField, id: string, hintId?: string) {
    const described: string[] = [];
    if (hintId) {
      described.push(hintId);
    }
    if (errors[key]) {
      described.push(`${id}-error`);
    }
    return {
      id,
      value: draft[key],
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": described.length > 0 ? described.join(" ") : undefined,
      disabled: saving !== null,
    };
  }

  function errorFor(key: DraftField, id: string) {
    if (!errors[key]) {
      return null;
    }
    return (
      <p id={`${id}-error`} className={forms.error}>
        {errors[key]}
      </p>
    );
  }

  const heading = record ? (
    <>
      Edit the <em>post</em>
    </>
  ) : (
    <>
      A new <em>post</em>
    </>
  );

  return (
    <>
      <AdminPageHead
        eyebrow="Blog post"
        title={heading}
        kicker={<BackLink />}
        actions={record ? <PublishStateChip published={status === "published"} /> : undefined}
      />
      <div className={`container ${styles.listPage}`}>
        <div className={styles.split}>
          <form className={styles.formColumn} onSubmit={(event) => event.preventDefault()} noValidate>
            {/* After the first save the page reloads at the top, so it says so here too. */}
            {message !== null && message === flash && !dirty && <Notice tone="success" title={message} />}
            {!wide && (
              <details className={styles.foldedPreview}>
                <summary>See the preview</summary>
                <div className={styles.previewFrame}>
                  <PostPreview draft={draft} />
                </div>
              </details>
            )}
            <div className={`paper ${styles.card}`}>
              <div className={forms.field}>
                <label htmlFor="post-title" className={forms.label}>
                  Title
                </label>
                <input
                  {...inputProps("title", "post-title", "post-title-hint")}
                  className={`${forms.input} ${errors.title ? forms.invalid : ""}`}
                  onChange={(event) => update("title", event.target.value)}
                />
                <p id="post-title-hint" className={forms.hint}>
                  Put *asterisks* around one word or phrase to set it in italics.
                </p>
                {errorFor("title", "post-title")}
              </div>

              <div className={forms.field}>
                <label htmlFor="post-slug" className={forms.label}>
                  Address
                </label>
                <input
                  {...inputProps("slug", "post-slug", "post-slug-hint")}
                  className={`${forms.input} ${errors.slug ? forms.invalid : ""}`}
                  onChange={(event) => update("slug", event.target.value)}
                  readOnly={slugLocked}
                  spellCheck={false}
                />
                <p id="post-slug-hint" className={forms.hint}>
                  {slugLocked
                    ? `Fixed, because the post has been published at /blog/${draft.slug}/.`
                    : `The post will be at /blog/${draft.slug.trim() || "its-address"}/.${slugEdited ? "" : " Filled in from the title."}`}
                </p>
                {errorFor("slug", "post-slug")}
              </div>

              <div className={styles.grid2}>
                <div className={forms.field}>
                  <label htmlFor="post-date" className={forms.label}>
                    Date
                  </label>
                  <input
                    {...inputProps("date", "post-date", "post-date-hint")}
                    className={`${forms.input} ${errors.date ? forms.invalid : ""}`}
                    onChange={(event) => update("date", event.target.value)}
                    inputMode="numeric"
                  />
                  <p id="post-date-hint" className={forms.hint}>
                    YYYY-MM-DD. The blog lists posts by this date.
                  </p>
                  {errorFor("date", "post-date")}
                </div>
                <div className={forms.field}>
                  <label htmlFor="post-author" className={forms.label}>
                    Author
                  </label>
                  <input
                    {...inputProps("author", "post-author")}
                    className={`${forms.input} ${errors.author ? forms.invalid : ""}`}
                    onChange={(event) => update("author", event.target.value)}
                  />
                  {errorFor("author", "post-author")}
                </div>
              </div>

              <div className={forms.field}>
                <label htmlFor="post-summary" className={forms.label}>
                  Summary
                </label>
                <textarea
                  {...inputProps("summary", "post-summary", "post-summary-hint")}
                  className={`${forms.textarea} ${styles.shortText} ${errors.summary ? forms.invalid : ""}`}
                  onChange={(event) => update("summary", event.target.value)}
                />
                <p id="post-summary-hint" className={forms.hint}>
                  A sentence for the blog&rsquo;s list of posts.
                </p>
                {errorFor("summary", "post-summary")}
              </div>

              <div className={forms.field}>
                <label htmlFor="post-body" className={forms.label}>
                  The post
                </label>
                <textarea
                  {...inputProps("body", "post-body", "post-body-hint")}
                  className={`${forms.textarea} ${styles.longText} ${errors.body ? forms.invalid : ""}`}
                  onChange={(event) => update("body", event.target.value)}
                />
                <p id="post-body-hint" className={forms.hint}>
                  Markdown: a blank line between paragraphs, ## for a heading, *italics*, **bold**, [text](link).
                </p>
                {errorFor("body", "post-body")}
              </div>
            </div>

            <div className={styles.saveBar}>
              {savedFirst && (
                <ConflictNotice savedFirst={savedFirst} onLoadTheirs={onReload} onSaveMine={() => void saveOver()} />
              )}
              {otherProblems.length > 0 && (
                <Notice tone="error" title="The post wasn't saved.">
                  <ul className={styles.problemList}>
                    {otherProblems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              {saveError && !savedFirst && <ApiErrorNotice error={saveError} title="The post wasn't saved" />}
              {message && !dirty && <Notice tone="success" title={message} />}
              <div className={forms.actions}>
                {status === "draft" ? (
                  <>
                    <button
                      type="button"
                      className={`btn btn-secondary ${forms.button}`}
                      onClick={() => void save("draft")}
                      disabled={saving !== null}
                    >
                      {saving === "draft" ? "Saving…" : "Save draft"}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-primary ${forms.button}`}
                      onClick={() => void save("published")}
                      disabled={saving !== null}
                    >
                      {saving === "published" ? "Saving…" : "Mark published"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`btn btn-primary ${forms.button}`}
                      onClick={() => void save("published")}
                      disabled={saving !== null || !dirty}
                    >
                      {saving === "published" ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary ${forms.button}`}
                      onClick={() => void save("draft")}
                      disabled={saving !== null}
                    >
                      {saving === "draft" ? "Saving…" : "Move back to draft"}
                    </button>
                  </>
                )}
                {!dirty && !message && record && <span className={styles.savedLine}>No unsaved changes.</span>}
              </div>
              {record && (
                <p className={styles.savedLine}>
                  Last saved {formatDateTime(record.updated_at)}
                  {record.updated_by ? ` by ${record.updated_by}` : ""}.{" "}
                  {status === "published"
                    ? "Published posts go on the site with the next publish, from the dashboard."
                    : "Drafts never go on the site."}
                </p>
              )}
            </div>
          </form>

          {wide && (
            <section className={styles.previewColumn} aria-labelledby="post-preview-heading">
              <div className={styles.previewHead}>
                <h2 id="post-preview-heading" className={styles.previewLabel}>
                  Preview
                </h2>
                <span className={styles.muted}>How readers will see it</span>
              </div>
              <div className={styles.previewFrame}>
                <PostPreview draft={draft} />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function PostPreview({ draft }: { draft: PostDraft }) {
  const meta: string[] = [];
  if (isIsoDate(draft.date.trim())) {
    meta.push(formatDay(`${draft.date.trim()}T12:00:00`));
  }
  if (draft.author.trim() !== "") {
    meta.push(draft.author.trim());
  }
  return (
    <article className={styles.postPreview}>
      {meta.length > 0 && <p className="eyebrow">{meta.join(" · ")}</p>}
      {/* Like the blog, *asterisks* in the title mark its italic phrase. */}
      <h3 className={styles.postPreviewTitle}>
        {draft.title.trim() === "" ? "Untitled post" : <EmphasisText text={draft.title.trim()} />}
      </h3>
      {draft.summary.trim() !== "" && <p className={styles.postPreviewSummary}>{draft.summary.trim()}</p>}
      {draft.body.trim() === "" ? (
        <p className={styles.muted}>The post&rsquo;s text shows here as you write it.</p>
      ) : (
        <PostBody markdown={draft.body} />
      )}
    </article>
  );
}
