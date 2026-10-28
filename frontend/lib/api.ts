// The admin pages' only way to talk to the Flask API. Every call goes through
// request(), which adds the Bearer token, turns error bodies into ApiError, and
// signs the person out when the API says the token is no longer good (401).
import type {
  AdminPost,
  AdminUser,
  AiAssessment,
  AiRelevantGroup,
  AuthResult,
  Candidate,
  CatalogSource,
  DecisionCounts,
  DuplicateSource,
  FieldStats,
  HealthResponse,
  MilestoneRecord,
  MilestoneRevision,
  MilestoneSaveRequest,
  NewSourceRequest,
  PipelineRun,
  PipelineStatus,
  PostInput,
  PostSaveRequest,
  PostStatus,
  PromptVersionStats,
  PublishResult,
  PublishStatus,
  SitePublish,
  QueueFilters,
  QueueItem,
  QueueItemDetail,
  QueuePage,
  Review,
  ReviewField,
  ReviewRequest,
  ReviewResult,
  ReviewStats,
  SearchConfig,
  SearchConfigInput,
  StartRunRequest,
  StatsValue,
  ValuePair,
} from "./adminTypes";
import { clearSession, getToken } from "./auth";
import type { Claim, Milestone } from "./types";

const CONFIGURED_API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();

function readApiUrl(): string {
  const url = CONFIGURED_API_URL === "" ? "http://localhost:5050" : CONFIGURED_API_URL;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const API_URL = readApiUrl();

// Under `next dev` a missing NEXT_PUBLIC_API_URL means the local API. A
// production build without one (the deploy sets it from the repo's API_URL
// variable) has no server, so admin says so instead of asking the visitor's
// browser for localhost.
export const API_CONFIGURED = CONFIGURED_API_URL !== "" || process.env.NODE_ENV !== "production";

// Long enough for a slow Atlas query, short enough that a hung request
// doesn't freeze the live run view.
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  // 0 when the API couldn't be reached at all.
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(0, "unexpected", message);
}

// ---------- The request itself ----------

type Method = "GET" | "POST" | "PUT";

interface RequestOptions {
  body?: unknown;
  // false for /health and /auth/*, which work without a token
  auth?: boolean;
}

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON, e.g. an HTML error page from a proxy
  }
}

function errorFromResponse(response: Response, payload: unknown): ApiError {
  const body = asRecord(payload);
  const error = asRecord(body.error);
  if (typeof error.message === "string") {
    const code = typeof error.code === "string" ? error.code : `http_${response.status}`;
    return new ApiError(response.status, code, error.message, error.details ?? null);
  }
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return new ApiError(response.status, `http_${response.status}`, `The API answered ${response.status}${statusText}.`);
}

async function request(method: Method, path: string, options: RequestOptions = {}): Promise<unknown> {
  if (!API_CONFIGURED) {
    throw new ApiError(0, "not_configured", "This copy of the site was built without the address of the team's API.");
  }
  const useAuth = options.auth ?? true;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (useAuth) {
    const token = getToken();
    if (!token) {
      clearSession("Sign in to carry on.");
      throw new ApiError(401, "not_signed_in", "You're not signed in.");
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: timeoutSignal(),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiError(0, "timeout", `The API at ${API_URL} took too long to answer.`);
    }
    // fetch only throws for network problems: the server is down, the URL is
    // wrong, or CORS blocked the response.
    throw new ApiError(0, "network_error", `Can't reach the API at ${API_URL}.`);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const error = errorFromResponse(response, payload);
    if (response.status === 401 && useAuth) {
      clearSession("Your session ended. Sign in again to carry on.");
    }
    throw error;
  }
  return payload;
}

// ---------- Reading responses ----------
// The API wraps most answers in a key ({run}, {runs}, {config}, {user},
// {items, total}), and backend/README.md lists every shape. These helpers
// unwrap them and fill in safe defaults, so a missing list never crashes a page.

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// The object itself, or the object under `key` when it's wrapped.
function unwrap(payload: unknown, key: string): Record<string, unknown> {
  const record = asRecord(payload);
  const inner = record[key];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return record;
}

