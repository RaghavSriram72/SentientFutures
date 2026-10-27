import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { EnumDefinitions, enumTitleFromName } from "@/components/common/EnumDefinitions";
import { DraftBadge } from "@/components/common/Marks";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { StageCards } from "@/components/common/StageCards";
import { Stamp } from "@/components/common/Stamp";
import { ProvenanceLegend, StageLegend } from "@/components/provenance/Legends";
import { ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import { allEnumNames, enumValues, isDraftEnum, RUBRIC_VERSION, type EnumName } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS, DISAGREEMENT_RULE_TEXT, DISAGREEMENT_RULE_VERSION } from "@/lib/estimates";
import type { Provenance } from "@/lib/types";

import { RuleSpecimens } from "./RuleSpecimens";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "The rules behind this site's marks, timeline and ratings, including what the AI may do and our credibility guidelines for sources.",
};

const SECTIONS = [
  { id: "reading", label: "How to read this site" },
  { id: "stages", label: "The three stages" },
  { id: "timeline", label: "Timeline rules" },
  { id: "ai", label: "The AI's role" },
  { id: "credibility", label: "Credibility guidelines" },
  { id: "ratings", label: "Rating rules" },
  { id: "categories", label: "Other categories" },
  { id: "versions", label: "Versions" },
];

// These three are the published credibility guidelines, so they get their own section.
const CREDIBILITY_GROUP: EnumName[] = ["Credibility", "Independence", "EvidenceType"];

// The scales the technology scorecards use, from the team's scorecard v0.1 rating rules.
const RATING_GROUP: EnumName[] = ["CaseRating", "RiskRating", "Confidence"];

// Hand-written titles and notes. Any category added to enums.py later still
// shows up below, with a title made from its name.
const ENUM_COPY: Partial<Record<EnumName, { title?: string; note?: string }>> = {
  Credibility: {
    note: "How far we trust a source's claims, judged on its methods and on whether the claims match the evidence. We rate it separately from where the work appeared, since a peer-reviewed paper can be weak and a blog post can be strong.",
  },
  Independence: {
    title: "Source independence",
    note: "Whether the author or funder has a stake in the result.",
  },
  EvidenceType: {
    note: "What kind of support a source gives. An argument and an experiment can both count, but we weigh them differently.",
  },
  Technology: { title: "Technology family" },
  Problem: { title: "Problem addressed" },
  Stage: { note: "On the timeline, color shows stage and nothing else." },
  MilestoneCategory: { title: "Milestone category", note: "What kind of hurdle a milestone is." },
  MilestoneStatus: { title: "Milestone status" },
  Confidence: { note: "How sure we are of a rating or an estimate." },
  CaseRating: {
    title: "Positive-case rating",
    note: "How strong the case is that a technology helps. We rate the alignment case and the Intelligence Curse case separately.",
  },
  RiskRating: {
    title: "Risk rating",
    note: "This scale covers human welfare risk, artificial-mind welfare and rights risk, and governance risk. Each is judged in the scenario the proposal describes, weighing potential severity, who's exposed, reversibility and the safeguards available. A row that's still Unclear can also carry a “potentially high severity” warning. The warning isn't a rating, and the row stays Unclear.",
  },
  UnclearReason: { title: "Reason for unclear", note: "Every Unclear rating names one of these." },
  Directness: { title: "Directness to scenario" },
  SourceType: { title: "Source type" },
  ClaimDirection: {
    title: "Claim direction",
    note: "Which way a source argues about a proposal. A source can argue more than one way, so it can carry several of these.",
  },
  SourceKind: {
    title: "Source kind",
    note: "Arguments about these proposals are rare, and reports of technical progress are plentiful. We keep the two apart so the arguments don't get buried.",
  },
  Relevance: { note: "Placeholder values until the team agrees on them." },
  TimeHorizon: { title: "Time horizon", note: "Definitions still to be agreed." },
  Provenance: { note: "The four marks from section 01." },
};

function enumTitle(name: EnumName): string {
  return ENUM_COPY[name]?.title ?? enumTitleFromName(name);
}

const PROVENANCE_EXPLAINERS: { kind: Provenance; text: string }[] = [
  {
    kind: "source",
    text: "The quote is 300 characters at most and links to the source, so you can check it yourself.",
  },
  {
    kind: "team",
    text: "If you read the evidence differently from us, tell us.",
  },
  {
    kind: "ai",
    text: "Once a person checks the line, the dashed outline stays and their name replaces “not yet reviewed”.",
  },
  {
    kind: "unclear",
    text: "The reason always comes from this list:",
  },
];

