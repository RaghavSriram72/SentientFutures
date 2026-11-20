// Hand-written mirror of shared/sf_shared/models.py.
// In W2 this file is replaced by types generated from the shared JSON Schema.
// If you change a field here, change it in models.py too (CI validates content/ with Python).

export type Technology = "wbe" | "bci" | "neuromorphic" | "hybrid";
export type Problem = "alignment" | "intelligence_curse" | "both";
export type Stage = "possible" | "widely_available" | "actually_helping";
// In type order: Technical, then Deployment, then Welfare and governance.
export type MilestoneCategory =
  | "technical_capability"
  | "high_level_fidelity"
  | "reliability_robustness"
  | "scalable_production"
  | "economic_viability"
  | "equitable_access"
  | "safety_welfare_assurance"
  | "legal_regulatory"
  | "institutional_legitimacy";
export type MilestoneType = "technical" | "deployment" | "welfare_governance"; // worked out from the category, never stored
export type MilestoneStatus = "not_demonstrated" | "prototype" | "replicated" | "mature" | "not_claimed" | "unclear";
export type Confidence = "high" | "medium" | "low";
export type CaseRating = "strong" | "moderate" | "weak" | "unclear" | "not_claimed";
// Retired: no scorecard row uses it since v0.4. Kept because enums.json still lists it.
export type RiskRating = "high" | "medium" | "low" | "unclear";
export type UnclearReason =
  | "no_relevant_evidence"
  | "conflicting_evidence"
  | "underspecified_proposal"
  | "search_incomplete"
  | "indirect_evidence_only"
  | "outcome_not_operationalized"
  | "information_inaccessible"
  | "other";
export type EvidenceType = "argument" | "simulation" | "experiment" | "deployment" | "review";
export type Directness = "direct" | "adjacent" | "remote";
export type Independence = "independent" | "non_biased" | "affiliated";
export type SourceType = "peer_reviewed" | "preprint" | "blog" | "report" | "forum_post" | "talk" | "podcast" | "book";
// Which way a source's argument points (the team's "Claim (+/-)" column).
export type ClaimDirection = "ai_alignment" | "ai_misalignment" | "human_empowerment" | "human_disempowerment";
export type SourceKind = "argument" | "milestone_evidence";
export type Relevance = "core" | "supporting" | "peripheral" | "not_relevant";
export type Credibility = "strong" | "adequate" | "weak" | "unclear";
export type Provenance = "source" | "team" | "ai" | "unclear";

// ---------- The workbook's scales (scorecard v0.4), as in enums.py ----------
// How close an evidence entry is to the family. Not the source rubric's Directness.
export type EvidenceDirectness = "direct" | "close_prerequisite" | "related_neuroai" | "conceptual";
export type EvidenceRole = "supports" | "contrary" | "qualifies" | "prerequisite_only";
export type EvidenceBasis = "demonstrated" | "projected" | "argued" | "assumed";
// A causal link's status.
export type EvidenceStatus = "supporting" | "contrary" | "conflicting" | "no_relevant_evidence" | "search_incomplete";
export type Severity = "very_high" | "high" | "medium" | "low" | "unclear";
export type Likelihood = "high" | "medium" | "low" | "not_assessable";
// A risk's reversibility or detectability.
export type RiskLevel = "high" | "medium" | "low" | "unclear";
export type RiskDomain = "human_welfare" | "artificial_mind_welfare" | "governance";
export type GovernanceStatus = "not_addressed" | "proposal_found" | "evidence_found";
export type AgencyEffect = "strengthens" | "weakens" | "mixed" | "not_addressed";
// The technology pages a workbook row can belong to.
export type Family = Exclude<Technology, "hybrid">;
// The register's "Outcome addressed" and the links' "Outcome", word for word.
export type Outcome = "AI Alignment" | "Intelligence Curse" | "Both" | "Neither";

