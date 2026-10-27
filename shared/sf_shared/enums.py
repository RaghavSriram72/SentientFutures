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
    # The scorecard's "if claimed" rows: nobody in our sources says the
    # proposal will deliver this, so "not demonstrated" would overstate it.
    NOT_CLAIMED = "not_claimed"


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
    TALK = "talk"
    PODCAST = "podcast"
    BOOK = "book"


class ClaimDirection(StrEnum):
    """Which way a source's argument points. The team's "Claim (+/-)" column."""

    AI_ALIGNMENT = "ai_alignment"
    AI_MISALIGNMENT = "ai_misalignment"
    HUMAN_EMPOWERMENT = "human_empowerment"
    HUMAN_DISEMPOWERMENT = "human_disempowerment"


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
            "both": ("Both", "Claims to address both alignment and the Intelligence Curse."),
        },
    },
    "Stage": {
        "draft": False,
        "values": {
            "possible": ("Possible", "Reached once someone shows it can be done at all."),
            "widely_available": (
                "Widely available",
                "Reached once it's reliable and affordable enough for lots of people to get.",
            ),
            "actually_helping": ("Actually helping", "Reached once it measurably helps with alignment or human agency."),
        },
    },
    "MilestoneCategory": {
        "draft": False,
        "values": {
            "reliability_robustness": ("Reliability and robustness", "Works consistently outside the lab."),
            "technical_capability": ("Technical capability", "The technology can do the main thing it's meant to do."),
            "safety_welfare_assurance": ("Safety and welfare assurance", "We can check that it's safe, including for any minds involved."),
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
            "not_claimed": ("Not claimed", "None of our current sources claims the proposal will do this."),
        },
    },
    "Confidence": {
        "draft": False,
        "values": {
            "high": (
                "High",
                "Several relevant, reasonably solid sources support the judgment, and we've considered the main "
                "evidence against it.",
            ),
            "medium": ("Medium", "Some relevant support, but with real limits."),
            "low": ("Low", "The judgment rests mainly on indirect evidence, early results or contested assumptions."),
        },
    },
    # Wording follows the rating rules in the team's scorecard v0.1 (section 7).
    "CaseRating": {
        "draft": False,
        "values": {
            "strong": (
                "Strong",
                "The mechanism is clear, relevant evidence supports it, and the main alternatives and ways it could "
                "fail have been substantially addressed.",
            ),
            "moderate": (
                "Moderate",
                "The mechanism is plausible and has some relevant support, but important assumptions or evidence "
                "gaps remain.",
            ),
            "weak": (
                "Weak",
                "The mechanism doesn't target the outcome well, depends on especially demanding assumptions, or "
                "faces substantial evidence against it.",
            ),
            "unclear": (
                "Unclear",
                "We can't make a responsible call either way from the evidence available or the proposal as "
                "written. The reason is always given.",
            ),
            "not_claimed": ("Not claimed", "The proposal doesn't claim this outcome. This is different from Weak or Unclear."),
        },
    },
    # Scorecard v0.1 leaves the thresholds to the pilot, so high and medium
    # stay neutral instead of describing a cutoff nobody has agreed on.
    "RiskRating": {
        "draft": True,
        "values": {
            "high": ("High", "The top of the scale."),
            "medium": ("Medium", "The middle of the scale, judged on the same factors."),
            "low": (
                "Low",
                "The bottom of the scale. It needs evidence behind it and is never given just because nobody has "
                "studied a risk.",
            ),
            "unclear": ("Unclear", "We can't make a responsible call yet. The rating names its reason."),
        },
    },
    "UnclearReason": {
        "draft": False,
        "values": {
            "no_relevant_evidence": ("No relevant evidence found", "We looked and found nothing relevant."),
            "conflicting_evidence": ("Conflicting evidence", "Credible sources point in different directions."),
            "underspecified_proposal": ("Underspecified proposal", "The proposal isn't specific enough to assess."),
            "search_incomplete": ("Search incomplete", "We haven't finished looking."),
            "other": ("Other", "See the note."),
        },
    },
    "EvidenceType": {
        "draft": False,
        "values": {
            "argument": ("Argument", "Reasoning or analysis without new data."),
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
            "preprint": ("Preprint", "Public but not yet peer reviewed."),
            "blog": ("Blog", "A blog post or newsletter."),
            "report": ("Report", "A report from an organization."),
            "forum_post": ("Forum post", "A post on a forum like LessWrong or the Alignment Forum."),
            "talk": ("Talk", "A recorded talk or workshop presentation."),
            "podcast": ("Podcast", "A podcast episode or interview."),
            "book": ("Book", "A book or a chapter in one."),
        },
    },
    "ClaimDirection": {
        "draft": True,
        "values": {
            "ai_alignment": ("AI alignment", "The source argues the approach could help align AI."),
            "ai_misalignment": (
                "AI misalignment",
                "The source argues the approach won't help with alignment, or could make misalignment worse.",
            ),
            "human_empowerment": (
                "Human empowerment",
                "The source argues the approach could strengthen people's agency or bargaining power.",
            ),
            "human_disempowerment": (
                "Human disempowerment",
                "The source argues the approach could weaken people's agency, privacy or bargaining power.",
            ),
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
            "not_relevant": ("Not relevant", "Unrelated to this project."),
        },
    },
    "Credibility": {
        "draft": True,
        "values": {
            "strong": (
                "Strong",
                "The methods are transparent, the claims match the evidence, and the work has been reviewed or "
                "replicated.",
            ),
            "adequate": ("Adequate", "Reasonable methods, with some gaps or overreach."),
            "weak": ("Weak", "The methods are opaque, or the claims go well beyond the evidence."),
            "unclear": ("Unclear", "We can't judge it yet. The reason is given with the rating."),
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
            "unclear": ("Unclear", "We don't know, and the tag gives the reason."),
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
    "ClaimDirection": ClaimDirection,
    "SourceKind": SourceKind,
    "Relevance": Relevance,
    "Credibility": Credibility,
    "TimeHorizon": TimeHorizon,
    "Provenance": Provenance,
}
