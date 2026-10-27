"""Every category used on the site, in one place.

Changing a category is a one-line edit here plus a RUBRIC_VERSION bump.
`python -m sf_shared.export_schema` writes these to shared/schema/enums.json,
which the frontend reads for labels and descriptions.

Values are lowercase snake_case. Labels and descriptions live in ENUM_INFO below.
"""

from enum import StrEnum

RUBRIC_VERSION = "0.1-draft"


class Technology(StrEnum):
    WBE = "wbe"
    BCI = "bci"
    NEUROMORPHIC = "neuromorphic"
    HYBRID = "hybrid"


class Problem(StrEnum):
    ALIGNMENT = "alignment"
    INTELLIGENCE_CURSE = "intelligence_curse"
    BOTH = "both"


class Stage(StrEnum):
    POSSIBLE = "possible"
    WIDELY_AVAILABLE = "widely_available"
    ACTUALLY_HELPING = "actually_helping"


class MilestoneCategory(StrEnum):
    RELIABILITY_ROBUSTNESS = "reliability_robustness"
    TECHNICAL_CAPABILITY = "technical_capability"
    SAFETY_WELFARE_ASSURANCE = "safety_welfare_assurance"
    SCALABLE_PRODUCTION = "scalable_production"
    ECONOMIC_VIABILITY = "economic_viability"
    LEGAL_REGULATORY = "legal_regulatory"
    INSTITUTIONAL_LEGITIMACY = "institutional_legitimacy"
    EQUITABLE_ACCESS = "equitable_access"


class MilestoneStatus(StrEnum):
    NOT_DEMONSTRATED = "not_demonstrated"
    PROTOTYPE = "prototype"
    REPLICATED = "replicated"
    MATURE = "mature"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CaseRating(StrEnum):
    STRONG = "strong"
    MODERATE = "moderate"
    WEAK = "weak"
    UNCLEAR = "unclear"
    NOT_CLAIMED = "not_claimed"