// Every sentence shown on the site is a Claim, so its provenance travels with it.
//   source  -> needs source_ids and an exact quote (max 300 chars)
//   team    -> the team's own interpretation
//   ai      -> AI-suggested; needs reviewed_by (only public after a human checked it).
//              The one exception: records with sample: true may leave it null, and
//              the tag then says "not yet reviewed".
//   unclear -> genuinely uncertain; needs unclear_reason (and unclear_note when reason is "other")
export interface Claim {
  text: string;
  provenance: Provenance;
  source_ids?: string[];
  quote?: string | null;
  quote_location?: string | null;
  unclear_reason?: UnclearReason | null;
  unclear_note?: string | null;
  reviewed_by?: string | null;
}

// One forecast from one forecaster, stored as stated. Never averaged.
//   point "in 2045"        -> earliest 2045, latest 2045
//   "by 2045"              -> earliest null, latest 2045
//   "not before 2045"      -> earliest 2045, latest null
//   "never"                -> never true, earliest and latest null
export interface Forecast {
  id: string;
  source_id: string;
  forecaster: string;
  claim: string;
  quote: string;
  quote_location?: string | null;
  made_in: number;
  earliest: number | null;
  latest: number | null;
  never: boolean;
}

// The team's own range. When present it is drawn as a solid ribbon, and it wins
// over the forecast span, but forecasts and any disagreement stay visible.
export interface Estimate {
  earliest: number;
  latest: number | null;
  basis: Claim;
  set_by: string;
  set_on: string; // YYYY-MM-DD
}

export interface DisagreementOverride {
  flagged: boolean;
  basis: Claim;
}

export interface Milestone {
  id: string; // slug, never changes once public
  name: string;
  technology: Technology;
  stage: Stage;
  category: MilestoneCategory;
  status: MilestoneStatus;
  status_basis: Claim;
  achieved_in: number | null;
  achieved_in_basis: Claim | null;
  confidence: Confidence | null; // required when estimate is set
  summary: Claim;
  success_criterion: Claim;
  main_bottleneck: Claim | null; // null when the workbook's cell is empty
  depends_on: string[];
  source_ids: string[];
  estimate: Estimate | null;
  forecasts: Forecast[];
  disagreement_override: DisagreementOverride | null;
  disagreement_note: Claim | null;
  would_move_earlier: Claim[];
  would_move_later: Claim[];
  artificial_minds_questions: Claim[];
  // From the workbook's milestone tab (1a). All optional, so older records
  // still fit. assessment_confidence is the tab's "Confidence" in the status;
  // `confidence` above stays the team range's.
  assessment_confidence?: Confidence | null;
  applies_to?: string | null;
  criterion_met?: string | null; // "Criterion met?", word for word
  evidence_entries?: string[]; // the E-ids the evidence cell cites, for counts and filters
  timing?: string | null;
  note?: string | null;
  sample?: boolean; // true for the worked examples; shown with a SAMPLE tag
}

export interface Source {
  id: string;
  register_id?: string | null; // the team's evidence register id, e.g. "S02"
  title: string;
  authors: string[]; // empty when the authors aren't known
  year: number;
  url: string;
  other_urls?: string[];
  doi?: string | null;
  arxiv_id?: string | null;
  venue?: string | null;
  source_type: SourceType;
  kind?: SourceKind | null; // null = not classified yet
  technology: Technology[];
  problem: Problem | null;
  claim_directions?: ClaimDirection[];
  // The rubric ratings. null = not rated yet.
  evidence_type?: EvidenceType | null;
  directness?: Directness | null;
  independence?: Independence | null;
  relevance?: Relevance | null;
  credibility?: Credibility | null;
  credibility_unclear_reason?: UnclearReason | null;
  summary: Claim;
  ai_suggested_fields: string[];
  added_by?: string | null;
  reviewed_by?: string | null;
  reviewed_on?: string | null;
  quality?: SourceQuality | null; // the workbook's 3a cells, word for word
  screening_pending?: boolean; // true while the workbook marks the source "screening pending"
  sample?: boolean;
}

