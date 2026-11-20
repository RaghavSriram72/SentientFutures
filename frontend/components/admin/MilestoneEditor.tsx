"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { CatalogSource, MilestoneRecord, MilestoneRevision } from "@/lib/adminTypes";
import {
  createMilestone,
  fieldErrorsFrom,
  getMilestoneRecord,
  getMilestoneRevisions,
  getSourceCatalog,
  listMilestones,
  saveMilestone,
  toApiError,
  type ApiError,
} from "@/lib/api";
import { getSession } from "@/lib/auth";
import { enumDescription, enumLabel, enumValues } from "@/lib/enums";
import type {
  Claim,
  Confidence,
  MilestoneCategory,
  MilestoneStatus,
  Stage,
  Technology,
} from "@/lib/types";

import { AdminPageHead } from "./AdminPageHead";
import { formatDateTime, formatDay } from "./adminFormat";
import { ClaimEditor, ClaimListEditor } from "./ClaimEditor";
import { PublishStateChip, SampleChip } from "./Chips";
import { ConflictNotice } from "./ConflictNotice";
import styles from "./Editor.module.css";
import { flashAfterNavigation, useFlash } from "./editorFlash";
import { savedFirstFrom, slugify, todayIso, withoutPrefix } from "./editorModel";
import { ForecastEditor, YearInput } from "./ForecastEditor";
import forms from "./forms.module.css";
import { milestoneEditHref } from "./MilestoneList";
import {
  blankMilestone,
  categoryGroups,
  fieldId,
  focusField,
  inFormOrder,
  messagesAt,
  milestoneProblems,
  optionsInNoGroup,
  pathLabel,
  previewMilestones,
  problemsStillOpen,
  teamRangePatch,
  toDraft,
  toMilestone,
  type ChoiceGroup,
  type ChoiceOption,
  type MilestoneDraft,
  type MilestoneErrors,
} from "./milestoneModel";
import { MilestonePreview } from "./MilestonePreview";
import { ApiErrorNotice, Notice, withPublishLink } from "./Notice";
import { MultiPicker, sourceOptions, type PickerOption } from "./Pickers";
import { useUnsavedWork } from "./unsavedWork";
import { useApiData } from "./useApiData";
import { useClearAfterSignIn } from "./useClearAfterSignIn";
import { useWideScreen } from "./useWideScreen";

// /admin/milestones/edit/?id=<id>, or no id for a new milestone.
export function MilestoneEditor() {
  const id = useSearchParams().get("id") ?? "";
  // A fresh screen per milestone, so nothing typed carries over.
  return <MilestoneScreen key={id} id={id} />;
}

function BackLink() {
  return <Link href="/admin/milestones/">Back to the milestones</Link>;
}

function MilestoneScreen({ id }: { id: string }) {
  const record = useApiData(id === "" ? null : `milestone:${id}`, () => getMilestoneRecord(id));
  // For the depends-on picker and the preview's links and codes.
  const all = useApiData("milestones", listMilestones);
  const catalog = useApiData("source-catalog", getSourceCatalog);
  const flash = useFlash(`milestone:${id}`);

  const failed = (id !== "" ? record.error : null) ?? all.error ?? catalog.error;
  const notFound = id !== "" && record.error !== null && record.error.status === 404;
  const ready = (id === "" || record.data !== null) && all.data !== null && catalog.data !== null;

  if (!ready) {
    return (
      <>
        <AdminPageHead
          eyebrow="Milestone"
          title={notFound ? <>Milestone not <em>found</em></> : <>Loading the <em>milestone</em></>}
          kicker={<BackLink />}
        />
        <div className={`container ${styles.listPage}`}>
          {notFound && (
            <Notice tone="info" title="There's no milestone with this id.">
              <p>
                The <Link href="/admin/milestones/">list of milestones</Link> has every one there is.
              </p>
            </Notice>
          )}
          {failed && !notFound && (
            <ApiErrorNotice
              error={failed}
              title="Couldn't load what the editor needs"
              onRetry={() => {
                record.reload();
                all.reload();
                catalog.reload();
              }}
            />
          )}
          {!failed && <p className={styles.muted}>Loading&hellip;</p>}
        </div>
      </>
    );
  }

  // Every other milestone, for the depends-on picker.
  const others: MilestoneRecord[] = [];
  for (const item of all.data ?? []) {
    if (item.milestone.id !== id) {
      others.push(item);
    }
  }

  // "Load their version" after a conflict brings a newer version, which
  // remounts the form with it. The "Saved" from the first save was about
  // this tab's version, so the new form starts without it.
  function loadTheirs() {
    flash.clear();
    record.reload();
  }

  return (
    <MilestoneForm
      key={record.data ? record.data.version : "new"}
      initial={record.data}
      others={others}
      records={all.data ?? []}
      catalog={catalog.data ?? []}
      flash={flash.message}
      onReload={loadTheirs}
    />
  );
}