class RiskRating(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNCLEAR = "unclear"


class UnclearReason(StrEnum):
    NO_RELEVANT_EVIDENCE = "no_relevant_evidence"
    CONFLICTING_EVIDENCE = "conflicting_evidence"
    UNDERSPECIFIED_PROPOSAL = "underspecified_proposal"
    SEARCH_INCOMPLETE = "search_incomplete"
    OTHER = "other"


class EvidenceType(StrEnum):
    ARGUMENT = "argument"
    SIMULATION = "simulation"
    EXPERIMENT = "experiment"
    DEPLOYMENT = "deployment"
    REVIEW = "review"


class Directness(StrEnum):
    DIRECT = "direct"
    ADJACENT = "adjacent"
    REMOTE = "remote"


class Independence(StrEnum):
    INDEPENDENT = "independent"
    NON_BIASED = "non_biased"
    AFFILIATED = "affiliated"


class SourceType(StrEnum):
    PEER_REVIEWED = "peer_reviewed"
    PREPRINT = "preprint"
    BLOG = "blog"
    REPORT = "report"
    FORUM_POST = "forum_post"


class SourceKind(StrEnum):
    ARGUMENT = "argument"
    MILESTONE_EVIDENCE = "milestone_evidence"


class Relevance(StrEnum):
    CORE = "core"
    SUPPORTING = "supporting"
    PERIPHERAL = "peripheral"
    NOT_RELEVANT = "not_relevant"


class Credibility(StrEnum):
    STRONG = "strong"
    ADEQUATE = "adequate"
    WEAK = "weak"
    UNCLEAR = "unclear"


class TimeHorizon(StrEnum):
    NEAR = "near"
    MEDIUM = "medium"
    LONG = "long"


class Provenance(StrEnum):
    SOURCE = "source"
    TEAM = "team"
    AI = "ai"
    UNCLEAR = "unclear"


# Labels and one-line descriptions for the site. `draft: True` marks categories
# the team hasn't settled yet; the methodology page shows them as drafts.
ENUM_INFO = {
    "Technology": {
        "draft": False,
        "values": {
            "wbe": ("Whole brain emulation", "Scanning a brain and running it as software."),
            "bci": ("Brain computer interfaces", "Devices that read from or write to the nervous system."),
            "neuromorphic": ("Neuromorphic AI", "AI that borrows its architecture or learning rules from brains."),
            "hybrid": ("Hybrid", "Proposals that combine more than one of the above."),
        },
    },
    "Problem": {
        "draft": False,
        "values": {
            "alignment": ("Alignment", "Getting advanced AI to reliably pursue what people actually want."),
            "intelligence_curse": ("Intelligence Curse", "AI eroding the economic and political value of human participation."),
            "both": ("Both", "Claims to address alignment and the Intelligence Curse."),
        },
    },
    "Stage": {
        "draft": False,
        "values": {
            "possible": ("Possible", "Someone has shown it can be done at all."),
            "widely_available": ("Widely available", "Cheap, reliable and accessible enough to matter at scale."),
            "actually_helping": ("Actually helping", "Measurably helping with alignment or human agency."),
        },
    },
    "MilestoneCategory": {
        "draft": False,
        "values": {
            "reliability_robustness": ("Reliability and robustness", "Works consistently outside the lab."),
            "technical_capability": ("Technical capability", "The core thing can be done."),
            "safety_welfare_assurance": ("Safety and welfare assurance", "We can tell it's safe, including for any minds involved."),
            "scalable_production": ("Scalable manufacture, compute or data", "Can be produced or run at the scale needed."),
            "economic_viability": ("Economic viability", "Affordable enough that people will pay for it."),
            "legal_regulatory": ("Legal and regulatory permission", "Allowed by the relevant law and regulators."),
            "institutional_legitimacy": ("Institutional capacity and public legitimacy", "Institutions can run it and the public accepts it."),
            "equitable_access": ("Equitable or broad access", "Available beyond a small privileged group."),
        },
    },
    "MilestoneStatus": {
        "draft": False,
        "values": {
            "not_demonstrated": ("Not demonstrated", "No one has shown this yet."),
            "prototype": ("Prototype", "Shown once, in limited conditions."),
            "replicated": ("Replicated", "Shown more than once, by more than one group."),
            "mature": ("Mature", "Routine and dependable."),
        },
    },
    "Confidence": {
        "draft": False,
        "values": {
            "high": (
                "High",
                "Backed by several relevant, reasonably robust sources, and the main contrary evidence has been weighed.",
            ),
            "medium": ("Medium", "Some relevant support, but meaningful limits remain."),
            "low": ("Low", "Rests mainly on indirect evidence, early results or contested assumptions."),
        },
    },
    # Wording follows the rating rules in the team's scorecard v0.1 (section 7).
    "CaseRating": {
        "draft": False,
        "values": {
            "strong": (
                "Strong",
                "A clear mechanism, relevant supporting evidence, and the main alternatives and failure modes "
                "substantially addressed.",
            ),
            "moderate": (
                "Moderate",
                "A plausible mechanism with some relevant support, but important assumptions or evidence gaps remain.",
            ),
            "weak": (
                "Weak",
                "The mechanism poorly targets the outcome, relies on especially demanding assumptions, or faces "
                "substantial contrary evidence.",
            ),
            "unclear": (
                "Unclear",
                "We can't make a responsible call either way from the evidence or the proposal as written. "
                "See the reason.",
            ),
            "not_claimed": ("Not claimed", "The proposal doesn't claim this outcome. Not the same as Weak or Unclear."),
        },
    },
    # Scorecard v0.1 leaves the thresholds to the pilot, so high and medium
    # stay neutral instead of describing a cutoff nobody has agreed on.
    "RiskRating": {
        "draft": True,
        "values": {
            "high": (
                "High",
                "The top of the scale. Ratings weigh severity, exposure, reversibility and the safeguards in place, "
                "and the thresholds are still being defined.",
            ),
            "medium": ("Medium", "The middle of the scale, on the same factors. Thresholds are still being defined."),
            "low": (
                "Low",
                "The bottom of the scale, backed by evidence. Never given just because nobody has studied a risk.",
            ),
            "unclear": ("Unclear", "We can't make a responsible call yet. See the reason."),
        },
    },
    "UnclearReason": {
        "draft": False,
        "values": {
            "no_relevant_evidence": ("No relevant evidence found", "We looked and found nothing that bears on it."),
            "conflicting_evidence": ("Conflicting evidence", "Credible sources point in different directions."),
            "underspecified_proposal": ("Underspecified proposal", "The proposal isn't specific enough to assess."),
            "search_incomplete": ("Search incomplete", "We haven't finished looking."),
            "other": ("Other", "See the note."),
        },
    },
    "EvidenceType": {
        "draft": False,
        "values": {
            "argument": ("Argument", "Reasoning or analysis, no new data."),
            "simulation": ("Simulation", "Results from a model or simulation."),
            "experiment": ("Experiment", "Results from a controlled study."),
            "deployment": ("Deployment", "Evidence from real-world use."),
            "review": ("Review", "A synthesis of other work."),
        },
    },
    "Directness": {
        "draft": False,
        "values": {
            "direct": ("Direct", "About this exact scenario."),
            "adjacent": ("Adjacent", "About a closely related scenario."),
            "remote": ("Remote", "Only loosely related."),
        },
    },
    "Independence": {
        "draft": False,
        "values": {
            "independent": ("Independent", "No stake in the outcome."),
            "non_biased": ("Non-biased", "Some connection, but no obvious stake."),
            "affiliated": ("Affiliated", "The author or funder has a stake in the outcome."),
        },
    },
    "SourceType": {
        "draft": False,
        "values": {
            "peer_reviewed": ("Peer reviewed", "Published after peer review."),
            "preprint": ("Preprint", "Public, not yet peer reviewed."),
            "blog": ("Blog", "A blog post or newsletter."),
            "report": ("Report", "A report from an organization."),
            "forum_post": ("Forum post", "A post on a forum like LessWrong or the Alignment Forum."),
        },
    },
    "SourceKind": {
        "draft": False,
        "values": {
            "argument": ("Argument", "Proposes or criticizes neuroengineering as a response to alignment or the Intelligence Curse."),
            "milestone_evidence": ("Milestone evidence", "Technical progress that bears on a milestone."),
        },
    },
    "Relevance": {
        "draft": True,
        "values": {
            "core": ("Core", "Bears directly on a claim or milestone on this site."),
            "supporting": ("Supporting", "Backs up a core source or adds useful context."),
            "peripheral": ("Peripheral", "Related background, rarely cited."),
            "not_relevant": ("Not relevant", "Doesn't bear on this project."),
        },
    },
    "Credibility": {
        "draft": True,
        "values": {
            "strong": ("Strong", "Transparent methods, claims match the evidence, reviewed or replicated."),
            "adequate": ("Adequate", "Reasonable methods with some gaps or overreach."),
            "weak": ("Weak", "Opaque methods or claims well beyond the evidence."),
            "unclear": ("Unclear", "We can't judge yet. See the reason."),
        },
    },
    "TimeHorizon": {
        "draft": True,
        "values": {
            "near": ("Near term", "Definition to be agreed."),
            "medium": ("Medium term", "Definition to be agreed."),
            "long": ("Long term", "Definition to be agreed."),
        },
    },
    "Provenance": {
        "draft": False,
        "values": {
            "source": ("From a source", "Taken straight from a cited source, with the exact quote."),
            "team": ("Our read", "The team's own interpretation."),
            "ai": (
                "AI-suggested",
                "Suggested by an AI model. The tag names the person who checked it, or says it hasn't been checked yet.",
            ),
            "unclear": ("Unclear", "Genuinely uncertain, with the reason stated."),
        },
    },
}

ALL_ENUMS = {
    "Technology": Technology,
    "Problem": Problem,
    "Stage": Stage,
    "MilestoneCategory": MilestoneCategory,
    "MilestoneStatus": MilestoneStatus,
    "Confidence": Confidence,
    "CaseRating": CaseRating,
    "RiskRating": RiskRating,
    "UnclearReason": UnclearReason,
    "EvidenceType": EvidenceType,
    "Directness": Directness,
    "Independence": Independence,
    "SourceType": SourceType,
    "SourceKind": SourceKind,
    "Relevance": Relevance,
    "Credibility": Credibility,
    "TimeHorizon": TimeHorizon,
    "Provenance": Provenance,
}
