"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

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
  Milestone,
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
  blankClaim,
  blankMilestone,
  fieldId,
  focusField,
  messagesAt,
  milestoneProblems,
  pathLabel,
  toDraft,
  toMilestone,
  type MilestoneDraft,
  type MilestoneErrors,
} from "./milestoneModel";
import { MilestonePreview } from "./MilestonePreview";
import { ApiErrorNotice, Notice } from "./Notice";
import { MultiPicker, sourceOptions, type PickerOption } from "./Pickers";
import { useUnsavedWork } from "./unsavedWork";
import { useApiData } from "./useApiData";
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

  const others: Milestone[] = [];
  for (const item of all.data ?? []) {
    if (item.milestone.id !== id) {
      others.push(item.milestone);
    }
  }

  // "Load their version" after a conflict brings a newer version, which
  // remounts the form with it.
  return (
    <MilestoneForm
      key={record.data ? record.data.version : "new"}
      initial={record.data}
      others={others}
      catalog={catalog.data ?? []}
      flash={flash}
      onReload={record.reload}
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

// Other milestones as picker options, grouped by technology.
function milestoneOptions(others: Milestone[]): PickerOption[] {
  const options: PickerOption[] = [];
  for (const milestone of others) {
    const sample = milestone.sample ? " (sample)" : "";
    options.push({
      value: milestone.id,
      label: `${milestone.name || milestone.id}${sample}`,
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
  others: Milestone[];
  catalog: CatalogSource[];
  flash: string | null;
  onReload: () => void;
}

function MilestoneForm({ initial, others, catalog, flash, onReload }: MilestoneFormProps) {
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
  const [errors, setErrors] = useState<MilestoneErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(flash);
  const revisions = useApiData(record ? `milestone-revisions:${record.milestone.id}:${record.version}` : null, () =>
    getMilestoneRevisions(record ? record.milestone.id : ""),
  );

  const dirty = JSON.stringify(draft) !== baseline;
  useUnsavedWork(dirty);
  const savedFirst = savedFirstFrom(saveError);
  const sources = sourceOptions(catalog);
  const isNew = record === null;

  function update(patch: Partial<MilestoneDraft>) {
    setDraft((previous) => {
      const next = { ...previous, ...patch };
      if (patch.name !== undefined && !idEdited) {
        next.id = slugify(patch.name);
      }
      return next;
    });
    setMessage(null);
  }

  function claimProps(path: string) {
    return { path, errors, sources, disabled: saving, reviewerName: editorName };
  }

  function placeApiErrors(apiError: ApiError) {
    const mapped: MilestoneErrors = {};
    for (const item of fieldErrorsFrom(apiError)) {
      const path = withoutPrefix(item.path, "milestone");
      // Two problems on one field read as one sentence each.
      mapped[path] = mapped[path] ? `${mapped[path]} ${item.message}` : item.message;
    }
    setErrors(mapped);
    const first = Object.keys(mapped)[0];
    if (first !== undefined) {
      focusField(first);
    } else {
      setSaveError(apiError);
    }
  }

  async function save(overVersion: number | null = null) {
    const found = milestoneProblems(draft);
    setErrors(found);
    setSaveError(null);
    setMessage(null);
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
      setMessage(savedMessage(next));
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.status === 409 && apiError.code === "id_taken") {
        setErrors({ id: "Another milestone already has this id. Pick another." });
        focusField("id");
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
  }

  function copyRevision(revision: MilestoneRevision) {
    if (!revision.milestone) {
      return;
    }
    setDraft(toDraft(revision.milestone, revision.published));
    setErrors({});
    setMessage(`Version ${revision.version} is in the form. Save to make it the current one.`);
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
    if (on) {
      update({ estimate: { earliest: null, latest: null, basis: blankClaim(), set_by: "", set_on: "" } });
    } else {
      update({ estimate: null, confidence: null });
    }
  }

  const problems = Object.entries(errors);
  const wide = useWideScreen();
  const preview = (
    <MilestonePreview
      milestone={toMilestone(draft, { estimateChanged: false, editor: editorName, today: todayIso() })}
      others={others}
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
      />
      <div className={`container ${styles.listPage}`}>
        <div className={styles.split}>
          <form className={styles.formColumn} onSubmit={(event) => event.preventDefault()} noValidate>
            {/* After the first save the page reloads at the top, so it says so here too. */}
            {message !== null && message === flash && !dirty && <Notice tone="success" title={message} />}
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
                  disabled={saving}
                  onChange={(value) => update({ technology: value as Technology })}
                />
                <ChoiceField
                  path="stage"
                  label="Stage"
                  value={draft.stage}
                  options={enumValues("Stage")}
                  disabled={saving}
                  hint={stageHint}
                  onChange={(value) => update({ stage: value as Stage })}
                />
                <ChoiceField
                  path="category"
                  label="Category"
                  value={draft.category}
                  options={enumValues("MilestoneCategory")}
                  disabled={saving}
                  onChange={(value) => update({ category: value as MilestoneCategory })}
                />
                <ChoiceField
                  path="status"
                  label="Status"
                  value={draft.status}
                  options={enumValues("MilestoneStatus")}
                  disabled={saving}
                  hint={enumDescription("MilestoneStatus", draft.status)}
                  onChange={(value) => update({ status: value as MilestoneStatus })}
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
                options={milestoneOptions(others)}
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

            <div className={styles.saveBar}>
              {savedFirst && (
                <ConflictNotice savedFirst={savedFirst} onLoadTheirs={onReload} onSaveMine={() => void saveOver()} />
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
              {saveError && !savedFirst && <ApiErrorNotice error={saveError} title="The milestone wasn't saved" />}
              {message && !dirty && <Notice tone="success" title={message} />}
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
                {!dirty && !isNew && !message && <span className={styles.savedLine}>No unsaved changes.</span>}
              </div>
              {record && (
                <p className={styles.savedLine}>
                  Version {record.version}, saved {formatDateTime(record.updated_at)}
                  {record.updated_by ? ` by ${record.updated_by}` : ""}.
                </p>
              )}
            </div>

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
}

function TextField({ path, label, value, errors, disabled, onChange, hint, readOnly = false, mono = false }: TextFieldProps) {
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
    <div className={forms.field}>
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
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
  hint?: string;
}

function ChoiceField({ path, label, value, options, disabled, onChange, hint }: ChoiceFieldProps) {
  const id = fieldId(path);
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <select
        id={id}
        className={forms.select}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {options.map((option) => (
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
          <label htmlFor={fieldId("confidence")} className={forms.label}>
            Confidence
          </label>
          <select
            id={fieldId("confidence")}
            className={`${forms.select} ${confidenceMessages.length > 0 ? forms.invalid : ""}`}
            value={draft.confidence ?? ""}
            onChange={(event) =>
              onChange({ confidence: event.target.value === "" ? null : (event.target.value as Confidence) })
            }
            disabled={disabled}
            aria-invalid={confidenceMessages.length > 0 ? true : undefined}
          >
            <option value="">Pick one</option>
            {enumValues("Confidence").map((info) => (
              <option key={info.value} value={info.value}>
                {info.label}
              </option>
            ))}
          </select>
          {confidenceMessages.length > 0 && <p className={forms.error}>{confidenceMessages.join(" ")}</p>}
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