// "Saved. ..." for each way a milestone can be after saving.
function savedMessage(draft: MilestoneDraft): string {
  if (draft.sample) {
    return "Saved. It's a sample, so it stays off the public site.";
  }
  if (draft.published) {
    return "Saved. On the site after the next publish.";
  }
  return "Saved as a draft. It stays off the site until it's published.";
}

// Other milestones as picker options, grouped by technology. The API refuses
// a real milestone that depends on a sample, so a real one isn't offered
// samples. (One already chosen stays, so its name shows next to Remove.)
// Unpublished milestones say so, since a published one can't depend on them.
function milestoneOptions(others: MilestoneRecord[], editingSample: boolean, chosen: string[]): PickerOption[] {
  const options: PickerOption[] = [];
  for (const record of others) {
    const milestone = record.milestone;
    if (milestone.sample && !editingSample && !chosen.includes(milestone.id)) {
      continue;
    }
    let note = "";
    if (milestone.sample) {
      note = " (sample)";
    } else if (!record.published) {
      note = " (draft)";
    }
    options.push({
      value: milestone.id,
      label: `${milestone.name || milestone.id}${note}`,
      group: enumLabel("Technology", milestone.technology),
    });
  }
  return options;
}

function estimateKey(draft: MilestoneDraft): string {
  if (draft.estimate === null) {
    return "none";
  }
  return JSON.stringify([draft.estimate.earliest, draft.estimate.latest, draft.estimate.basis]);
}

interface MilestoneFormProps {
  // null for a new milestone.
  initial: MilestoneRecord | null;
  others: MilestoneRecord[];
  // Every milestone, for the preview to number this one among (previewMilestones).
  records: MilestoneRecord[];
  catalog: CatalogSource[];
  flash: string | null;
  onReload: () => void;
}