function MethodSection({
  id,
  number,
  label,
  title,
  intro,
  children,
}: {
  id: string;
  number: string;
  label: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <SectionHead id={`${id}-heading`} eyebrow={`${number} · ${label}`} title={title} intro={intro} />
      {children}
    </section>
  );
}

export default function MethodologyPage() {
  const otherEnums: EnumName[] = [];
  for (const name of allEnumNames()) {
    if (!CREDIBILITY_GROUP.includes(name) && !RATING_GROUP.includes(name)) {
      otherEnums.push(name);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Methodology"
        title={
          <>
            How we <em>mark and rate</em> what we publish
          </>
        }
        lede="What each mark, bar and rating on the site means and how we decide on it. This page is also our rubric and our credibility guidelines. Each change to the rules gets a new version number."
      >
        <span className="chip">Rubric v{RUBRIC_VERSION}</span>
      </PageHeader>

      <div className="container">
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="On this page">
            <p className={`eyebrow ${styles.tocTitle}`}>On this page</p>
            <ol className={styles.tocList}>
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className={styles.tocLink}>
                    <span className={styles.tocNumber}>{String(index + 1).padStart(2, "0")}</span>
                    {section.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={styles.content}>
            <MethodSection
              id="reading"
              number="01"
              label="How to read this site"
              title={
                <>
                  The four <em>marks</em> on every claim
                </>
              }
              intro="Every research claim on the site carries one of four marks, whether it sits in a milestone, a forecast, a source summary or a scorecard. Each mark has its own glyph and line style, so the four stay distinct even in black and white."
            >
              <div className={styles.legendWrap}>
                <ProvenanceLegend />
              </div>
              <dl className={styles.explainers}>
                {PROVENANCE_EXPLAINERS.map((item) => (
                  <div key={item.kind} className={styles.explainer}>
                    <dt>
                      <ProvenanceTag kind={item.kind} plain />
                    </dt>
                    <dd>
                      <p>{item.text}</p>
                      {item.kind === "unclear" && (
                        <ul className={styles.reasonList}>
                          {enumValues("UnclearReason").map((info) => (
                            <li key={info.value}>
                              <span className={styles.reasonLabel}>{info.label}.</span> {info.description}
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={`${styles.callout} ${styles.calloutAi}`}>
                <strong>After launch, nothing AI-written goes on the site until a person has checked it.</strong> In this
                draft the BCI and neuromorphic pages are AI-written outlines the team hasn&rsquo;t reviewed yet, so every
                line on them says &ldquo;not yet reviewed&rdquo;.
              </p>
            </MethodSection>

            <MethodSection
              id="stages"
              number="02"
              label="The three stages"
              title={
                <>
                  The three <em>stages</em> on the timeline
                </>
              }
              intro="Each stage asks something different: whether it can be done, whether people can get it, and whether it helps. Claims about brain tech often run these together. Every milestone on the timeline is tagged with exactly one stage, and the timeline uses color for stage only."
            >
              <div className={styles.stageKey}>
                <StageLegend />
              </div>
              <StageCards />
            </MethodSection>

            <MethodSection
              id="timeline"
              number="03"
              label="Timeline rules"
              title={
                <>
                  How the timeline <em>draws uncertainty</em>
                </>
              }
              intro="Each milestone gets one bar at most, and what the bar means depends on the estimates we have. Conflicting forecasts stay separate and never become one precise date."
            >
              <RuleSpecimens />

              <ul className={styles.ruleList}>
                <li>
                  Every forecast is drawn as its own whisker. Its panel says who made it and when, the window they gave
                  and the exact quote.
                </li>
                <li>
                  Any milestone with at least one forecast has a count, &ldquo;N forecasts from M sources&rdquo;, which
                  tells you whether it&rsquo;s well studied or rests on a single guess.
                </li>
                <li>
                  If a forecast&rsquo;s window has passed and the milestone hasn&rsquo;t happened, the forecast is
                  grayed out and counted separately.
                </li>
                <li>A milestone that has already happened is drawn as a point at the year it happened.</li>
              </ul>

              <div className={`paper ${styles.ruleCard}`}>
                <div className={styles.ruleCardHead}>
                  <p className="eyebrow">The disagreement rule · v{DISAGREEMENT_RULE_VERSION}</p>
                  <Stamp size="sm" />
                </div>
                <p className={styles.ruleThreshold}>
                  Threshold: <span className="mono">{DISAGREEMENT_GAP_YEARS} years</span>
                </p>
                <ol className={styles.ruleSteps}>
                  {DISAGREEMENT_RULE_TEXT.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              </div>
            </MethodSection>

            <MethodSection
              id="ai"
              number="04"
              label="The AI's role"
              title={
                <>
                  What the AI <em>is allowed</em> to do
                </>
              }
              intro="Soon an AI model will help us keep up with new research, and a person will review everything it suggests. For now the team adds sources by hand."
            >
              <ul className={styles.aiGrid}>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    01
                  </span>
                  <h3>Finds and triages</h3>
                  <p>
                    Once the pipeline is running, a weekly script will search research databases, and an AI model will read
                    the titles and abstracts to pick out the papers that look relevant.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    02
                  </span>
                  <h3>Never publishes</h3>
                  <p>
                    Only a person can approve a source or put anything on this site, including changes to the timeline.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    03
                  </span>
                  <h3>Every suggestion gets reviewed</h3>
                  <p>
                    A team member checks each suggestion against the source, then approves, edits or rejects it. When the
                    AI quotes a source, our code checks that the quote really appears in the text.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    04
                  </span>
                  <h3>The original is kept</h3>
                  <p>
                    We&rsquo;ll store the AI&rsquo;s first assessment unchanged, next to the version a person approved.
                    That record is our audit trail, and it will show us where the AI keeps getting things wrong.{" "}
                    <Link href="/admin/">See a preview of the review screen</Link>.
                  </p>
                </li>
              </ul>
            </MethodSection>

            <MethodSection
              id="credibility"
              number="05"
              label="Credibility guidelines"
              title={
                <>
                  Three scales for <em>sources</em>
                </>
              }
              intro="We rate each source on three separate scales and don't combine them into one score. A source can be independent and still weak, or affiliated and still careful, and keeping the scales apart lets you see which. Sources from the team's scouting database start out unrated, and their cards say Not rated yet until someone rates them."
            >
              <p className={styles.draftNote}>
                <DraftBadge />
                <span>
                  Draft categories are placeholders. The team and our mentor haven&rsquo;t signed off on them yet, so their
                  values may change in the next rubric version. We still show ratings made with them, marked as drafts.
                </span>
              </p>
              <div className={styles.enumList}>
                {CREDIBILITY_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} />
                ))}
              </div>
            </MethodSection>

            <MethodSection
              id="ratings"
              number="06"
              label="Rating rules"
              title={
                <>
                  The <em>scorecard&rsquo;s</em> rating scales
                </>
              }
              intro="Each technology page has a scorecard based on the team's proposal scorecard v0.1. Its summary gives a proposal six ratings: the alignment case, the Intelligence Curse case, human welfare risk, artificial-mind welfare and rights risk, governance risk and safeguard adequacy. Each rating says how confident we are and which claim it rests on."
            >
              {isDraftEnum("RiskRating") && (
                <p className={styles.draftNote}>
                  <DraftBadge />
                  <span>
                    The risk scale is a draft until the team sets its cutoffs during the pilot.
                  </span>
                </p>
              )}
              <div className={styles.enumList}>
                {RATING_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} />
                ))}
              </div>
              <p className={`${styles.callout} ${styles.calloutAi}`}>
                Only the whole brain emulation page has the team&rsquo;s full scorecard: scope, the causal chain, the
                evidence register, the alignment and Intelligence Curse assessments, artificial minds, and welfare and
                governance.
              </p>
            </MethodSection>

            <MethodSection
              id="categories"
              number="07"
              label="Other categories"
              title={
                <>
                  Other <em>categories</em> we use
                </>
              }
              intro="Everything we rate gets a value from a short list of named categories. The lists all live in one shared file, so changing a category takes a one-line edit and a version bump."
            >
              <div className={styles.enumList}>
                {otherEnums.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} />
                ))}
              </div>
            </MethodSection>

            <MethodSection
              id="versions"
              number="08"
              label="Versions"
              title={
                <>
                  Rubric and rule <em>versions</em>
                </>
              }
            >
              <div className={styles.version}>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Current rubric</span>
                  <span className={styles.versionValue}>v{RUBRIC_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  When a category changes, the rubric version goes up. Each AI assessment and each review records the
                  version it was made under, so you can always read an old rating against the rules in force at the time.
                  &ldquo;Draft&rdquo; in the version means some categories above are still placeholders.
                </p>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Current disagreement rule</span>
                  <span className={styles.versionValue}>v{DISAGREEMENT_RULE_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  Changing the {DISAGREEMENT_GAP_YEARS}-year threshold or the wording of the{" "}
                  <a href="#timeline">disagreement rule</a> bumps this version. The disagreement flags are recalculated
                  every time the site is built, so every stamp you see follows the current rule.
                </p>
              </div>
            </MethodSection>
          </div>
        </div>
      </div>
    </>
  );
}