// A bare list, or the list under the first of `keys` that holds one.
function listFrom(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toCandidate(raw: unknown): Candidate {
  const record = asRecord(raw);
  return {
    ...(record as unknown as Candidate),
    authors: arrayOrEmpty<string>(record.authors),
    flags: arrayOrEmpty(record.flags),
    query_labels: arrayOrEmpty<string>(record.query_labels),
  };
}

function toAssessment(raw: unknown): AiAssessment | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = asRecord(raw);
  return {
    ...(record as unknown as AiAssessment),
    quote_checks: asRecord(record.quote_checks) as AiAssessment["quote_checks"],
  };
}

function toRun(raw: unknown): PipelineRun {
  const record = asRecord(raw);
  return {
    ...(record as unknown as PipelineRun),
    stages: arrayOrEmpty(record.stages),
    options: asRecord(record.options),
    counts: { ...emptyCounts(), ...asRecord(record.counts) },
    usage: { ...emptyUsage(), ...asRecord(record.usage) },
    cost_usd: typeof record.cost_usd === "number" ? record.cost_usd : 0,
    log: arrayOrEmpty<string>(record.log),
    errors: arrayOrEmpty<string>(record.errors),
  };
}

function emptyCounts(): PipelineRun["counts"] {
  return {
    fetched: 0,
    new: 0,
    duplicates: 0,
    triaged: 0,
    relevant: 0,
    unsure: 0,
    triaged_out: 0,
    spot_checks: 0,
    quote_mismatches: 0,
    failed: 0,
    skipped: 0,
  };
}

function emptyUsage(): PipelineRun["usage"] {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}

function toUser(raw: unknown): AdminUser {
  const record = asRecord(raw);
  // The users collection keys people by lowercased email, so id is the email.
  const email = String(record.email ?? record.id ?? "");
  return { email, display_name: String(record.display_name ?? record.name ?? email) };
}

// expires_at may be epoch seconds, epoch milliseconds or an ISO string.
function toExpiry(value: unknown): number | null {
  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toAuthResult(payload: unknown): AuthResult {
  const record = asRecord(payload);
  const token = record.token ?? record.access_token;
  if (typeof token !== "string" || token === "") {
    throw new ApiError(500, "bad_response", "The API accepted the sign-in but didn't send back a token.");
  }
  return { token, user: toUser(record.user), expires_at: toExpiry(record.expires_at) };
}

// ---------- Validation errors ----------

export interface FieldError {
  // Dotted path to the field, e.g. "queries.0.label" or "lookback_days".
  path: string;
  message: string;
}

// "queries[0].label: must not be empty" -> {path: "queries.0.label", message}.
// The API sends its validation problems as lines like that one.
function fieldErrorFromLine(line: string): FieldError {
  const colon = line.indexOf(": ");
  if (colon === -1) {
    return { path: "", message: line };
  }
  const path = line.slice(0, colon).replace(/\[(\d+)\]/g, ".$1");
  return { path, message: line.slice(colon + 2) };
}

// The API's details are a list of "path: message" lines. Pydantic's own
// [{loc: [...], msg}] and a plain {field: message} object work too. Anything
// else gives no field errors.
export function fieldErrorsFrom(error: ApiError): FieldError[] {
  const found: FieldError[] = [];
  const details = error.details;
  const list = Array.isArray(details) ? details : listFrom(details, ["errors"]);
  if (list.length > 0) {
    for (const item of list) {
      if (typeof item === "string") {
        found.push(fieldErrorFromLine(item));
        continue;
      }
      const record = asRecord(item);
      const loc = Array.isArray(record.loc) ? record.loc : [];
      const parts: string[] = [];
      for (const part of loc) {
        if (part !== "body") {
          parts.push(String(part));
        }
      }
      const message = typeof record.msg === "string" ? record.msg : String(record.message ?? "");
      if (message !== "") {
        found.push({ path: parts.join("."), message });
      }
    }
    return found;
  }
  const record = asRecord(details);
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") {
      found.push({ path: key, message: value });
    }
  }
  return found;
}

// ---------- Health and sign-in ----------

