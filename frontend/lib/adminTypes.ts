// Hand-written mirror of shared/sf_shared/pipeline_models.py and the admin API
// responses in docs/pipeline-architecture.md. If you change a model there,
// change it here too. Dates arrive as ISO 8601 strings with a time zone.
// lib/api.ts turns the API's responses into these shapes.
import type {
  ClaimDirection,
  Credibility,
  Directness,
  EvidenceType,
  Independence,
  Milestone,
  Problem,
  Relevance,
  SourceKind,
  SourceType,
  Technology,
  UnclearReason,
} from "./types";

export type IsoDateTime = string;

// ---------- Candidates (the sources collection) ----------

// new -> triaged_out | pending_review -> approved | rejected
export type ReviewStatus = "new" | "triaged_out" | "pending_review" | "approved" | "rejected";

export type Relevant = "yes" | "no" | "unsure";

export type CandidateFlag = "ai_failed" | "spot_check" | "quote_mismatch" | "no_abstract" | "possible_duplicate";

export type Collector = "arxiv" | "semantic_scholar" | "manual";

export interface Candidate {
  id: string;
  origin: "pipeline" | "manual";
  collector: Collector;
  title: string;
  authors: string[];
  year: number | null;
  url: string;
  doi?: string | null;
  arxiv_id?: string | null;
  s2_id?: string | null;
  venue?: string | null;
  source_type?: SourceType | null;
  // Only kept while the candidate is new or pending. Cleared after a decision.
  abstract?: string | null;
  title_key: string;
  review_status: ReviewStatus;
  flags: CandidateFlag[];
  query_labels: string[];
  found_at: IsoDateTime;
  updated_at: IsoDateTime;
  current_assessment_id?: string | null;
  current_review_id?: string | null;
  // Papers added by hand: who added them, and their note for the reviewer.
  added_by?: string | null;
  added_by_name?: string | null;
  note?: string | null;
}

// ---------- AI assessments (insert-only) ----------

// The four fields a reviewer settles in the field table.
export type ReviewField = "kind" | "technology" | "problem" | "claim_directions";

export type EvidenceField = "relevant" | ReviewField;

export interface FieldEvidence {
  field: EvidenceField;
  reason: string;
  quote: string;
}

