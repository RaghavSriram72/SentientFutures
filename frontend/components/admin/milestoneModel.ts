// The milestone editor's data, kept apart from the screen so the rules are
// easy to read and test (tests/milestoneModel.test.ts).
//
// The form edits a MilestoneDraft: the public Milestone with the years that
// can be half typed allowed to be null, plus the published flag. toMilestone()
// turns it back into exactly what the API and the public site expect.
import type { CatalogSource } from "@/lib/adminTypes";
import type { Claim, Forecast, Milestone } from "@/lib/types";

import { hasLongDash, isSlug, LONG_DASH_FIX } from "./editorModel";

export interface EstimateDraft {
  earliest: number | null;
  latest: number | null;
  basis: Claim;
  set_by: string;
  set_on: string;
}

export interface ForecastDraft extends Omit<Forecast, "made_in"> {
  made_in: number | null;
}

export interface MilestoneDraft extends Omit<Milestone, "estimate" | "forecasts"> {
  estimate: EstimateDraft | null;
  forecasts: ForecastDraft[];
  published: boolean;
}

// Field path ("forecasts.0.quote", as the API's problems name them) -> message.
export type MilestoneErrors = Record<string, string>;

// The same limits as shared/sf_shared/models.py.
export const MAX_QUOTE_LENGTH = 300;
const EVENT_YEARS = { min: 1950, max: 2100 };
const WINDOW_YEARS = { min: 1900, max: 3000 };

export function blankClaim(): Claim {
  return { text: "", provenance: "team", source_ids: [] };
}

export function blankForecast(id: string): ForecastDraft {
  return {
    id,
    source_id: "",
    forecaster: "",
    claim: "",
    quote: "",
    quote_location: null,
    made_in: null,
    earliest: null,
    latest: null,
    never: false,
  };
}

// A new milestone. would_move_earlier and would_move_later need an entry
// each, so they start with an empty one to fill in.
export function blankMilestone(): MilestoneDraft {
  return {
    id: "",
    name: "",
    technology: "wbe",
    stage: "possible",
    category: "technical_capability",
    status: "not_demonstrated",
    status_basis: blankClaim(),
    achieved_in: null,
    achieved_in_basis: null,
    confidence: null,
    summary: blankClaim(),
    success_criterion: blankClaim(),
    main_bottleneck: blankClaim(),
    depends_on: [],
    source_ids: [],
    estimate: null,
    forecasts: [],
    disagreement_override: null,
    disagreement_note: null,
    would_move_earlier: [blankClaim()],
    would_move_later: [blankClaim()],
    artificial_minds_questions: [],
    published: false,
  };
}

export function toDraft(milestone: Milestone, published: boolean): MilestoneDraft {
  return {
    ...milestone,
    estimate: milestone.estimate ? { ...milestone.estimate } : null,
    forecasts: milestone.forecasts.map((forecast) => ({ ...forecast })),
    published,
  };
}

// The smallest "forecast-N" this milestone doesn't use yet.
export function nextForecastId(forecasts: ForecastDraft[]): string {
  let number = forecasts.length + 1;
  for (;;) {
    const id = `forecast-${number}`;
    if (!forecasts.some((forecast) => forecast.id === id)) {
      return id;
    }
    number += 1;
  }
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  return value.trim();
}

// A claim with only the fields its provenance uses. The model refuses a note
// outside "unclear / other", and a quote means nothing without a source.
export function tidyClaim(claim: Claim): Claim {
  const tidy: Claim = { text: claim.text.trim(), provenance: claim.provenance, source_ids: [] };
  if (claim.provenance !== "unclear") {
    tidy.source_ids = [...(claim.source_ids ?? [])];
  }
  if (claim.provenance === "source") {
    tidy.quote = trimmedOrNull(claim.quote);
    tidy.quote_location = trimmedOrNull(claim.quote_location);
  }
  if (claim.provenance === "unclear") {
    tidy.unclear_reason = claim.unclear_reason ?? null;
    if (claim.unclear_reason === "other") {
      tidy.unclear_note = trimmedOrNull(claim.unclear_note);
    }
  }
  if (claim.provenance === "ai") {
    tidy.reviewed_by = trimmedOrNull(claim.reviewed_by);
  }
  return tidy;
}

function tidyClaims(claims: Claim[]): Claim[] {
  return claims.map(tidyClaim);
}