// true or false when the API knows whether runs can triage, null when it
// can't: with the GitHub runner the key is a GitHub secret the API never sees.
export function readTriageConfigured(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

export async function getHealth(): Promise<HealthResponse> {
  const record = asRecord(await request("GET", "/api/health", { auth: false }));
  const clientId = record.google_client_id;
  return {
    ...(record as unknown as HealthResponse),
    ok: record.ok === true,
    db_in_memory: record.db_in_memory === true,
    dev_login: record.dev_login === true,
    triage_configured: readTriageConfigured(record.triage_configured),
    google_client_id: typeof clientId === "string" && clientId !== "" ? clientId : null,
  };
}

export async function signInWithGoogle(credential: string): Promise<AuthResult> {
  return toAuthResult(await request("POST", "/api/auth/google", { body: { credential }, auth: false }));
}

export async function signInForDevelopment(email: string): Promise<AuthResult> {
  return toAuthResult(await request("POST", "/api/auth/dev", { body: { email }, auth: false }));
}

export async function getMe(): Promise<AdminUser> {
  return toUser(unwrap(await request("GET", "/api/auth/me"), "user"));
}

// ---------- Pipeline ----------

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const record = asRecord(await request("GET", "/api/pipeline/status"));
  const latest = record.latest_run;
  return {
    counts: asRecord(record.counts) as PipelineStatus["counts"],
    latest_run: latest && typeof latest === "object" ? toRun(latest) : null,
    running: Boolean(record.running),
    active_run_id: typeof record.active_run_id === "string" ? record.active_run_id : null,
    runner: record.runner === "github" ? "github" : "local",
    triage_configured: readTriageConfigured(record.triage_configured),
  };
}

export async function listRuns(limit: number): Promise<PipelineRun[]> {
  const payload = await request("GET", `/api/pipeline/runs?limit=${limit}`);
  const runs: PipelineRun[] = [];
  for (const raw of listFrom(payload, ["runs", "items"])) {
    runs.push(toRun(raw));
  }
  return runs.slice(0, limit);
}

export async function getRun(id: string): Promise<PipelineRun> {
  return toRun(unwrap(await request("GET", `/api/pipeline/runs/${encodeURIComponent(id)}`), "run"));
}

export interface StartedRun {
  id: string;
  run: PipelineRun | null;
}

export async function startRun(body: StartRunRequest): Promise<StartedRun> {
  const payload = await request("POST", "/api/pipeline/runs", { body });
  const record = asRecord(payload);
  const runRecord = unwrap(payload, "run");
  const id = String(runRecord.id ?? record.run_id ?? record.id ?? "");
  const run = typeof runRecord.status === "string" ? toRun(runRecord) : null;
  return { id, run };
}

export async function getSearchConfig(): Promise<SearchConfig> {
  return unwrap(await request("GET", "/api/pipeline/config"), "config") as unknown as SearchConfig;
}

// Returns the stored config, or null when the API answers without one.
export async function saveSearchConfig(config: SearchConfigInput): Promise<SearchConfig | null> {
  const payload = await request("PUT", "/api/pipeline/config", { body: config });
  const stored = unwrap(payload, "config");
  return Array.isArray(stored.queries) ? (stored as unknown as SearchConfig) : null;
}

// ---------- Review queue ----------

export function queueSearchParams(filters: QueueFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("status", filters.status);
  if (filters.kind) {
    params.set("kind", filters.kind);
  }
  if (filters.flag) {
    params.set("flag", filters.flag);
  }
  if (filters.q.trim() !== "") {
    params.set("q", filters.q.trim());
  }
  return params;
}

// The API's page size, and the most it allows in one request.
export const QUEUE_PAGE_SIZE = 50;

// One page of the queue, oldest first. `offset` skips that many matches.
export async function getQueue(filters: QueueFilters, offset = 0): Promise<QueuePage> {
  const params = queueSearchParams(filters);
  params.set("limit", String(QUEUE_PAGE_SIZE));
  if (offset > 0) {
    params.set("offset", String(offset));
  }
  const payload = await request("GET", `/api/queue?${params.toString()}`);
  const items: QueueItem[] = [];
  for (const raw of listFrom(payload, ["items"])) {
    // Each row is {candidate, assessment}.
    const record = asRecord(raw);
    items.push({ source: toCandidate(record.candidate), assessment: toAssessment(record.assessment ?? null) });
  }
  const record = asRecord(payload);
  const total = record.total;
  const counts = record.counts && typeof record.counts === "object" ? (record.counts as QueuePage["counts"]) : null;
  return { items, total: typeof total === "number" ? total : offset + items.length, counts };
}