export interface TriageResult {
  relevant: Relevant;
  kind: SourceKind | null;
  technology: Technology[];
  problem: Problem | null;
  claim_directions: ClaimDirection[];
  milestone_ids: string[];
  evidence: FieldEvidence[];
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AiAssessment {
  id: string;
  source_id: string;
  run_id: string | null;
  model: string;
  effort: string;
  prompt_version: string;
  rubric_version: string;
  created_at: IsoDateTime;
  stop_reason: string | null;
  refusal_category?: string | null;
  raw_output: string;
  // null when the model's output didn't validate
  parsed: TriageResult | null;
  // field name -> did its quote appear in the title or abstract
  quote_checks: Partial<Record<EvidenceField, boolean>>;
  error?: string | null;
  usage: TokenUsage;
  cost_usd: number;
}

// ---------- Reviews (insert-only) ----------

export interface ReviewFinal {
  kind: SourceKind | null;
  technology: Technology[];
  problem: Problem | null;
  claim_directions: ClaimDirection[];
  // Required to approve: public summaries are always written by the team.
  summary: string | null;
  source_type: SourceType | null;
  // The rubric is optional at review time; null means "not rated yet".
  evidence_type: EvidenceType | null;
  directness: Directness | null;
  independence: Independence | null;
  relevance: Relevance | null;
  credibility: Credibility | null;
  // Why credibility is "unclear". Only sent with an "unclear" rating, and
  // never "other": sources have no note field to explain it.
  credibility_unclear_reason?: UnclearReason | null;
  // Approving needs at least one technology, or this, for a paper that's
  // background for the whole project. It then goes public with no technology.
  general_background?: boolean;
}

export type RejectReason = "not_relevant" | "duplicate" | "out_of_scope" | "low_quality" | "other";

export type Decision = "approve" | "reject";

export interface Review {
  id: string;
  source_id: string;
  assessment_id: string | null;
  reviewer: string;
  reviewer_name: string;
  decision: Decision;
  reject_reason?: RejectReason | null;
  final: ReviewFinal;
  compared_fields: string[];
  changed_fields: string[];
  ai_values_used: string[];
  notes: string;
  prompt_version: string | null;
  rubric_version: string;
  created_at: IsoDateTime;
}

// ---------- Pipeline runs ----------

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "partial";

export type RunStage = "collect" | "triage";

export type RunTrigger = "schedule" | "admin" | "cli";

export type Runner = "local" | "github";

export interface StageCounts {
  fetched: number;
  new: number;
  duplicates: number;
  triaged: number;
  relevant: number;
  unsure: number;
  triaged_out: number;
  spot_checks: number;
  quote_mismatches: number;
  failed: number;
  skipped: number;
}

export interface PipelineRun {
  id: string;
  trigger: RunTrigger;
  runner: Runner;
  requested_by?: string | null;
  status: RunStatus;
  stages: RunStage[];
  // limit, dry_run, lookback_days, and anything else the runner records
  options: Record<string, unknown>;
  started_at: IsoDateTime;
  finished_at?: IsoDateTime | null;
  heartbeat_at?: IsoDateTime | null;
  counts: StageCounts;
  usage: TokenUsage;
  cost_usd: number;
  log: string[];
  errors: string[];
}

// ---------- Search config ----------

export type SearchCollector = "arxiv" | "semantic_scholar";

export type Effort = "low" | "medium" | "high";

export interface SearchQuery {
  label: string;
  text: string;
  collectors: SearchCollector[];
  enabled: boolean;
}

export interface SearchConfig {
  id: "default";
  queries: SearchQuery[];
  lookback_days: number;
  max_items_per_run: number;
  max_cost_usd_per_run: number;
  spot_check_rate: number;
  model: string;
  effort: Effort;
  updated_by?: string | null;
  updated_at?: IsoDateTime | null;
}

// What the admin page sends back. The API fills in updated_by and updated_at.
export type SearchConfigInput = Omit<SearchConfig, "updated_by" | "updated_at">;

// ---------- Users and sign-in ----------

export interface AdminUser {
  email: string;
  display_name: string;
}

export interface AuthResult {
  token: string;
  user: AdminUser;
  // Epoch milliseconds, when the API says. Otherwise lib/auth reads the token.
  expires_at: number | null;
}

// ---------- API responses ----------

export interface HealthResponse {
  ok: boolean;
  git_sha?: string | null;
  rubric_version?: string;
  runner?: Runner;
  db?: unknown;
  // True for mongomock: changes made with the users CLI vanish when it exits.
  db_in_memory: boolean;
  dev_login: boolean;
  // See PipelineStatus.triage_configured.
  triage_configured: boolean | null;
  google_client_id: string | null;
}

export interface PipelineStatus {
  counts: Partial<Record<ReviewStatus, number>>;
  latest_run: PipelineRun | null;
  running: boolean;
  // The queued or running run, when there is one.
  active_run_id: string | null;
  runner: Runner;
  // Whether runs started from admin can triage. null when the API can't tell:
  // the GitHub runner keeps its Anthropic key as a GitHub secret.
  triage_configured: boolean | null;
}

export interface StartRunRequest {
  stages: RunStage[];
  limit?: number;
  dry_run?: boolean;
}

export interface QueueFilters {
  status: ReviewStatus;
  kind: SourceKind | "";
  flag: CandidateFlag | "";
  q: string;
}

// One row of GET /api/queue: a candidate and its latest assessment, if any.
export interface QueueItem {
  source: Candidate;
  assessment: AiAssessment | null;
}

// One page of GET /api/queue. `total` counts every match, not just this page.
export interface QueuePage {
  items: QueueItem[];
  total: number;
  // Papers in every status, ignoring the filters. null if the API didn't say.
  counts: Partial<Record<ReviewStatus, number>> | null;
}

// GET /api/queue/<id>
export interface QueueItemDetail {
  source: Candidate;
  // The assessment source.current_assessment_id points at, or null when it
  // points at none. Reviews compare against this one only, like the API does.
  current_assessment: AiAssessment | null;
  // Every assessment, the current one included.
  assessments: AiAssessment[];
  reviews: Review[];
}

export interface ReviewRequest {
  decision: Decision;
  final: ReviewFinal;
  ai_values_used: ReviewField[];
  notes: string;
  reject_reason?: RejectReason;
  // The assessment the reviewer compared against (null when there was none).
  // The API refuses the review if a newer one has arrived since.
  assessment_id: string | null;
  // Only when changing an earlier decision: the review being replaced.
  replaces_review_id?: string;
}

// What POST /api/queue/<id>/review answers, as far as the pages need it.
export interface ReviewResult {
  // Problems that keep an approved source off the public site until someone
  // fixes the record, e.g. a missing year. Empty when it can be published.
  publish_problems: string[];
}

// ---------- Override stats (GET /api/reviews/stats) ----------

// What the AI said about relevance, for splitting approval rates:
// yes and unsure as given, "no" split into spot checks and papers someone
// rescued from Triaged out, and no_answer for failed or missing assessments.
export type AiRelevantGroup = "yes" | "unsure" | "no_spot_check" | "no_rescued" | "no_answer";

export interface DecisionCounts {
  reviews: number;
  approved: number;
  rejected: number;
  // approved / reviews, or null with no reviews
  approval_rate: number | null;
}

// A field value as the stats send it: one enum value, a list of them, or null.
export type StatsValue = string | string[] | null;

export interface ValuePair {
  ai: StatsValue;
  final: StatsValue;
  count: number;
}

export interface FieldStats {
  // Approvals where the AI gave this field a value
  compared: number;
  // Of those, how many the reviewer changed
  changed: number;
  // Of those, how many kept the AI's value with "Use AI value"
  ai_values_used: number;
  // changed / compared, or null when nothing was compared
  change_rate: number | null;
  // AI value -> final value, most common first. Unchanged pairs are included.
  pairs: ValuePair[];
}

export interface PromptVersionStats extends DecisionCounts {
  // null for reviews with no AI assessment behind them
  prompt_version: string | null;
  by_ai_relevant: Record<AiRelevantGroup, DecisionCounts>;
  fields: Record<ReviewField, FieldStats>;
}

export interface ReviewStats {
  by_prompt_version: PromptVersionStats[];
}

// ---------- Sources added by hand (POST /api/sources) ----------

export interface NewSourceRequest {
  url: string;
  title: string;
  authors: string[];
  year: number | null;
  doi?: string;
  arxiv_id?: string;
  venue?: string;
  source_type?: SourceType;
  abstract?: string;
  // For the team only, never published.
  note?: string;
}

// What a 409 from POST /api/sources says about the paper we already have.
export interface DuplicateSource {
  existing_id: string;
  // True when the match is in content/sources.json (already on the public
  // site), false when it's a paper in admin.
  in_content: boolean;
  // What matched: "doi", "arxiv_id" or "title".
  match: string | null;
  title: string | null;
}

// One entry of GET /api/sources/catalog: every source a milestone can cite,
// from content/sources.json and from approved papers.
export interface CatalogSource {
  id: string;
  register_id: string | null;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  // A fictional worked example. Real milestones shouldn't cite these.
  sample: boolean;
  // From content/sources.json, so already on the public site. Otherwise an
  // approved paper that goes up with the next publish.
  on_site: boolean;
}

// ---------- Milestones (GET/PUT /api/milestones) ----------

// A stored milestone: the public Milestone plus the admin's own bookkeeping,
// which the export strips.
export interface MilestoneRecord {
  milestone: Milestone;
  // Whether the next publish puts it on the public site. Samples never go
  // public, whatever this says.
  published: boolean;
  version: number;
  updated_by: string | null;
  updated_at: IsoDateTime | null;
}

export interface MilestoneSaveRequest {
  milestone: Milestone;
  // The version the editor started from. A newer one on the server means
  // someone else saved first, and the API answers 409.
  version: number;
  published: boolean;
}

// One snapshot from GET /api/milestones/<id>/revisions, newest first.
export interface MilestoneRevision {
  version: number;
  updated_by: string | null;
  updated_at: IsoDateTime | null;
  published: boolean;
  milestone: Milestone | null;
}

// ---------- Blog posts (GET/PUT /api/posts) ----------

export type PostStatus = "draft" | "published";

export interface AdminPost {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  author: string;
  summary: string;
  body: string; // Markdown
  status: PostStatus;
  published_at: IsoDateTime | null;
  updated_by: string | null;
  updated_at: IsoDateTime | null;
  version: number;
}

// What the editor sends. The API fills in published_at and updated_*.
export interface PostInput {
  slug: string;
  title: string;
  date: string;
  author: string;
  summary: string;
  body: string;
  status: PostStatus;
}

export interface PostSaveRequest extends PostInput {
  version: number;
}

// ---------- Publishing the public site (/api/site/publish) ----------

export type PublishMode = "local" | "github";

export interface SitePublish {
  id: string;
  requested_by: string | null;
  requested_at: IsoDateTime | null;
  mode: PublishMode;
  // "dispatched" (GitHub took it), "failed", or "not_sent" (local mode).
  github_status: string | null;
  // Why GitHub didn't start the rebuild, when it didn't.
  error: string | null;
}

// Changes saved since the last publish, waiting for the next one.
export interface PublishWaiting {
  sources: number;
  milestones: number;
  posts: number;
}

export interface PublishStatus {
  // The last publish that went out. Failed attempts don't count.
  last: SitePublish | null;
  // The newest press of Publish, failed or not.
  latest_attempt: SitePublish | null;
  // local: this server can't rebuild the site, so Publish shows a command.
  mode: PublishMode;
  waiting: PublishWaiting;
}

export interface PublishResult {
  mode: PublishMode;
  // Local mode: what to run to rebuild the site on this computer.
  command: string | null;
  publish: SitePublish | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