// One row of the workbook's "3a Source Quality" tab, each cell word for word.
export interface SourceQuality {
  source_type?: string | null; // "Source type"
  empirical_theoretical?: string | null; // "Empirical / theoretical"
  original_secondary?: string | null; // "Original / secondary"
  peer_review?: string | null; // "Peer-review status"
  affiliation?: string | null; // "Affiliation / independence"
}

// One change to a scorecard rating. The previous assessment stays visible.
// note.source_ids names the source or sources that caused the change.
export interface RatingChange {
  date: string; // YYYY-MM-DD
  rating_before: CaseRating;
  rating_after: CaseRating;
  confidence_before: Confidence;
  confidence_after: Confidence;
  note: Claim;
}

// What a rating card adds to its scorecard row. Every field is optional.
export interface RatingTracker {
  // An "unclear" claim with reason "search_incomplete" counts as not assessed yet.
  what_would_change?: Claim | null;
  last_updated?: string | null; // YYYY-MM-DD
  history?: RatingChange[]; // oldest first
  milestone_ids?: string[]; // the milestones this rating informs, in the team's order
  // True while the tracker is an example the team hasn't checked. Shown, with a mark.
  placeholder?: boolean;
}

// One headline judgment. Case rows carry a rating; risk rows never do: the
// workbook keeps a risk's severity, likelihood and confidence apart.
export interface ScorecardRow {
  // Stable and the same on every page. Never changes once public: the row's
  // anchor (#scorecard-<id>) and the compare address use it.
  id: string;
  dimension: string;
  problem: Problem | null;
  scale: "case" | "risk";
  rating: CaseRating | null; // null on risk rows
  confidence: Confidence;
  unclear_reason?: UnclearReason | null; // optional: the workbook states none
  // Risk rows only. null until the workbook gives them, or when not applicable.
  severity?: Severity | null;
  likelihood?: Likelihood | null;
  // Risk rows only: false when the workbook says "Not applicable" (BCI, artificial minds).
  applicable?: boolean;
  basis: Claim | null; // always set on case rows; optional on risk rows
  tracker?: RatingTracker | null;
}

// ---------- The technology page's workbook sections (scorecard v0.4) ----------
// Written by python -m sf_shared.import_workbook, word for word. Codes stay in
// the text as written; source_ids and entries lists are parsed from the cells.

export interface Scope {
  intervention: Claim; // "Technology family definition"
  deployment_scenario: Claim;
  affected_groups: Claim;
  time_horizon: Claim;
  comparator: Claim;
  problems_claimed: Claim; // "Problem(s) claimed to address", without the trailing arrow
  problem: Problem; // the problem named after that arrow
  source_ids?: string[]; // from "Source IDs / basis", ranges expanded (counts and links)
  source_ids_text?: string | null; // that cell word for word ("S24-S29" kept): show this one
}

export interface AssessmentQuestion {
  question: string;
  answer: Claim;
}

// One scenario row of "4 Alignment Judgment", word for word.
export interface AlignmentScenario {
  scenario: string;
  problem: string; // "Problem addressed"
  mechanism?: string | null;
  supporting?: string[]; // entry ids
  contrary_or_qualifying?: string[]; // entry ids
  gap?: string | null; // "Main gap, or reason for rating"
}

// The family row of "4 Alignment Judgment", plus its scenario rows.
export interface AlignmentAssessment {
  problem_addressed: string;
  mechanism: Claim;
  questions?: AssessmentQuestion[];
  rating: CaseRating;
  confidence: Confidence;
  unclear_reason?: UnclearReason | null;
  reason: Claim;
  decisive_question: Claim;
  scenarios?: AlignmentScenario[];
}

// One row of "6 Agency and Ownership" for the family.
export interface AgencyRow {
  group: string; // "Group or dimension"
  effect: AgencyEffect;
  mechanism?: string | null;
  ownership_questions?: string | null;
  entries?: string[];
}

