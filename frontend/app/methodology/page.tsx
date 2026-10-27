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
    "How to read this site, how the timeline draws uncertainty, what the AI is allowed to do, and every category we use to rate sources, including our credibility guidelines.",
};

const SECTIONS = [
  { id: "reading", label: "How to read this site" },
  { id: "stages", label: "The three stages" },
  { id: "timeline", label: "Timeline rules" },
  { id: "ai", label: "The AI's role" },
  { id: "credibility", label: "Credibility guidelines" },
  { id: "ratings", label: "Rating rules" },
  { id: "categories", label: "Every other category" },
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
    note: "How far a source's claims can be trusted, judged on its methods and on whether the claims match the evidence. Kept separate from venue: a peer-reviewed paper can be weak and a blog post can be strong. Unclear always comes with a reason.",
  },
  Independence: {
    title: "Source independence",
    note: "Whether the author or funder has a stake in the result. Rated on its own, so an affiliated source can still be credible.",
  },
  EvidenceType: {
    note: "What kind of support a source offers. An argument and an experiment can both matter, but they matter differently.",
  },
  Technology: { title: "Technology family" },
  Problem: { title: "Problem addressed" },
  Stage: { note: "The only thing color means on the timeline." },
  MilestoneCategory: { title: "Milestone category", note: "What kind of hurdle a milestone is." },
  MilestoneStatus: { title: "Milestone status" },
  Confidence: { note: "How sure we are of a rating or an estimate." },
  CaseRating: {
    title: "Positive-case rating",
    note: "How strong the case is that a technology helps, for the alignment case and the Intelligence Curse case. Not claimed is not the same as weak or unclear.",
  },
  RiskRating: {
    title: "Risk rating",
    note: "We weigh how bad the harm could be, who's exposed, whether it can be undone and what safeguards exist. Thresholds are still being set, and we never rate a risk low just because nobody has studied it.",
  },
  UnclearReason: { title: "Reason for unclear", note: "Every Unclear rating names one of these." },
  Directness: { title: "Directness to scenario" },
  SourceType: { title: "Source type" },
  SourceKind: {
    title: "Source kind",
    note: "Arguments are rare and valuable; technical progress is plentiful. Keeping them apart stops one from drowning out the other.",
  },
  Relevance: { note: "Placeholder values until the team agrees on them." },
  TimeHorizon: { title: "Time horizon", note: "Definitions still to be agreed." },
  Provenance: { note: "Every research claim on the site carries one of these." },
};

function enumTitle(name: EnumName): string {
  return ENUM_COPY[name]?.title ?? enumTitleFromName(name);
}

