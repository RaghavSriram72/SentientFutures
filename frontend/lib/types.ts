// Hand-written mirror of shared/sf_shared/models.py for the demo.
// In W2 this file is replaced by types generated from the shared JSON Schema.
// If you change a field here, change it in models.py too (CI validates content/ with Python).

export type Technology = "wbe" | "bci" | "neuromorphic" | "hybrid";
export type Problem = "alignment" | "intelligence_curse" | "both";
export type Stage = "possible" | "widely_available" | "actually_helping";
export type MilestoneCategory =
  | "reliability_robustness"
  | "technical_capability"
  | "safety_welfare_assurance"
  | "scalable_production"
  | "economic_viability"
  | "legal_regulatory"
  | "institutional_legitimacy"
  | "equitable_access";
export type MilestoneStatus = "not_demonstrated" | "prototype" | "replicated" | "mature";
export type Confidence = "high" | "medium" | "low";
export type CaseRating = "strong" | "moderate" | "weak" | "unclear" | "not_claimed";
export type RiskRating = "high" | "medium" | "low" | "unclear";
export type UnclearReason =
  | "no_relevant_evidence"
  | "conflicting_evidence"
  | "underspecified_proposal"
  | "search_incomplete"
  | "other";
export type EvidenceType = "argument" | "simulation" | "experiment" | "deployment" | "review";
export type Directness = "direct" | "adjacent" | "remote";
export type Independence = "independent" | "non_biased" | "affiliated";
export type SourceType = "peer_reviewed" | "preprint" | "blog" | "report" | "forum_post";
export type SourceKind = "argument" | "milestone_evidence";
export type Relevance = "core" | "supporting" | "peripheral" | "not_relevant";
export type Credibility = "strong" | "adequate" | "weak" | "unclear";
export type Provenance = "source" | "team" | "ai" | "unclear";

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

// The team's own range. When present it is drawn as a solid bar, and it wins
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
  main_bottleneck: Claim;
  depends_on: string[];
  source_ids: string[];
  estimate: Estimate | null;
  forecasts: Forecast[];
  disagreement_override: DisagreementOverride | null;
  disagreement_note: Claim | null;
  would_move_earlier: Claim[];
  would_move_later: Claim[];
  artificial_minds_questions: Claim[];
  sample?: boolean; // true for the worked examples; shown with a SAMPLE tag
}

export interface Source {
  id: string;
  title: string;
  authors: string[];
  year: number;
  url: string;
  doi?: string | null;
  arxiv_id?: string | null;
  venue?: string | null;
  source_type: SourceType;
  kind: SourceKind;
  technology: Technology[];
  problem: Problem | null;
  evidence_type: EvidenceType;
  directness: Directness;
  independence: Independence;
  relevance: Relevance;
  credibility: Credibility;
  credibility_unclear_reason?: UnclearReason | null;
  summary: Claim;
  ai_suggested_fields: string[];
  reviewed_by?: string | null;
  reviewed_on?: string | null;
  sample?: boolean;
}

export interface ScorecardRow {
  dimension: string;
  problem: Problem | null;
  scale: "case" | "risk";
  rating: CaseRating | RiskRating;
  confidence: Confidence;
  unclear_reason?: UnclearReason | null;
  basis: Claim;
}

export interface TechnologyPage {
  id: Exclude<Technology, "hybrid">;
  name: string;
  short_name: string;
  headline: string; // use *asterisks* around the one italic word or phrase
  intro: Claim;
  claims_to_solve: Claim[];
  mechanism: Claim[];
  strongest_case: Claim[];
  strongest_objections: Claim[];
  scorecard: ScorecardRow[];
  artificial_minds_questions: Claim[];
  sample?: boolean;
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
  posts: Post[];
  nowYear: number;
  builtAt: string;
}