// The family's row of "5 Intelligence Curse Judgment", plus its agency rows.
export interface IntelligenceCurseAssessment {
  mechanism: Claim; // "Mechanism claimed"
  questions?: AssessmentQuestion[]; // each question is the column header word for word
  rating: CaseRating;
  confidence: Confidence;
  unclear_reason?: UnclearReason | null;
  reason: Claim;
  decisive_question?: Claim | null; // the tab has no such column
  agency?: AgencyRow[];
  ownership_gate?: string | null;
}

// One row of "4.1 Artificial Minds" for the family. Empty rows are kept, so
// the stage list is complete.
export interface ArtificialMindsStage {
  stage?: string | null; // "S3"; null when the Stage cell has no leading number ("All stages")
  stage_label: string; // the Stage cell word for word, e.g. "3 Whole brain emulation (one instance)"
  stage_number?: number | null;
  consciousness?: string | null;
  moral_status?: string | null; // "Moral status grounded in"
  identity?: string | null; // "Identity, copying and modification"
  welfare?: string | null; // "Welfare harms or benefits named"
  protections?: string | null; // "Protections proposed"
  source_ids?: string[];
  entries?: string[];
}

// The family's row of "9 Welfare and Governance Judgment". Severity,
// likelihood and confidence per domain are on the scorecard's risk rows.
export interface WelfareGovernance {
  exposed: Claim; // "Who is exposed"
  harms: Claim; // "Main harms (risk IDs)"
  rationale: Claim;
}

export interface TechnologyPage {
  id: Family;
  name: string;
  short_name: string;
  headline: string; // use *asterisks* around the one italic word or phrase
  intro: Claim;
  // The outline sections, written on the site (BCI and NM: drafted by AI).
  claims_to_solve?: Claim[];
  mechanism?: Claim[];
  strongest_case?: Claim[];
  strongest_objections?: Claim[];
  scorecard: ScorecardRow[];
  artificial_minds_questions?: Claim[];
  alternatives?: Claim[];
  // The workbook's sections. All optional.
  scope?: Scope | null;
  alignment_assessment?: AlignmentAssessment | null;
  intelligence_curse_assessment?: IntelligenceCurseAssessment | null;
  artificial_minds_by_stage?: ArtificialMindsStage[];
  welfare_governance?: WelfareGovernance | null;
  tension?: Claim | null; // team-written; the page shows it only when set
  // True while the page has AI-drafted outline sections nobody has reviewed.
  // The page itself (ratings and workbook sections) is the team's.
  unreviewed_ai_sections?: boolean;
}

// ---------- content/scorecard.json: the workbook's shared tables ----------
// Generated by python -m sf_shared.import_workbook, never edited by hand.

export interface WorkbookInfo {
  title: string; // the Overview tab's first cell
  version: string; // e.g. "0.4"
  source_sha256?: string | null;
}

export interface Overview {
  purpose: string;
  principles?: string[];
  update_protocol?: string[];
}

// The "1 Scope" tab's Cross-family row.
export interface CrossFamilyScope {
  intervention: string; // "Technology family definition"
  deployment_scenario?: string | null;
  source_ids?: string[];
  source_ids_text?: string | null; // "Source IDs / basis" word for word, as on Scope
}

// One Codebook row, in sheet order. family is the sheet's own word ("WBE", "All").
export interface CodebookRow {
  type: string;
  code: string;
  family: string;
  definition: string;
}

export interface Framework {
  id: string; // "RF1"
  reference: string;
  url: string;
  contributes: string; // "What it contributes"
  applied: string; // "Applied in workbook"
}

// One of tab 1a's category headers: "M1 Technical capability" and its question.
export interface MilestoneCategoryInfo {
  id: string; // "M1"
  category: MilestoneCategory;
  label: string;
  question: string;
}