const PROVENANCE_EXPLAINERS: { kind: Provenance; text: string }[] = [
  {
    kind: "source",
    text: "Taken straight from a source we cite. You get the exact quote (300 characters at most) and a link, so you can check it yourself.",
  },
  {
    kind: "team",
    text: "Our interpretation. It's marked so you can tell it apart from what a source actually says. If you read the evidence differently, tell us.",
  },
  {
    kind: "ai",
    text: "Suggested by an AI model. It names the person who checked it, or says “not yet reviewed” if nobody has. In this draft, that's every AI line on the technology pages.",
  },
  {
    kind: "unclear",
    text: "We genuinely don't know, and we say why. The reason is always one of a short, fixed list:",
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
            How we decide <em>what to say</em>
          </>
        }
        lede="The rules behind every mark, bar and rating on this site. This page doubles as our rubric and our credibility guidelines, and it changes in versions you can see."
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
                  Four kinds of <em>content</em>, always marked
                </>
              }
              intro="Every research claim on this site, from milestones and forecasts to sources and scorecards, carries one of four marks. They look different even in black and white, so you never have to guess whether you're reading a source, us, an AI or an open question."
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
                <strong>Once the site launches, nothing AI-written goes live unchecked.</strong> In this draft the technology
                pages are AI-written outlines the team hasn&rsquo;t reviewed yet, so each line says &ldquo;not yet
                reviewed&rdquo;. Once a person checks a line, the dashed outline stays on and their name replaces that
                note.
              </p>
            </MethodSection>

            <MethodSection
              id="stages"
              number="02"
              label="The three stages"
              title={
                <>
                  Three stages, <em>three different questions</em>
                </>
              }
              intro="Can it be done, can people get it, and does it help? Claims about brain tech often blur these. Every milestone on the timeline is tagged with exactly one of them, and stage is the only thing color means there."
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
              intro="We never collapse conflicting forecasts into one precise date. Each milestone gets at most one bar, and what that bar means depends on what we have."
            >
              <RuleSpecimens />

              <ul className={styles.ruleList}>
                <li>
                  <strong>Every forecast is drawn, always.</strong> Each one is its own whisker, and the panel says who
                  made it, when, the window they gave and the exact quote.
                </li>
                <li>
                  <strong>The team range wins, but hides nothing.</strong> When the team sets a range, it comes with a
                  written basis, and the forecasts and any disagreement stay visible next to it.
                </li>
                <li>
                  <strong>
                    &ldquo;N forecasts from M sources&rdquo;
                  </strong>{" "}
                  appears whenever there&rsquo;s at least one forecast, so you can tell a well-studied milestone from one
                  that rests on a single guess.
                </li>
                <li>
                  <strong>Old forecasts fade.</strong> If a forecast&rsquo;s window has passed and the milestone
                  hasn&rsquo;t happened, it&rsquo;s greyed out and counted separately.
                </li>
                <li>
                  <strong>Done is a point.</strong> A milestone that has happened is marked at the year it happened.
                </li>
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
              intro="Soon an AI will help us keep up with new research. It won't decide anything on its own. For now, the team adds sources by hand."
            >
              <ul className={styles.aiGrid}>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    01
                  </span>
                  <h3>Finds and triages</h3>
                  <p>
                    Once the pipeline is running, a weekly script will search research databases, and an AI model will read
                    titles and abstracts to sort likely-relevant papers from the noise.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    02
                  </span>
                  <h3>Never publishes</h3>
                  <p>
                    The AI can&rsquo;t approve a source, edit the timeline or put anything on this site. Only a person can.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    03
                  </span>
                  <h3>Every suggestion gets reviewed</h3>
                  <p>
                    A team member checks each one against the source and approves, edits or rejects it. If the AI cites a
                    quote, code checks that the quote is really in the text. The technology pages are the exception in
                    this draft: they&rsquo;re AI-written outlines nobody has checked yet, and every line says so.
                  </p>
                </li>
                <li className={styles.aiItem}>
                  <span className={styles.aiMark} aria-hidden="true">
                    04
                  </span>
                  <h3>The original is kept</h3>
                  <p>
                    The AI&rsquo;s first assessment will be stored untouched, next to the human version. That&rsquo;s our
                    audit trail, and it will show us where the AI is consistently wrong.{" "}
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
                  Credibility <em>guidelines</em>
                </>
              }
              intro="We rate sources on three separate scales instead of one score. A source can be independent and still weak, or affiliated and still careful, and you should be able to see each part."
            >
              <p className={styles.draftNote}>
                <DraftBadge />
                <span>
                  Draft categories are placeholders. The team and our mentor haven&rsquo;t signed off on them yet, so their
                  values may change in the next rubric version. Ratings made with them are still shown, and still marked.
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
                  Five ratings, <em>one scorecard</em>
                </>
              }
              intro="Each technology page has a scorecard. It follows the team's proposal scorecard v0.1, which sums a proposal up in five ratings: the alignment case, the Intelligence Curse case, welfare risk, governance risk and safeguard adequacy. Each rating comes with how confident we are and the claim it rests on, and an Unclear rating always names its reason."
            >
              {isDraftEnum("RiskRating") && (
                <p className={styles.draftNote}>
                  <DraftBadge />
                  <span>
                    Risk thresholds are still being set during the pilot, so the risk scale is a draft for now.
                  </span>
                </p>
              )}
              <div className={styles.enumList}>
                {RATING_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} />
                ))}
              </div>
            </MethodSection>

            <MethodSection
              id="categories"
              number="07"
              label="Every other category"
              title={
                <>
                  Categories, <em>not scores</em>
                </>
              }
              intro="Everything we rate uses a short, named list of values instead of a number. Each list lives in one shared file, so changing a category is a one-line edit and a version bump."
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
                  Every change gets <em>a version</em>
                </>
              }
            >
              <div className={styles.version}>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Current rubric</span>
                  <span className={styles.versionValue}>v{RUBRIC_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  When a category changes, the rubric version goes up. Every AI assessment and every review records the
                  version it was made under, so an old rating can always be read against the rules that produced it.
                  &ldquo;Draft&rdquo; in the version means some categories above are still placeholders.
                </p>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Current disagreement rule</span>
                  <span className={styles.versionValue}>v{DISAGREEMENT_RULE_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  Changing the {DISAGREEMENT_GAP_YEARS}-year threshold or the wording of the{" "}
                  <a href="#timeline">disagreement rule</a> bumps this version. Flags are worked out again every time
                  the site is built, so every stamp you see follows the current rule.
                </p>
              </div>
            </MethodSection>
          </div>
        </div>
      </div>
    </>
  );
}