// The body of GET /queue/<id>. current_assessment is taken as the API sends
// it, with no fallback to the newest assessment: the API compares a review
// against the source's current assessment only, so guessing another one here
// would make every submit fail with assessment_changed.
export function queueItemDetailFrom(payload: unknown): QueueItemDetail {
  const record = asRecord(payload);
  const assessments: AiAssessment[] = [];
  for (const raw of arrayOrEmpty(record.assessments)) {
    const assessment = toAssessment(raw);
    if (assessment) {
      assessments.push(assessment);
    }
  }
  return {
    source: toCandidate(record.candidate),
    current_assessment: toAssessment(record.current_assessment ?? null),
    assessments,
    reviews: arrayOrEmpty<Review>(record.reviews),
  };
}

export async function getQueueItem(id: string): Promise<QueueItemDetail> {
  return queueItemDetailFrom(await request("GET", `/api/queue/${encodeURIComponent(id)}`));
}

export async function submitReview(id: string, body: ReviewRequest): Promise<ReviewResult> {
  const record = asRecord(await request("POST", `/api/queue/${encodeURIComponent(id)}/review`, { body }));
  return { publish_problems: arrayOrEmpty<string>(record.publish_problems) };
}

// Approved sources the public export leaves out, by source id, each with the
// export's reasons. GET /public/sources builds the whole export, so pages
// call this once, not once per paper.
export async function getPublishProblems(): Promise<Record<string, string[]>> {
  const record = asRecord(await request("GET", "/api/public/sources", { auth: false }));
  const problems: Record<string, string[]> = {};
  for (const raw of arrayOrEmpty(record.skipped)) {
    const item = asRecord(raw);
    if (typeof item.id === "string") {
      problems[item.id] = arrayOrEmpty<string>(item.problems);
    }
  }
  return problems;
}

// ---------- Override stats ----------

const STATS_FIELDS: ReviewField[] = ["kind", "technology", "problem", "claim_directions"];
const AI_RELEVANT_GROUPS: AiRelevantGroup[] = ["yes", "unsure", "no_spot_check", "no_rescued", "no_answer"];

function countOrZero(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function rateOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStatsValue(value: unknown): StatsValue {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) {
      items.push(String(item));
    }
    return items;
  }
  return null;
}

function toDecisionCounts(raw: unknown): DecisionCounts {
  const record = asRecord(raw);
  return {
    reviews: countOrZero(record.reviews),
    approved: countOrZero(record.approved),
    rejected: countOrZero(record.rejected),
    approval_rate: rateOrNull(record.approval_rate),
  };
}

function toFieldStats(raw: unknown): FieldStats {
  const record = asRecord(raw);
  const pairs: ValuePair[] = [];
  for (const rawPair of arrayOrEmpty(record.pairs)) {
    const pair = asRecord(rawPair);
    pairs.push({ ai: toStatsValue(pair.ai), final: toStatsValue(pair.final), count: countOrZero(pair.count) });
  }
  return {
    compared: countOrZero(record.compared),
    changed: countOrZero(record.changed),
    ai_values_used: countOrZero(record.ai_values_used),
    change_rate: rateOrNull(record.change_rate),
    pairs,
  };
}

function toPromptVersionStats(raw: unknown): PromptVersionStats {
  const record = asRecord(raw);
  const byRelevant = asRecord(record.by_ai_relevant);
  const groups = {} as Record<AiRelevantGroup, DecisionCounts>;
  for (const group of AI_RELEVANT_GROUPS) {
    groups[group] = toDecisionCounts(byRelevant[group]);
  }
  const rawFields = asRecord(record.fields);
  const fields = {} as Record<ReviewField, FieldStats>;
  for (const field of STATS_FIELDS) {
    fields[field] = toFieldStats(rawFields[field]);
  }
  return {
    ...toDecisionCounts(record),
    prompt_version: typeof record.prompt_version === "string" ? record.prompt_version : null,
    by_ai_relevant: groups,
    fields,
  };
}

export async function getReviewStats(): Promise<ReviewStats> {
  const record = asRecord(await request("GET", "/api/reviews/stats"));
  const versions: PromptVersionStats[] = [];
  for (const raw of arrayOrEmpty(record.by_prompt_version)) {
    versions.push(toPromptVersionStats(raw));
  }
  return { by_prompt_version: versions };
}