// One family row of tab 1a. BCI M1 and NM M1 have two rows each, told apart by applies_to.
export interface MilestoneAssessment {
  family: Family;
  milestone: string; // "M1"
  category: MilestoneCategory;
  applies_to: string;
  success_criterion: string;
  status: MilestoneStatus;
  criterion_met: string; // "Criterion met?", word for word
  evidence: string; // "Evidence (entries and basis)", word for word: link its E-ids inline
  evidence_entries?: string[]; // parsed E-ids for counts and filters ("not admissible" ones left out)
  bottleneck?: string | null;
  timing?: string | null;
  confidence: Confidence;
  note?: string | null;
}

// What an entry feeds, from the register's "Ratings it feeds (direction)".
export type FeedTarget = "alignment" | "intelligence_curse" | `M${number}`;

export interface EntryFeed {
  family: Family;
  target: FeedTarget;
  direction: "supports" | "against_or_qualifies";
  note?: string | null; // e.g. "efficiency prerequisite only"
}

// One row of the "0 Evidence Register" tab.
export interface EvidenceEntry {
  id: string; // "E001"
  source_id: string; // the site's source id, "s01"
  register_id: string; // the sheet's "Source ID", "S01"
  locator: string;
  claim: string; // "Exact claim"
  codes?: string[]; // "Link / milestone / risk ID", split on ";"
  family: Family | "cross_family";
  feeds?: EntryFeed[];
  feeds_text: string; // "Ratings it feeds (direction)", word for word
  source_type_independence: string;
  outcome: Outcome;
  alignment_problem: string; // "A-VS" ... or "N/A"
  scenarios?: string[]; // scenario codes
  stage: string; // "S1" ... or "N/A"
  directness: EvidenceDirectness;
  role: EvidenceRole;
  basis: EvidenceBasis;
}

// One row of the "2 Theory of Change" tab.
export interface CausalLink {
  id: string; // "WBE-O-L1"
  family: Family;
  scenario_code: string; // "WBE-O"
  scenario: string; // the tab's Scenario name
  step: string; // "Step in causal chain", word for word
  outcome: Outcome;
  claim: string;
  status: EvidenceStatus;
  supporting?: string[];
  contrary?: string[];
  qualifying?: string[];
  best_directness?: EvidenceDirectness | null;
  assumption?: string | null;
  objection?: string | null;
}

// One row of the "7 Overall Risks" tab.
export interface Risk {
  id: string; // "R01"
  risk: string;
  families: Family[];
  domain: RiskDomain;
  category: string;
  exposed: string; // "Who is exposed (scale)"
  severity: Severity; // "Potential severity"
  likelihood: Likelihood;
  reversibility: RiskLevel;
  detectability: RiskLevel;
  remedies: string; // "Remedies and safeguards"
  control: string; // "Who controls / route to exit"
  confidence: Confidence;
  entries?: string[];
}

// One row of the "8 Governance Checklist" tab.
export interface GovernanceItem {
  id: string; // "G01"
  family: Family;
  question: string;
  status: GovernanceStatus;
  entries?: string[];
  summary?: string | null;
}

export interface ScorecardData {
  generated: string;
  workbook: WorkbookInfo;
  overview?: Overview | null;
  codebook?: CodebookRow[];
  frameworks?: Framework[];
  milestone_categories?: MilestoneCategoryInfo[];
  milestone_assessments?: MilestoneAssessment[];
  entries?: EvidenceEntry[];
  links?: CausalLink[];
  risks?: Risk[];
  governance?: GovernanceItem[];
  scope_notes?: string[];
  cross_family_scope?: CrossFamilyScope | null;
}

export interface Post {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  author: string;
  summary: string;
  body: string; // markdown
}

export interface SiteData {
  milestones: Milestone[];
  sources: Source[];
  technologies: TechnologyPage[];
  scorecard: ScorecardData;
  posts: Post[];
  nowYear: number;
  builtAt: string;
}