// What gets saved. `editor` and `today` fill in the team range's set_by and
// set_on when the range is new or changed (estimateChanged).
export function toMilestone(
  draft: MilestoneDraft,
  options: { estimateChanged: boolean; editor: string; today: string },
): Milestone {
  let estimate: Milestone["estimate"] = null;
  if (draft.estimate !== null && draft.estimate.earliest !== null) {
    const changed = options.estimateChanged || draft.estimate.set_by.trim() === "";
    estimate = {
      earliest: draft.estimate.earliest,
      latest: draft.estimate.latest,
      basis: tidyClaim(draft.estimate.basis),
      set_by: changed ? options.editor : draft.estimate.set_by,
      set_on: changed ? options.today : draft.estimate.set_on,
    };
  }
  const forecasts: Forecast[] = [];
  for (const forecast of draft.forecasts) {
    forecasts.push({
      id: forecast.id,
      source_id: forecast.source_id,
      forecaster: forecast.forecaster.trim(),
      claim: forecast.claim.trim(),
      quote: forecast.quote.trim(),
      quote_location: trimmedOrNull(forecast.quote_location),
      made_in: forecast.made_in ?? 0,
      earliest: forecast.never ? null : forecast.earliest,
      latest: forecast.never ? null : forecast.latest,
      never: forecast.never,
    });
  }
  const milestone: Milestone = {
    id: draft.id.trim(),
    name: draft.name.trim(),
    technology: draft.technology,
    stage: draft.stage,
    category: draft.category,
    status: draft.status,
    status_basis: tidyClaim(draft.status_basis),
    achieved_in: draft.achieved_in,
    achieved_in_basis: draft.achieved_in === null || !draft.achieved_in_basis ? null : tidyClaim(draft.achieved_in_basis),
    // Confidence describes the team range, so it goes with it.
    confidence: estimate === null ? null : draft.confidence,
    summary: tidyClaim(draft.summary),
    success_criterion: tidyClaim(draft.success_criterion),
    main_bottleneck: tidyClaim(draft.main_bottleneck),
    depends_on: [...draft.depends_on],
    source_ids: [...draft.source_ids],
    estimate,
    forecasts,
    disagreement_override: draft.disagreement_override,
    disagreement_note: draft.disagreement_note ? tidyClaim(draft.disagreement_note) : null,
    would_move_earlier: tidyClaims(draft.would_move_earlier),
    would_move_later: tidyClaims(draft.would_move_later),
    artificial_minds_questions: tidyClaims(draft.artificial_minds_questions),
  };
  if (draft.sample) {
    milestone.sample = true;
  }
  return milestone;
}

// ---------- Checking before saving ----------
// The API runs the full rules (dependency cycles, the source catalog) and its
// problems land on the same paths. These catch the common ones next to the
// field, before a round trip.

function checkClaim(claim: Claim, path: string, sample: boolean, errors: MilestoneErrors): void {
  if (claim.text.trim() === "") {
    errors[`${path}.text`] = "Write the text.";
  }
  if (claim.provenance === "source") {
    if ((claim.source_ids ?? []).length === 0) {
      errors[`${path}.source_ids`] = "Pick the source it comes from.";
    }
    const quote = (claim.quote ?? "").trim();
    if (quote === "") {
      errors[`${path}.quote`] = "Paste the exact words from the source.";
    } else if (quote.length > MAX_QUOTE_LENGTH) {
      errors[`${path}.quote`] = `The quote is ${quote.length} characters. Keep it to ${MAX_QUOTE_LENGTH} or fewer.`;
    }
  }
  if (claim.provenance === "unclear") {
    if (!claim.unclear_reason) {
      errors[`${path}.unclear_reason`] = "Say why it's unclear.";
    } else if (claim.unclear_reason === "other" && (claim.unclear_note ?? "").trim() === "") {
      errors[`${path}.unclear_note`] = "Explain the reason in a few words.";
    }
  }
  // Only a sample can show AI text nobody has checked.
  if (claim.provenance === "ai" && !sample && (claim.reviewed_by ?? "").trim() === "") {
    errors[`${path}.reviewed_by`] = "Someone on the team has to check AI text before it can go public.";
  }
}

function checkYear(value: number | null, path: string, range: { min: number; max: number }, errors: MilestoneErrors) {
  if (value === null) {
    return;
  }
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    errors[path] = `Use a year from ${range.min} to ${range.max}.`;
  }
}