// ---------- Signing out ----------

// Tells the API to stop accepting this token, so it can't be used again even
// though it hasn't expired. Called after the session is already cleared, so it
// does its own fetch: a 401 here must not show "your session ended".
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: timeoutSignal(),
    });
  } catch {
    // Signing out locally already happened. The token still expires on its own.
  }
}

// ---------- Sources added by hand ----------

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Adds a paper to Pending review. Returns its id.
export async function addSource(body: NewSourceRequest): Promise<string> {
  const payload = await request("POST", "/api/sources", { body });
  const record = asRecord(payload);
  const candidate = unwrap(payload, "candidate");
  const id = stringOrNull(record.id) ?? stringOrNull(candidate.id) ?? stringOrNull(candidate._id);
  if (id === null) {
    throw new ApiError(500, "bad_response", "The API saved the source but didn't say its id.");
  }
  return id;
}

// The paper a 409 from addSource matched, or null when the error is something else.
export function duplicateFrom(error: ApiError): DuplicateSource | null {
  if (error.status !== 409) {
    return null;
  }
  const details = asRecord(error.details);
  const id = stringOrNull(details.existing_id) ?? stringOrNull(details.id);
  if (id === null) {
    return null;
  }
  // where: "site" (content/sources.json, already public) or "database".
  return {
    existing_id: id,
    in_content: details.where === "site",
    match: stringOrNull(details.match),
    title: stringOrNull(details.existing_title) ?? stringOrNull(details.title),
  };
}

export async function getSourceCatalog(): Promise<CatalogSource[]> {
  const payload = await request("GET", "/api/sources/catalog");
  const sources: CatalogSource[] = [];
  for (const raw of listFrom(payload, ["sources", "items"])) {
    const record = asRecord(raw);
    const id = stringOrNull(record.id);
    if (id === null) {
      continue;
    }
    sources.push({
      id,
      register_id: stringOrNull(record.register_id),
      title: typeof record.title === "string" ? record.title : id,
      authors: arrayOrEmpty<string>(record.authors),
      year: numberOrNull(record.year),
      url: stringOrNull(record.url),
      sample: record.sample === true,
      on_site: record.origin === "site",
    });
  }
  return sources;
}

// ---------- Milestones ----------

function claimOrNull(value: unknown): Claim | null {
  const record = asRecord(value);
  if (typeof record.text !== "string" || typeof record.provenance !== "string") {
    return null;
  }
  return { ...(record as unknown as Claim), source_ids: arrayOrEmpty<string>(record.source_ids) };
}

function claimOrBlank(value: unknown): Claim {
  return claimOrNull(value) ?? { text: "", provenance: "team", source_ids: [] };
}

function claimList(value: unknown): Claim[] {
  const claims: Claim[] = [];
  for (const raw of arrayOrEmpty(value)) {
    const claim = claimOrNull(raw);
    if (claim) {
      claims.push(claim);
    }
  }
  return claims;
}