function MilestoneForm({ initial, others, records, catalog, flash, onReload }: MilestoneFormProps) {
  const router = useRouter();
  const session = getSession();
  const editorName = session ? session.user.display_name || session.user.email : "";
  const [nowYear] = useState(() => new Date().getFullYear());

  const [record, setRecord] = useState<MilestoneRecord | null>(initial);
  const [draft, setDraft] = useState<MilestoneDraft>(() =>
    initial ? toDraft(initial.milestone, initial.published) : blankMilestone(),
  );
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(draft));
  // The team range as it was loaded, to tell whether set_by and set_on need updating.
  const [savedEstimate, setSavedEstimate] = useState<string>(() => estimateKey(draft));
  // A new milestone's id follows its name until someone edits the id.
  const [idEdited, setIdEdited] = useState(initial !== null);
  // The problems the last save attempt found, and the draft (as JSON) it checked.
  const [checked, setChecked] = useState<{ draft: string; errors: MilestoneErrors }>({ draft: "", errors: {} });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(flash);
  // True while the message is the one the page opened with after the first
  // save. The page starts at the top then, so it shows there instead of in
  // the save row at the bottom.
  const [messageAtTop, setMessageAtTop] = useState(flash !== null);
  // The version "Copy into the form" brought back, until it's saved or discarded.
  const [copiedFrom, setCopiedFrom] = useState<number | null>(null);
  // True after "Discard changes", until the next edit. The save row stays at
  // the bottom of the screen meanwhile, as it does after a save, so "No
  // unsaved changes." shows where "Discard changes" was.
  const [discarded, setDiscarded] = useState(false);
  const revisions = useApiData(record ? `milestone-revisions:${record.milestone.id}:${record.version}` : null, () =>
    getMilestoneRevisions(record ? record.milestone.id : ""),
  );
  // A field to move focus to once saving is over. Every input is disabled
  // while saving, so a problem the API finds can't take focus right away.
  const focusAfterSave = useRef<string | null>(null);
  // The Save button is disabled while saving, and stays disabled once the
  // form matches what's saved, so focus would drop to the page. It goes to
  // the title of whichever notice says how the save went instead: saved, a
  // conflict, or an error.
  const resultRef = useRef<HTMLParagraphElement>(null);
  const focusResultAfterSave = useRef(false);
  // The "Saved" at the top of the form, after the first save.
  const flashRef = useRef<HTMLParagraphElement>(null);
  // Holds focus while "Load their version" swaps the form (loadTheirs).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // "Discard changes" goes away with the changes, so focus would drop to the
  // page. It moves to the "No unsaved changes." that takes its place.
  const noChangesRef = useRef<HTMLSpanElement>(null);
  const focusAfterDiscard = useRef(false);
  // The conflict and error notices, which sit at the end of the long form.
  const noticesRef = useRef<HTMLDivElement>(null);
  const saveRowRef = useRef<HTMLDivElement>(null);
  // A save that ended the session leaves "Your session ended." on screen.
  // Once someone signs in again over the form, it goes.
  useClearAfterSignIn(saveError, () => setSaveError(null));

  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== baseline;
  useUnsavedWork(dirty);
  if (copiedFrom !== null && !dirty) {
    // The form matches what's saved: the copy changed nothing, or every
    // difference was undone by hand. Adjusting state while rendering, as
    // React's docs suggest, so a later edit doesn't bring the notice back.
    setCopiedFrom(null);
  }
  const savedFirst = savedFirstFrom(saveError);
  const sources = sourceOptions(catalog);
  const isNew = record === null;

  // Once the form changes after a save attempt, only the problems it still has
  // stay on screen, and none once it's back to what's saved.
  let errors: MilestoneErrors = checked.errors;
  if (!dirty && !isNew) {
    errors = {};
  } else if (draftJson !== checked.draft) {
    errors = problemsStillOpen(checked.errors, draft);
  }

  function setErrors(found: MilestoneErrors) {
    setChecked({ draft: draftJson, errors: found });
  }

  useEffect(() => {
    if (saving) {
      return;
    }
    if (focusAfterSave.current !== null) {
      focusField(focusAfterSave.current);
    } else if (focusResultAfterSave.current) {
      // "Saved" is in the save row, stuck to the bottom of the screen, and a
      // failed save's notice is brought into view by the noticesRef effect.
      // A plain focus() would scroll the page toward the stuck row's place
      // at the end of the form.
      resultRef.current?.focus({ preventScroll: true });
    }
    focusAfterSave.current = null;
    focusResultAfterSave.current = false;
  }, [saving]);

  // A new milestone's first save opens it at its own address, in a fresh
  // form, with "Saved" at the top. Focus starts there.
  useEffect(() => {
    if (flash !== null) {
      flashRef.current?.focus();
    }
  }, [flash]);

  useEffect(() => {
    if (!dirty && focusAfterDiscard.current) {
      // Also in the stuck save row, so already on screen. No scrolling, for
      // the same reason as "Saved" after a save.
      noChangesRef.current?.focus({ preventScroll: true });
    }
    focusAfterDiscard.current = false;
  }, [dirty]);

  // Save is always in reach at the bottom of the screen, so a save that fails
  // with a notice (a conflict, the API being down) brings the notice into view.
  useEffect(() => {
    if (!saving && saveError !== null) {
      noticesRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [saving, saveError]);

  function update(patch: Partial<MilestoneDraft>) {
    setDraft((previous) => {
      const next = { ...previous, ...patch };
      if (patch.name !== undefined && !idEdited) {
        next.id = slugify(patch.name);
      }
      return next;
    });
    setMessage(null);
    setDiscarded(false);
  }

  function claimProps(path: string) {
    return { path, errors, sources, disabled: saving, reviewerName: editorName };
  }

  function placeApiErrors(apiError: ApiError) {
    const found: MilestoneErrors = {};
    for (const item of fieldErrorsFrom(apiError)) {
      const path = withoutPrefix(item.path, "milestone");
      // Two problems on one field read as one sentence each.
      found[path] = found[path] ? `${found[path]} ${item.message}` : item.message;
    }
    // The API lists problems in its own order; the form lists them top to bottom.
    const mapped = inFormOrder(found);
    setErrors(mapped);
    const first = Object.keys(mapped)[0];
    if (first !== undefined) {
      focusAfterSave.current = first;
    } else {
      setSaveError(apiError);
    }
  }

  async function save(overVersion: number | null = null) {
    const found = milestoneProblems(draft);
    setErrors(found);
    setSaveError(null);
    setMessage(null);
    setMessageAtTop(false);
    const first = Object.keys(found)[0];
    if (first !== undefined) {
      focusField(first);
      return;
    }

    const milestone = toMilestone(draft, {
      estimateChanged: estimateKey(draft) !== savedEstimate,
      editor: editorName,
      today: todayIso(),
    });
    setSaving(true);
    focusResultAfterSave.current = true;
    try {
      if (record === null) {
        await createMilestone(milestone, draft.published);
        setBaseline(JSON.stringify(draft));
        flashAfterNavigation(`milestone:${milestone.id}`, savedMessage(draft));
        router.replace(milestoneEditHref(milestone.id));
        return;
      }
      const saved = await saveMilestone(record.milestone.id, {
        milestone,
        version: overVersion ?? record.version,
        published: draft.published,
      });
      const stored: MilestoneRecord = saved ?? {
        milestone,
        published: draft.published,
        version: record.version + 1,
        updated_by: editorName,
        updated_at: new Date().toISOString(),
      };
      const next = toDraft(stored.milestone, stored.published);
      setRecord(stored);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setSavedEstimate(estimateKey(next));
      setErrors({});
      setCopiedFrom(null);
      setMessage(savedMessage(next));
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.status === 409 && apiError.code === "id_taken") {
        setErrors({ id: "Another milestone already has this id. Pick another." });
        focusAfterSave.current = "id";
      } else if (apiError.status === 409 || apiError.status === 422 || apiError.status === 400) {
        if (apiError.code === "version_conflict") {
          setSaveError(apiError);
        } else {
          placeApiErrors(apiError);
        }
      } else {
        setSaveError(apiError);
      }
    } finally {
      setSaving(false);
    }
  }

  // "Load their version" after a conflict. Their version comes in a fresh
  // form, and the button goes with the old one, so focus waits on the
  // heading, which hands it on to the new form's (AdminPageHead).
  function loadTheirs() {
    headingRef.current?.focus();
    onReload();
  }

  // "Save mine over it" after a conflict: save against the newest version.
  async function saveOver() {
    if (record === null) {
      return;
    }
    try {
      const latest = await getMilestoneRecord(record.milestone.id);
      await save(latest.version);
    } catch (caught) {
      setSaveError(toApiError(caught));
    }
  }

  function discard() {
    setDraft(JSON.parse(baseline) as MilestoneDraft);
    setErrors({});
    setSaveError(null);
    setMessage(null);
    setCopiedFrom(null);
    setDiscarded(true);
    focusAfterDiscard.current = true;
  }

  function copyRevision(revision: MilestoneRevision) {
    if (!revision.milestone) {
      return;
    }
    setDraft(toDraft(revision.milestone, revision.published));
    setErrors({});
    setMessage(null);
    setDiscarded(false);
    setCopiedFrom(revision.version);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAchievedIn(value: number | null) {
    let basis = draft.achieved_in_basis;
    if (value !== null && basis === null) {
      basis = { text: "", provenance: "source", source_ids: [], quote: "" };
    }
    update({ achieved_in: value, achieved_in_basis: value === null ? null : basis });
  }

  function setHasEstimate(on: boolean) {
    update(teamRangePatch(on));
  }

  const problems = Object.entries(errors);
  const wide = useWideScreen();
  // The form is long, so while there's something to save (or a save just
  // finished, or changes were just discarded) the save row stays at the bottom
  // of the screen until the form ends.
  const stickySave = dirty || isNew || (message !== null && !messageAtTop) || discarded;
  useSaveRowHeight(saveRowRef, stickySave);
  // What the timeline shows, with this milestone in its place, so the
  // preview's codes match the timeline's.
  const timeline = previewMilestones(records, record ? record.milestone.id : "", draft.sample === true);
  const preview = (
    <MilestonePreview
      milestone={toMilestone(draft, { estimateChanged: false, editor: editorName, today: todayIso() })}
      others={timeline}
      catalog={catalog}
      nowYear={nowYear}
    />
  );
  const stageHint = enumDescription("Stage", draft.stage);

  return (
    <>
      <AdminPageHead
        eyebrow="Milestone"
        title={isNew ? <>A new <em>milestone</em></> : <>{draft.name || record.milestone.name}</>}
        kicker={<BackLink />}
        actions={
          draft.sample ? <SampleChip /> : !isNew ? <PublishStateChip published={record.published} /> : undefined
        }
        headingRef={headingRef}
      />
      <div className={`container ${styles.listPage}`}>
        <div className={styles.split}>
          <form className={styles.formColumn} onSubmit={(event) => event.preventDefault()} noValidate>
            {/* After the first save the page reloads at the top, so it says so here too. */}
            {message !== null && messageAtTop && !dirty && (
              <Notice tone="success" title={withPublishLink(message)} titleRef={flashRef} />
            )}
            {/* "Copy into the form" scrolls up here, so it says what happened here too. */}
            {copiedFrom !== null && dirty && (
              <Notice tone="info" title={`Version ${copiedFrom} is in the form. Save to make it the current one.`} />
            )}
            {!wide && (
              <details className={styles.foldedPreview}>
                <summary>See the preview</summary>
                <div className={styles.previewFrame}>{preview}</div>
              </details>
            )}

            <Section id="basics" title={<>The <em>basics</em></>}>
              <div className={styles.grid2}>
                <TextField
                  path="name"
                  label="Name"
                  value={draft.name}
                  errors={errors}
                  disabled={saving}
                  wide
                  onChange={(value) => update({ name: value })}
                />
                <TextField
                  path="id"
                  label="Id"
                  value={draft.id}
                  errors={errors}
                  disabled={saving}
                  readOnly={!isNew}
                  mono
                  hint={
                    isNew
                      ? "Part of its web address. It can't change after the first save."
                      : "Fixed: links and other milestones use it."
                  }
                  onChange={(value) => {
                    setIdEdited(true);
                    update({ id: value });
                  }}
                />
              </div>
              <div className={styles.grid2}>
                <ChoiceField
                  path="technology"
                  label="Technology"
                  value={draft.technology}
                  options={enumValues("Technology")}
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ technology: value as Technology })}
                />
                <ChoiceField
                  path="stage"
                  label="Stage"
                  value={draft.stage}
                  options={enumValues("Stage")}
                  errors={errors}
                  disabled={saving}
                  hint={stageHint}
                  onChange={(value) => update({ stage: value as Stage })}
                />
                <ChoiceField
                  path="category"
                  label="Category"
                  value={draft.category}
                  options={enumValues("MilestoneCategory")}
                  groups={categoryGroups()}
                  errors={errors}
                  disabled={saving}
                  hint={enumDescription("MilestoneCategory", draft.category)}
                  onChange={(value) => update({ category: value as MilestoneCategory })}
                />
                <ChoiceField
                  path="status"
                  label="Status"
                  value={draft.status}
                  options={enumValues("MilestoneStatus")}
                  errors={errors}
                  disabled={saving}
                  hint={enumDescription("MilestoneStatus", draft.status)}
                  onChange={(value) => update({ status: value as MilestoneStatus })}
                />
                {/* The workbook's confidence in the status (tab 1a), not the team range's confidence. */}
                <ChoiceField
                  path="assessment_confidence"
                  label="Confidence"
                  value={draft.assessment_confidence ?? ""}
                  options={enumValues("Confidence")}
                  emptyLabel="Not set"
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ assessment_confidence: value === "" ? null : (value as Confidence) })}
                />
              </div>
              <div className={styles.grid2}>
                <TextField
                  path="applies_to"
                  label="Applies to"
                  value={draft.applies_to ?? ""}
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ applies_to: value })}
                />
                <TextField
                  path="criterion_met"
                  label="Criterion met?"
                  value={draft.criterion_met ?? ""}
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ criterion_met: value })}
                />
              </div>
              <ClaimEditor
                {...claimProps("status_basis")}
                label="Why it has this status"
                claim={draft.status_basis}
                onChange={(claim) => update({ status_basis: claim })}
              />
              <div className={styles.grid2}>
                <YearInput
                  path="achieved_in"
                  label="Year achieved (optional)"
                  value={draft.achieved_in}
                  onChange={setAchievedIn}
                  errors={errors}
                  disabled={saving}
                  hint="Only once it has happened."
                />
              </div>
              {draft.achieved_in !== null && draft.achieved_in_basis !== null && (
                <ClaimEditor
                  {...claimProps("achieved_in_basis")}
                  label="The source that shows it happened"
                  claim={draft.achieved_in_basis}
                  onChange={(claim) => update({ achieved_in_basis: claim })}
                  sourceOnly
                />
              )}
              <div className={forms.fieldset}>
                <label className={forms.checkRow}>
                  <input
                    id={fieldId("published")}
                    type="checkbox"
                    className={forms.checkbox}
                    checked={draft.published}
                    onChange={(event) => update({ published: event.target.checked })}
                    disabled={saving}
                  />
                  <span>
                    <strong>Published.</strong> It goes on the public site with the next publish.
                  </span>
                </label>
                {messagesAt(errors, "published").length > 0 && (
                  <p className={forms.error}>{messagesAt(errors, "published").join(" ")}</p>
                )}
                <label className={forms.checkRow}>
                  <input
                    type="checkbox"
                    className={forms.checkbox}
                    checked={draft.sample === true}
                    onChange={(event) => update({ sample: event.target.checked })}
                    disabled={saving}
                  />
                  <span>
                    <strong>Sample.</strong> A made-up worked example. Samples never appear on the public site, even
                    when published.
                  </span>
                </label>
              </div>
            </Section>

            <Section
              id="claims"
              title={<>What the site <em>says</em></>}
              note="Every sentence carries where it comes from, so readers can tell a quote from the team's read."
            >
              <ClaimEditor
                {...claimProps("summary")}
                label="Summary"
                claim={draft.summary}
                onChange={(claim) => update({ summary: claim })}
              />
              <ClaimEditor
                {...claimProps("success_criterion")}
                label="What counts as success"
                claim={draft.success_criterion}
                onChange={(claim) => update({ success_criterion: claim })}
              />
              <ClaimEditor
                {...claimProps("main_bottleneck")}
                label="Main bottleneck"
                claim={draft.main_bottleneck}
                onChange={(claim) => update({ main_bottleneck: claim })}
              />
              <div className={styles.grid2}>
                <TextField
                  path="timing"
                  label="Timing (dated sources only)"
                  value={draft.timing ?? ""}
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ timing: value })}
                />
                <TextField
                  path="note"
                  label="Note"
                  value={draft.note ?? ""}
                  errors={errors}
                  disabled={saving}
                  onChange={(value) => update({ note: value })}
                />
                {/* Filled by the workbook import from the evidence cell; shown here, not edited. */}
                <TextField
                  path="evidence_entries"
                  label="Evidence entries"
                  value={(draft.evidence_entries ?? []).join(", ")}
                  errors={errors}
                  disabled={saving}
                  readOnly
                  mono
                  onChange={() => undefined}
                />
              </div>
              <ClaimListEditor
                {...claimProps("would_move_earlier")}
                label="What would bring it earlier"
                itemLabel="Reason"
                hint="At least one. If nobody knows, mark it Unclear and say why."
                claims={draft.would_move_earlier}
                onChange={(claims) => update({ would_move_earlier: claims })}
              />
              <ClaimListEditor
                {...claimProps("would_move_later")}
                label="What would push it later"
                itemLabel="Reason"
                hint="At least one. If nobody knows, mark it Unclear and say why."
                claims={draft.would_move_later}
                onChange={(claims) => update({ would_move_later: claims })}
              />
              <ClaimListEditor
                {...claimProps("artificial_minds_questions")}
                label="Questions about artificial minds"
                itemLabel="Question"
                hint="Optional. What this milestone would mean for minds the technology could create."
                claims={draft.artificial_minds_questions}
                onChange={(claims) => update({ artificial_minds_questions: claims })}
              />
            </Section>

            <Section
              id="estimate"
              title={<>The team&rsquo;s <em>range</em></>}
              note="Optional. When there is one, the timeline draws it, and every forecast stays visible next to it."
            >
              <label className={forms.checkRow}>
                <input
                  type="checkbox"
                  className={forms.checkbox}
                  checked={draft.estimate !== null}
                  onChange={(event) => setHasEstimate(event.target.checked)}
                  disabled={saving}
                />
                <span>The team has its own range for this milestone.</span>
              </label>
              {draft.estimate !== null && (
                <EstimateFields
                  draft={draft}
                  errors={errors}
                  disabled={saving}
                  claimProps={claimProps("estimate.basis")}
                  onChange={update}
                />
              )}
            </Section>

            <Section id="links" title={<>Links</>}>
              <MultiPicker
                id={fieldId("depends_on")}
                label="Depends on"
                hint="Milestones that have to happen before this one."
                options={milestoneOptions(others, draft.sample === true, draft.depends_on)}
                chosen={draft.depends_on}
                onChange={(next) => update({ depends_on: next })}
                disabled={saving}
                errors={messagesAt(errors, "depends_on")}
                emptyText="Nothing. It doesn't wait on another milestone."
              />
              <MultiPicker
                id={fieldId("source_ids")}
                label="Sources"
                hint="Every source this milestone draws on. The dossier lists them."
                options={sources}
                chosen={draft.source_ids}
                onChange={(next) => update({ source_ids: next })}
                disabled={saving}
                errors={messagesAt(errors, "source_ids")}
                emptyText="None yet."
              />
            </Section>

            <Section
              id="forecasts"
              title={<>Published <em>forecasts</em></>}
              note="Each forecast as the forecaster stated it, with their exact words. The site shows them one by one and never averages them."
            >
              <ForecastEditor
                forecasts={draft.forecasts}
                onChange={(forecasts) => update({ forecasts })}
                errors={errors}
                sources={sources}
                disabled={saving}
              />
            </Section>

            {(savedFirst || problems.length > 0 || (saveError && !savedFirst)) && (
              <div ref={noticesRef} className={styles.saveNotices}>
                {savedFirst && (
                  <ConflictNotice
                    savedFirst={savedFirst}
                    onLoadTheirs={loadTheirs}
                    onSaveMine={() => void saveOver()}
                    hasHistory
                    titleRef={resultRef}
                  />
                )}
                {problems.length > 0 && (
                  <Notice
                    tone="error"
                    title={problems.length === 1 ? "One thing to fix before saving." : `${problems.length} things to fix before saving.`}
                  >
                    <ul className={styles.problemList}>
                      {problems.map(([path, text]) => (
                        <li key={path}>
                          <button type="button" className={forms.linkButton} onClick={() => focusField(path)}>
                            {pathLabel(path)}
                          </button>
                          : {text}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                )}
                {saveError && !savedFirst && (
                  <ApiErrorNotice error={saveError} title="The milestone wasn't saved" titleRef={resultRef} />
                )}
              </div>
            )}
            <div
              ref={saveRowRef}
              className={`${styles.saveBar} ${styles.saveRow} ${stickySave ? styles.stickySave : ""}`}
            >
              {message && !dirty && !messageAtTop && (
                <Notice tone="success" title={withPublishLink(message)} titleRef={resultRef} />
              )}
              <div className={forms.actions}>
                <button
                  type="button"
                  className={`btn btn-primary ${forms.button}`}
                  onClick={() => void save()}
                  disabled={saving || (!dirty && !isNew)}
                >
                  {saving ? "Saving…" : isNew ? "Save the milestone" : "Save changes"}
                </button>
                {dirty && !isNew && (
                  <button type="button" className={forms.linkButton} onClick={discard} disabled={saving}>
                    Discard changes
                  </button>
                )}
                {!dirty && !isNew && (!message || messageAtTop) && (
                  <span ref={noChangesRef} tabIndex={-1} className={styles.savedLine}>
                    No unsaved changes.
                  </span>
                )}
              </div>
            </div>
            {record && (
              <p className={styles.savedLine}>
                Version {record.version}, saved {formatDateTime(record.updated_at)}
                {record.updated_by ? ` by ${record.updated_by}` : ""}.
              </p>
            )}

            {record && (
              <History
                revisions={revisions.data}
                error={revisions.error}
                currentVersion={record.version}
                onRetry={revisions.reload}
                onCopy={copyRevision}
                disabled={saving}
              />
            )}
          </form>

          {wide && (
            <section className={styles.previewColumn} aria-labelledby="milestone-preview-heading">
              <div className={styles.previewHead}>
                <h2 id="milestone-preview-heading" className={styles.previewLabel}>
                  Preview
                </h2>
                <span className={styles.muted}>The timeline&rsquo;s dossier, as you edit</span>
              </div>
              <div className={styles.previewFrame}>{preview}</div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// Tabbing to a field near the bottom of the screen scrolls it clear of the
// sticky save row (scroll-padding-bottom in Editor.module.css). A saved
// notice makes the row about twice as tall, so the row is measured and its
// height handed to the CSS as --save-row-height while it sticks.
function useSaveRowHeight(row: RefObject<HTMLDivElement | null>, sticky: boolean): void {
  useEffect(() => {
    const element = row.current;
    if (!sticky || element === null) {
      return;
    }
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--save-row-height", `${element.offsetHeight}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--save-row-height");
    };
  }, [row, sticky]);
}

// ---------- Pieces of the form ----------

function Section({ id, title, note, children }: { id: string; title: ReactNode; note?: string; children: ReactNode }) {
  return (
    <section className={`paper ${styles.section}`} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHead}>
        <h2 id={`${id}-heading`} className={styles.sectionTitle}>
          {title}
        </h2>
        {note && <p className={styles.muted}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

interface TextFieldProps {
  path: string;
  label: string;
  value: string;
  errors: MilestoneErrors;
  disabled: boolean;
  onChange: (value: string) => void;
  hint?: string;
  readOnly?: boolean;
  mono?: boolean;
  // Across both columns of the grid, for text that runs long (a name).
  wide?: boolean;
}

function TextField({
  path,
  label,
  value,
  errors,
  disabled,
  onChange,
  hint,
  readOnly = false,
  mono = false,
  wide = false,
}: TextFieldProps) {
  const id = fieldId(path);
  const messages = messagesAt(errors, path);
  const describedBy: string[] = [];
  if (hint) {
    describedBy.push(`${id}-hint`);
  }
  if (messages.length > 0) {
    describedBy.push(`${id}-error`);
  }
  return (
    <div className={`${forms.field} ${wide ? styles.spanAll : ""}`}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <input
        id={id}
        className={`${forms.input} ${messages.length > 0 ? forms.invalid : ""} ${mono ? styles.idCell : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={mono ? false : undefined}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className={forms.hint}>
          {hint}
        </p>
      )}
      {messages.length > 0 && (
        <p id={`${id}-error`} className={forms.error}>
          {messages.join(" ")}
        </p>
      )}
    </div>
  );
}

interface ChoiceFieldProps {
  path: string;
  label: string;
  value: string;
  options: ChoiceOption[];
  // For an optional choice: a first option with value "" meaning none.
  emptyLabel?: string;
  // Lists the options under these headings (native optgroups). Any option
  // no group lists comes after them (optionsInNoGroup).
  groups?: ChoiceGroup[];
  // The API can still refuse a choice, e.g. a category this page offers
  // before the API is updated to accept it. Its message shows here too.
  errors: MilestoneErrors;
  disabled: boolean;
  onChange: (value: string) => void;
  hint?: string;
}

function ChoiceField({ path, label, value, options, emptyLabel, groups, errors, disabled, onChange, hint }: ChoiceFieldProps) {
  const id = fieldId(path);
  const loose = groups ? optionsInNoGroup(options, groups) : options;
  const messages = messagesAt(errors, path);
  const describedBy: string[] = [];
  if (hint) {
    describedBy.push(`${id}-hint`);
  }
  if (messages.length > 0) {
    describedBy.push(`${id}-error`);
  }
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <select
        id={id}
        className={`${forms.select} ${messages.length > 0 ? forms.invalid : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={messages.length > 0 ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
        {loose.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className={forms.hint}>
          {hint}
        </p>
      )}
      {messages.length > 0 && (
        <p id={`${id}-error`} className={forms.error}>
          {messages.join(" ")}
        </p>
      )}
    </div>
  );
}

interface EstimateFieldsProps {
  draft: MilestoneDraft;
  errors: MilestoneErrors;
  disabled: boolean;
  claimProps: { path: string; errors: MilestoneErrors; sources: PickerOption[]; disabled: boolean; reviewerName: string };
  onChange: (patch: Partial<MilestoneDraft>) => void;
}

function EstimateFields({ draft, errors, disabled, claimProps, onChange }: EstimateFieldsProps) {
  const estimate = draft.estimate;
  if (estimate === null) {
    return null;
  }
  const confidenceId = fieldId("confidence");
  const confidenceMessages = messagesAt(errors, "confidence");

  function setBasis(basis: Claim) {
    if (estimate !== null) {
      onChange({ estimate: { ...estimate, basis } });
    }
  }

  return (
    <>
      <div className={styles.grid3}>
        <YearInput
          path="estimate.earliest"
          label="Earliest year"
          value={estimate.earliest}
          onChange={(value) => onChange({ estimate: { ...estimate, earliest: value } })}
          errors={errors}
          disabled={disabled}
        />
        <YearInput
          path="estimate.latest"
          label="Latest year (optional)"
          value={estimate.latest}
          onChange={(value) => onChange({ estimate: { ...estimate, latest: value } })}
          errors={errors}
          disabled={disabled}
          hint="Empty if the range has no end."
        />
        <div className={forms.field}>
          <label htmlFor={confidenceId} className={forms.label}>
            Confidence
          </label>
          <select
            id={confidenceId}
            className={`${forms.select} ${confidenceMessages.length > 0 ? forms.invalid : ""}`}
            value={draft.confidence ?? ""}
            onChange={(event) =>
              onChange({ confidence: event.target.value === "" ? null : (event.target.value as Confidence) })
            }
            disabled={disabled}
            aria-invalid={confidenceMessages.length > 0 ? true : undefined}
            // Linked to its error, as every other field is, so a screen reader says why it's invalid.
            aria-describedby={confidenceMessages.length > 0 ? `${confidenceId}-error` : undefined}
          >
            <option value="">Pick one</option>
            {enumValues("Confidence").map((info) => (
              <option key={info.value} value={info.value}>
                {info.label}
              </option>
            ))}
          </select>
          {confidenceMessages.length > 0 && (
            <p id={`${confidenceId}-error`} className={forms.error}>
              {confidenceMessages.join(" ")}
            </p>
          )}
        </div>
      </div>
      <ClaimEditor {...claimProps} label="What the range is based on" claim={estimate.basis} onChange={setBasis} />
      <p className={styles.savedLine}>
        {estimate.set_by
          ? `Set by ${estimate.set_by} on ${formatDay(`${estimate.set_on}T12:00:00`)}. Changing the range or its basis signs it with your name.`
          : "Saving signs the range with your name and today's date."}
      </p>
    </>
  );
}

interface HistoryProps {
  revisions: MilestoneRevision[] | null;
  error: ApiError | null;
  currentVersion: number;
  onRetry: () => void;
  onCopy: (revision: MilestoneRevision) => void;
  disabled: boolean;
}

// Every saved version, newest first. Nothing is ever overwritten for good.
function History({ revisions, error, currentVersion, onRetry, onCopy, disabled }: HistoryProps) {
  return (
    <section className={`paper ${styles.section}`} aria-labelledby="history-heading">
      <div className={styles.sectionHead}>
        <h2 id="history-heading" className={styles.sectionTitle}>
          History
        </h2>
        <p className={styles.muted}>Every saved version is kept. Copy an older one into the form to bring it back.</p>
      </div>
      {error && <ApiErrorNotice error={error} title="Couldn't load the history" onRetry={onRetry} />}
      {!error && !revisions && <p className={styles.muted}>Loading&hellip;</p>}
      {revisions && revisions.length === 0 && <p className={styles.muted}>No saved versions yet.</p>}
      {revisions && revisions.length > 0 && (
        <ol className={styles.history}>
          {revisions.map((revision) => (
            <li key={revision.version} className={styles.historyItem}>
              <span>
                <span className={styles.historyVersion}>Version {revision.version}</span>{" "}
                {formatDateTime(revision.updated_at)}
                {revision.updated_by ? `, ${revision.updated_by}` : ""}
                {revision.published ? ", published" : ", draft"}
              </span>
              {revision.version === currentVersion ? (
                <span className={styles.muted}>The current version</span>
              ) : (
                revision.milestone && (
                  <button
                    type="button"
                    className={forms.linkButton}
                    onClick={() => onCopy(revision)}
                    disabled={disabled}
                  >
                    Copy into the form
                  </button>
                )
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