function checkLongDashes(value: unknown, path: string, errors: MilestoneErrors): void {
  if (typeof value === "string") {
    if (hasLongDash(value) && !errors[path]) {
      errors[path] = `Has a long dash. ${LONG_DASH_FIX}`;
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkLongDashes(item, path === "" ? String(index) : `${path}.${index}`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      checkLongDashes(item, path === "" ? key : `${path}.${key}`, errors);
    }
  }
}

export function milestoneProblems(draft: MilestoneDraft): MilestoneErrors {
  const errors: MilestoneErrors = {};
  const sample = draft.sample === true;

  const id = draft.id.trim();
  if (id === "") {
    errors.id = "Give the milestone an id.";
  } else if (!isSlug(id)) {
    errors.id = "Use lowercase letters, numbers and single hyphens, like wbe-fly-connectome.";
  }
  if (draft.name.trim() === "") {
    errors.name = "Give the milestone a name.";
  }

  checkClaim(draft.status_basis, "status_basis", sample, errors);
  checkClaim(draft.summary, "summary", sample, errors);
  checkClaim(draft.success_criterion, "success_criterion", sample, errors);
  checkClaim(draft.main_bottleneck, "main_bottleneck", sample, errors);

  checkYear(draft.achieved_in, "achieved_in", EVENT_YEARS, errors);
  if (draft.achieved_in !== null) {
    if (!draft.achieved_in_basis) {
      errors["achieved_in_basis.text"] = "Cite the source that shows it happened.";
    } else {
      checkClaim(draft.achieved_in_basis, "achieved_in_basis", sample, errors);
      if (draft.achieved_in_basis.provenance !== "source") {
        errors["achieved_in_basis.provenance"] = "Saying it happened needs a quote from a source.";
      }
    }
  }

  if (draft.estimate !== null) {
    const estimate = draft.estimate;
    if (estimate.earliest === null) {
      errors["estimate.earliest"] = "Give the earliest year of the range.";
    }
    checkYear(estimate.earliest, "estimate.earliest", WINDOW_YEARS, errors);
    checkYear(estimate.latest, "estimate.latest", WINDOW_YEARS, errors);
    if (estimate.earliest !== null && estimate.latest !== null && estimate.latest < estimate.earliest) {
      errors["estimate.latest"] = `The latest year is before the earliest (${estimate.earliest}).`;
    }
    checkClaim(estimate.basis, "estimate.basis", sample, errors);
    if (draft.confidence === null) {
      errors.confidence = "Say how confident the team is in this range.";
    }
  }

  if (draft.would_move_earlier.length === 0) {
    errors.would_move_earlier = "Add at least one. If nothing is known, mark it Unclear and say why.";
  }
  if (draft.would_move_later.length === 0) {
    errors.would_move_later = "Add at least one. If nothing is known, mark it Unclear and say why.";
  }
  draft.would_move_earlier.forEach((claim, index) => checkClaim(claim, `would_move_earlier.${index}`, sample, errors));
  draft.would_move_later.forEach((claim, index) => checkClaim(claim, `would_move_later.${index}`, sample, errors));
  draft.artificial_minds_questions.forEach((claim, index) =>
    checkClaim(claim, `artificial_minds_questions.${index}`, sample, errors),
  );

  draft.forecasts.forEach((forecast, index) => {
    const path = `forecasts.${index}`;
    if (forecast.source_id === "") {
      errors[`${path}.source_id`] = "Pick the source the forecast comes from.";
    }
    if (forecast.forecaster.trim() === "") {
      errors[`${path}.forecaster`] = "Say who made the forecast.";
    }
    if (forecast.claim.trim() === "") {
      errors[`${path}.claim`] = "Say what they forecast, in a sentence.";
    }
    const quote = forecast.quote.trim();
    if (quote === "") {
      errors[`${path}.quote`] = "Paste the exact words from the source.";
    } else if (quote.length > MAX_QUOTE_LENGTH) {
      errors[`${path}.quote`] = `The quote is ${quote.length} characters. Keep it to ${MAX_QUOTE_LENGTH} or fewer.`;
    }
    if (forecast.made_in === null) {
      errors[`${path}.made_in`] = "Give the year the forecast was made.";
    }
    checkYear(forecast.made_in, `${path}.made_in`, EVENT_YEARS, errors);
    if (!forecast.never) {
      if (forecast.earliest === null && forecast.latest === null) {
        errors[`${path}.earliest`] = "Give at least one year, or tick Never.";
      }
      checkYear(forecast.earliest, `${path}.earliest`, WINDOW_YEARS, errors);
      checkYear(forecast.latest, `${path}.latest`, WINDOW_YEARS, errors);
      if (forecast.earliest !== null && forecast.latest !== null && forecast.latest < forecast.earliest) {
        errors[`${path}.latest`] = `The latest year is before the earliest (${forecast.earliest}).`;
      }
    }
  });

  checkLongDashes(
    {
      name: draft.name,
      status_basis: draft.status_basis,
      summary: draft.summary,
      success_criterion: draft.success_criterion,
      main_bottleneck: draft.main_bottleneck,
      achieved_in_basis: draft.achieved_in_basis,
      estimate: draft.estimate ? { basis: draft.estimate.basis } : null,
      forecasts: draft.forecasts,
      would_move_earlier: draft.would_move_earlier,
      would_move_later: draft.would_move_later,
      artificial_minds_questions: draft.artificial_minds_questions,
    },
    "",
    errors,
  );
  return errors;
}

// ---------- Field paths, ids and labels ----------

// The input id for a field path, so a problem in the list can move focus to it.
export function fieldId(path: string): string {
  return `ms-${path.replace(/\./g, "-")}`;
}

// The input for a path, or the nearest one above it ("summary.source_ids.0"
// -> the summary's source picker).
export function focusField(path: string): void {
  const parts = path.split(".");
  while (parts.length > 0) {
    const element = document.getElementById(fieldId(parts.join(".")));
    if (element) {
      element.focus();
      element.scrollIntoView({ block: "center" });
      return;
    }
    parts.pop();
  }
}

// The messages for a path and anything under it, e.g. "summary.source_ids"
// also picks up "summary.source_ids.0" from the API.
export function messagesAt(errors: MilestoneErrors, path: string): string[] {
  const found: string[] = [];
  for (const [key, message] of Object.entries(errors)) {
    if (key === path || key.startsWith(`${path}.`)) {
      found.push(message);
    }
  }
  return found;
}

const PART_LABELS: Record<string, string> = {
  id: "Id",
  name: "Name",
  published: "Published",
  status_basis: "Why it has this status",
  summary: "Summary",
  success_criterion: "What counts as success",
  main_bottleneck: "Main bottleneck",
  achieved_in: "Year achieved",
  achieved_in_basis: "Source for the year achieved",
  confidence: "Confidence",
  estimate: "Team range",
  would_move_earlier: "What would bring it earlier",
  would_move_later: "What would push it later",
  artificial_minds_questions: "Questions about artificial minds",
  depends_on: "Depends on",
  source_ids: "sources",
  forecasts: "Forecast",
  text: "text",
  provenance: "where it comes from",
  quote: "quote",
  quote_location: "where in the source",
  unclear_reason: "reason",
  unclear_note: "note",
  reviewed_by: "checked by",
  basis: "basis",
  earliest: "earliest year",
  latest: "latest year",
  source_id: "source",
  forecaster: "forecaster",
  claim: "forecast",
  made_in: "year made",
  never: "never",
};

// "forecasts.0.quote" -> "Forecast 1, quote"
export function pathLabel(path: string): string {
  if (path === "") {
    return "The milestone";
  }
  const words: string[] = [];
  for (const part of path.split(".")) {
    if (/^\d+$/.test(part)) {
      if (words.length > 0) {
        words[words.length - 1] = `${words[words.length - 1]} ${Number(part) + 1}`;
      }
      continue;
    }
    words.push(PART_LABELS[part] ?? part.replace(/_/g, " "));
  }
  return words.join(", ");
}

// ---------- Pickers ----------

// "Shulman & Bostrom 2021: Sharing the World with Digital Minds"
export function catalogLabel(source: CatalogSource): string {
  const parts: string[] = [];
  if (source.register_id) {
    parts.push(source.register_id);
  }
  const lastNames: string[] = [];
  for (const author of source.authors) {
    lastNames.push(author.trim().split(/\s+/).pop() ?? author);
  }
  let who = lastNames.join(" & ");
  if (lastNames.length > 2) {
    who = `${lastNames[0]} et al.`;
  }
  const cite = [who, source.year ? String(source.year) : ""].filter((part) => part !== "").join(" ");
  if (cite !== "") {
    parts.push(cite);
  }
  const head = parts.join(" · ");
  const title = source.title.length > 70 ? `${source.title.slice(0, 67)}...` : source.title;
  return head === "" ? title : `${head}: ${title}`;
}