// Only the Milestone model's own fields, each with a safe default, so the
// editor never crashes on a missing list and a save never sends the API's
// bookkeeping fields back (the model refuses unknown fields).
export function toMilestone(raw: unknown): Milestone {
  const record = asRecord(raw);
  const estimate = asRecord(record.estimate);
  const override = asRecord(record.disagreement_override);
  const forecasts: Milestone["forecasts"] = [];
  for (const rawForecast of arrayOrEmpty(record.forecasts)) {
    const forecast = asRecord(rawForecast);
    forecasts.push({
      id: String(forecast.id ?? ""),
      source_id: String(forecast.source_id ?? ""),
      forecaster: String(forecast.forecaster ?? ""),
      claim: String(forecast.claim ?? ""),
      quote: String(forecast.quote ?? ""),
      quote_location: stringOrNull(forecast.quote_location),
      made_in: numberOrNull(forecast.made_in) ?? 0,
      earliest: numberOrNull(forecast.earliest),
      latest: numberOrNull(forecast.latest),
      never: forecast.never === true,
    });
  }
  const milestone: Milestone = {
    id: String(record.id ?? record._id ?? ""),
    name: String(record.name ?? ""),
    technology: (record.technology ?? "wbe") as Milestone["technology"],
    stage: (record.stage ?? "possible") as Milestone["stage"],
    category: (record.category ?? "technical_capability") as Milestone["category"],
    status: (record.status ?? "not_demonstrated") as Milestone["status"],
    status_basis: claimOrBlank(record.status_basis),
    achieved_in: numberOrNull(record.achieved_in),
    achieved_in_basis: claimOrNull(record.achieved_in_basis),
    confidence: (stringOrNull(record.confidence) as Milestone["confidence"]) ?? null,
    summary: claimOrBlank(record.summary),
    success_criterion: claimOrBlank(record.success_criterion),
    main_bottleneck: claimOrBlank(record.main_bottleneck),
    depends_on: arrayOrEmpty<string>(record.depends_on),
    source_ids: arrayOrEmpty<string>(record.source_ids),
    estimate:
      typeof estimate.earliest === "number"
        ? {
            earliest: estimate.earliest,
            latest: numberOrNull(estimate.latest),
            basis: claimOrBlank(estimate.basis),
            set_by: String(estimate.set_by ?? ""),
            set_on: String(estimate.set_on ?? ""),
          }
        : null,
    forecasts,
    disagreement_override:
      typeof override.flagged === "boolean" ? { flagged: override.flagged, basis: claimOrBlank(override.basis) } : null,
    disagreement_note: claimOrNull(record.disagreement_note),
    would_move_earlier: claimList(record.would_move_earlier),
    would_move_later: claimList(record.would_move_later),
    artificial_minds_questions: claimList(record.artificial_minds_questions),
  };
  if (record.sample === true) {
    milestone.sample = true;
  }
  return milestone;
}

// Who saved a record, as a name. The API's own seed and import steps save
// under the pseudo-users "seed" and "import".
function editorName(email: unknown, name: unknown): string | null {
  if (email === "seed") {
    return "the starting content";
  }
  if (email === "import") {
    return "an import from content/";
  }
  return stringOrNull(name) ?? stringOrNull(email);
}

// The API sends a stored milestone as one flat document: the Milestone fields
// with the editor's own (published, version, position, updated_*) beside them.
function toMilestoneRecord(raw: unknown): MilestoneRecord {
  const record = asRecord(raw);
  const inner = record.milestone && typeof record.milestone === "object" ? record.milestone : record;
  return {
    milestone: toMilestone(inner),
    published: record.published === true,
    version: numberOrNull(record.version) ?? 0,
    // updated_by is an email; the name reads better wherever it's shown.
    updated_by: editorName(record.updated_by, record.updated_by_name),
    updated_at: stringOrNull(record.updated_at),
  };
}

export async function listMilestones(): Promise<MilestoneRecord[]> {
  const payload = await request("GET", "/api/milestones");
  const records: MilestoneRecord[] = [];
  for (const raw of listFrom(payload, ["milestones", "items"])) {
    records.push(toMilestoneRecord(raw));
  }
  return records;
}

export async function getMilestoneRecord(id: string): Promise<MilestoneRecord> {
  const payload = await request("GET", `/api/milestones/${encodeURIComponent(id)}`);
  const record = asRecord(payload);
  // {milestone: {...flat doc}} or the flat doc itself.
  if (record.milestone && typeof record.milestone === "object" && record.version === undefined) {
    return toMilestoneRecord(record.milestone);
  }
  return toMilestoneRecord(payload);
}

// What a create or save sends back, or null when it answers without the record.
function savedMilestone(payload: unknown): MilestoneRecord | null {
  const record = asRecord(payload);
  const inner = asRecord(record.milestone);
  if (typeof record.version === "number" || typeof inner.version === "number") {
    return typeof record.version === "number" ? toMilestoneRecord(record) : toMilestoneRecord(inner);
  }
  return null;
}

export async function createMilestone(milestone: Milestone, published: boolean): Promise<MilestoneRecord | null> {
  return savedMilestone(await request("POST", "/api/milestones", { body: { milestone, published } }));
}

export async function saveMilestone(id: string, body: MilestoneSaveRequest): Promise<MilestoneRecord | null> {
  return savedMilestone(await request("PUT", `/api/milestones/${encodeURIComponent(id)}`, { body }));
}

export async function getMilestoneRevisions(id: string): Promise<MilestoneRevision[]> {
  const payload = await request("GET", `/api/milestones/${encodeURIComponent(id)}/revisions`);
  const revisions: MilestoneRevision[] = [];
  for (const raw of listFrom(payload, ["revisions", "items"])) {
    const record = asRecord(raw);
    const snapshot = record.milestone && typeof record.milestone === "object" ? record.milestone : record.snapshot;
    revisions.push({
      version: numberOrNull(record.version) ?? 0,
      updated_by: editorName(record.saved_by, record.saved_by_name),
      updated_at: stringOrNull(record.updated_at) ?? stringOrNull(record.saved_at) ?? stringOrNull(record.created_at),
      published: record.published === true,
      milestone: snapshot && typeof snapshot === "object" ? toMilestone(snapshot) : null,
    });
  }
  revisions.sort((a, b) => b.version - a.version);
  return revisions;
}

// ---------- Blog posts ----------

function toPostStatus(value: unknown): PostStatus {
  return value === "published" ? "published" : "draft";
}

function toAdminPost(raw: unknown): AdminPost {
  const record = asRecord(raw);
  return {
    slug: String(record.slug ?? record._id ?? ""),
    title: String(record.title ?? ""),
    date: String(record.date ?? ""),
    author: String(record.author ?? ""),
    summary: String(record.summary ?? ""),
    body: String(record.body ?? ""),
    status: toPostStatus(record.status),
    published_at: stringOrNull(record.published_at),
    updated_by: editorName(record.updated_by, record.updated_by_name),
    updated_at: stringOrNull(record.updated_at),
    version: numberOrNull(record.version) ?? 0,
  };
}

export async function listPosts(): Promise<AdminPost[]> {
  const payload = await request("GET", "/api/posts");
  const posts: AdminPost[] = [];
  for (const raw of listFrom(payload, ["posts", "items"])) {
    posts.push(toAdminPost(raw));
  }
  return posts;
}

export async function getAdminPost(slug: string): Promise<AdminPost> {
  return toAdminPost(unwrap(await request("GET", `/api/posts/${encodeURIComponent(slug)}`), "post"));
}

// What a create or save sends back, or null when it answers without the post.
function savedPost(payload: unknown): AdminPost | null {
  const post = unwrap(payload, "post");
  return typeof post.slug === "string" && typeof post.version === "number" ? toAdminPost(post) : null;
}

export async function createPost(post: PostInput): Promise<AdminPost | null> {
  return savedPost(await request("POST", "/api/posts", { body: post }));
}

// slug is the post's current slug; body.slug may rename it while it's a draft.
export async function savePost(slug: string, body: PostSaveRequest): Promise<AdminPost | null> {
  return savedPost(await request("PUT", `/api/posts/${encodeURIComponent(slug)}`, { body }));
}

// ---------- Publishing the public site ----------

function toSitePublish(raw: unknown): SitePublish | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = asRecord(raw);
  return {
    id: String(record.id ?? record._id ?? ""),
    // The API keeps emails to itself and sends the name.
    requested_by: stringOrNull(record.requested_by_name) ?? stringOrNull(record.requested_by),
    requested_at: stringOrNull(record.requested_at),
    mode: record.mode === "github" ? "github" : "local",
    github_status: stringOrNull(record.github_status),
    error: stringOrNull(record.error),
  };
}

function countFrom(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (typeof record[key] === "number") {
      return record[key] as number;
    }
  }
  return 0;
}

export async function getPublishStatus(): Promise<PublishStatus> {
  const record = asRecord(await request("GET", "/api/site/publish"));
  const waiting = asRecord(record.waiting);
  return {
    last: toSitePublish(record.last_publish ?? record.last),
    latest_attempt: toSitePublish(record.latest_attempt),
    mode: record.mode === "github" ? "github" : "local",
    waiting: {
      sources: countFrom(waiting, ["sources", "sources_approved", "approved_sources"]),
      milestones: countFrom(waiting, ["milestones", "milestones_saved"]),
      posts: countFrom(waiting, ["posts", "posts_saved"]),
    },
  };
}

export async function publishSite(): Promise<PublishResult> {
  const record = asRecord(await request("POST", "/api/site/publish"));
  return {
    mode: record.mode === "github" ? "github" : "local",
    command: stringOrNull(record.command),
    publish: toSitePublish(record.publish),
  };
}
