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
import { allEnumNames, isDraftEnum, RUBRIC_VERSION, type EnumName } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS, DISAGREEMENT_RULE_TEXT, DISAGREEMENT_RULE_VERSION } from "@/lib/estimates";
import type { Provenance } from "@/lib/types";

import { RuleSpecimens } from "./RuleSpecimens";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "The rules behind this site's marks, timeline and ratings, how new sources reach the site, and our credibility guidelines for sources.",
};

// Each section's heading is its label, with one word set in italics, so the
// contents list and the headings always say the same thing.
const SECTIONS = [
  { id: "reading", label: "How to read this site", em: "read" },
  { id: "marks", label: "The four marks", em: "marks" },
  { id: "stages", label: "The three stages", em: "stages" },
  { id: "timeline", label: "The timeline", em: "timeline" },
  { id: "pipeline", label: "How sources reach the site", em: "reach" },
  { id: "credibility", label: "Three scales for sources", em: "sources" },
  { id: "ratings", label: "The scorecard's rating scales", em: "rating" },
  { id: "categories", label: "Other categories", em: "categories" },
  { id: "versions", label: "Versions", em: "Versions" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// "How to read this site" with em "read" -> How to <em>read</em> this site
function emphasize(label: string, word: string): ReactNode {
  const index = label.indexOf(word);
  if (index === -1) {
    return label;
  }
  return (
    <>
      {label.slice(0, index)}
      <em>{word}</em>
      {label.slice(index + word.length)}
    </>
  );
}

// These three are the published credibility guidelines, so they get their own section.
const CREDIBILITY_GROUP: EnumName[] = ["Credibility", "Independence", "EvidenceType"];

// The scales the technology scorecards use, from the team's scorecard v0.1 rating rules.
const RATING_GROUP: EnumName[] = ["CaseRating", "RiskRating", "Confidence", "UnclearReason"];

// Shown in full in their own sections, so the category list skips them.
const SHOWN_ELSEWHERE: EnumName[] = ["Provenance", "Stage"];

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
  MilestoneCategory: { title: "Milestone category", note: "What kind of hurdle a milestone is." },
  MilestoneStatus: { title: "Milestone status" },
  Confidence: { note: "How sure we are of a rating or an estimate." },
  CaseRating: {
    title: "Positive-case rating",
    note: "How strong the case is that a technology helps. We rate the alignment case and the Intelligence Curse case separately.",
  },
  RiskRating: {
    title: "Risk rating",
    note: "Used for human welfare risk, artificial-mind welfare and rights risk, and governance risk. Each is judged in the scenario the proposal describes, weighing potential severity, who's exposed, reversibility and the safeguards available. A row that's still Unclear can also carry a “potentially high severity” warning. The warning isn't a rating, and the row stays Unclear.",
  },
  UnclearReason: { title: "Reason for Unclear", note: "Every Unclear rating names one of these." },
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
  TimeHorizon: { title: "Time horizon" },
};

function enumTitle(name: EnumName): string {
  return ENUM_COPY[name]?.title ?? enumTitleFromName(name);
}

// The four marks in the order the legend uses, for the first bullet.
const MARK_ORDER: Provenance[] = ["source", "team", "ai", "unclear"];

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
    text: "Once a person checks the line, the dashed outline stays and the label names who checked it.",
  },
  {
    kind: "unclear",
    text: "The reason always comes from the list under the scorecard's rating scales below.",
  },
];

// How a new paper gets from a research database onto this site, as it runs today.
const PIPELINE_STEPS = [
  {
    title: "A weekly search",
    text: "Every Monday a script searches arXiv and Semantic Scholar for new papers on these proposals. The team can also start it by hand from the admin.",
  },
  {
    title: "AI triage, when it's switched on",
    text: "When the pipeline has an Anthropic API key, an AI model reads each paper's title and abstract, suggests whether it's relevant and how to tag it, and quotes the lines it relied on. Our code checks that each quote really appears in the paper. Without a key, papers wait for review untriaged.",
  },
  {
    title: "A person reviews every paper",
    text: "Someone on the team approves, edits or rejects each one. The AI can't approve a paper or put anything on the site.",
  },
  {
    title: "The AI's first answer is kept",
    text: "Its original assessment is stored unchanged next to the reviewer's final version. That record shows us where the AI keeps getting things wrong.",
  },
  {
    title: "Publishing",
    text: "Approved sources appear on this site the next time the team publishes it.",
  },
];

function MethodSection({ id, number, intro, children }: { id: SectionId; number: number; intro?: ReactNode; children: ReactNode }) {
  let title: ReactNode = id;
  for (const section of SECTIONS) {
    if (section.id === id) {
      title = emphasize(section.label, section.em);
    }
  }
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <SectionHead
        id={`${id}-heading`}
        eyebrow={String(number).padStart(2, "0")}
        title={title}
        intro={intro}
        size="compact"
      />
      {children}
    </section>
  );
}

// A <details> with a quiet one-line summary, for the parts most readers skip.
function More({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className={styles.more}>
      <summary className={styles.moreSummary}>
        {summary}
        <span className={styles.moreChevron} aria-hidden="true" />
      </summary>
      <div className={styles.moreBody}>{children}</div>
    </details>
  );
}

export default function MethodologyPage() {
  const otherEnums: EnumName[] = [];
  for (const name of allEnumNames()) {
    if (!CREDIBILITY_GROUP.includes(name) && !RATING_GROUP.includes(name) && !SHOWN_ELSEWHERE.includes(name)) {
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
        lede="What each mark, ribbon and rating on the site means, and how we decide on it. This page is also our rubric and our credibility guidelines."
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
            <MethodSection id="reading" number={1}>
              <ol className={styles.readingList}>
                <li>
                  <p>Every research claim carries one of four marks, each with its own glyph and line style.</p>
                  <p className={styles.inlineKey}>
                    {MARK_ORDER.map((kind) => (
                      <ProvenanceTag key={kind} kind={kind} plain />
                    ))}
                  </p>
                </li>
                <li>
                  <p>
                    Every milestone sits in one of three stages. On the timeline, color shows the stage and nothing
                    else.
                  </p>
                  <div className={styles.inlineKey}>
                    <StageLegend />
                  </div>
                </li>
                <li>
                  <p>
                    We never average forecasts into one date. Each one is shown on its own with who made it, when, and
                    the exact quote, and a team range never hides them.
                  </p>
                </li>
                <li>
                  <p>
                    When two forecasts for the same milestone are more than {DISAGREEMENT_GAP_YEARS} years apart, or
                    one says it will never happen, the milestone gets a <Stamp size="sm" /> stamp.
                  </p>
                </li>
                <li>
                  <p>
                    Unclear means we can&rsquo;t make a responsible call yet. It always gives a reason, such as no
                    relevant evidence, conflicting evidence, a proposal too vague to assess, or a search we
                    haven&rsquo;t finished.
                  </p>
                </li>
              </ol>
            </MethodSection>

            <MethodSection
              id="marks"
              number={2}
              intro="Claims in milestones, forecasts, source summaries and scorecards all carry a mark. The glyphs and line styles keep the four apart even in black and white."
            >
              <div className={styles.legendWrap}>
                <ProvenanceLegend />
              </div>
              <More summary="More on each mark">
                <dl className={styles.explainers}>
                  {PROVENANCE_EXPLAINERS.map((item) => (
                    <div key={item.kind} className={styles.explainer}>
                      <dt>
                        <ProvenanceTag kind={item.kind} plain />
                      </dt>
                      <dd>{item.text}</dd>
                    </div>
                  ))}
                </dl>
                <p className={`${styles.callout} ${styles.calloutAi}`}>
                  Nothing AI-written goes on the site until a person has checked it, with one exception while the site
                  is a draft: the brain computer interface and neuromorphic AI pages are AI drafts the team
                  hasn&rsquo;t reviewed. They say so, and so does every excerpt from them elsewhere on the site, like
                  the cards on the home page.
                </p>
              </More>
            </MethodSection>

            <MethodSection
              id="stages"
              number={3}
              intro="Each stage asks a different question: can it be done, can people get it, and does it help? Claims about brain tech often run these together. Every milestone gets exactly one stage."
            >
              <StageCards compact />
            </MethodSection>

            <MethodSection
              id="timeline"
              number={4}
              intro="Each milestone sits on the track at the years it's expected, if anyone has said. What it's drawn with depends on the estimates we have, and forecasts are never merged into one date."
            >
              <RuleSpecimens />

              <ul className={styles.ruleList}>
                <li>
                  A milestone with forecasts says how many and from how many sources, so you can tell a well-studied
                  milestone from a single guess.
                </li>
                <li>
                  If a forecast&rsquo;s window has passed and the milestone hasn&rsquo;t happened, its line fades and
                  it&rsquo;s counted separately.
                </li>
              </ul>

              <More
                summary={
                  <>
                    The disagreement rule in full
                    <span className={styles.moreMeta}>v{DISAGREEMENT_RULE_VERSION}</span>
                  </>
                }
              >
                <p className={styles.ruleThreshold}>
                  Threshold: <span className="mono">{DISAGREEMENT_GAP_YEARS} years</span>
                </p>
                <ol className={styles.ruleSteps}>
                  {DISAGREEMENT_RULE_TEXT.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              </More>
            </MethodSection>

            <MethodSection id="pipeline" number={5}>
              <ol className={styles.pipeline}>
                {PIPELINE_STEPS.map((step, index) => (
                  <li key={step.title} className={styles.pipelineStep}>
                    <span className={styles.pipelineNumber} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className={styles.pipelineTitle}>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </MethodSection>

            <MethodSection
              id="credibility"
              number={6}
              intro="We rate credibility, independence and evidence type separately and never combine them into one score. A source can be independent and still weak, or affiliated and still careful. Sources from the team's scouting database start out unrated, and a category marked Draft may still change."
            >
              <div className={styles.enumList}>
                {CREDIBILITY_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} collapsible />
                ))}
              </div>
            </MethodSection>

            <MethodSection
              id="ratings"
              number={7}
              intro={`Each technology page's scorecard gives six ratings: the alignment case, the Intelligence Curse case, human welfare risk, artificial-mind welfare and rights risk, governance risk and safeguard adequacy. Each one says how confident we are and what it rests on.${isDraftEnum("RiskRating") ? " The risk scale is a draft until the team sets its cutoffs." : ""}`}
            >
              <div className={styles.enumList}>
                {RATING_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} collapsible />
                ))}
              </div>
              <div className={styles.placeholder}>
                <p className={styles.placeholderTitle}>How we handle uncertain moral status</p>
                <p>The team hasn&rsquo;t written this section yet.</p>
              </div>
            </MethodSection>

            <MethodSection
              id="categories"
              number={8}
              intro="Everything else we tag, from technology and milestone category to source type and claim direction, gets a value from a short named list. The lists live in one shared file, so changing one is a small edit and a new rubric version."
            >
              <More summary={`All ${otherEnums.length} categories`}>
                <div className={styles.enumList}>
                  {otherEnums.map((name) => (
                    <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} collapsible />
                  ))}
                </div>
              </More>
            </MethodSection>

            <MethodSection id="versions" number={9}>
              <div className={styles.version}>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Current rubric</span>
                  <span className={styles.versionValue}>v{RUBRIC_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  When a category changes, the rubric version goes up. Each AI assessment and each review records the
                  version it was made under, so an old rating can always be read against the rules at the time.
                  Categories marked <DraftBadge /> are still being decided, which is what &ldquo;draft&rdquo; in the
                  version number means.
                </p>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Disagreement rule</span>
                  <span className={styles.versionValue}>v{DISAGREEMENT_RULE_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  Changing the {DISAGREEMENT_GAP_YEARS}-year threshold or the wording of the{" "}
                  <a href="#timeline">disagreement rule</a> bumps this version. The stamps are worked out again every
                  time the site is built, so every one you see follows the current rule.
                </p>
              </div>
              <p className={styles.contactLine}>
                If you think a rule here is wrong, <Link href="/contact/">tell us</Link>.
              </p>
            </MethodSection>
          </div>
        </div>
      </div>
    </>
  );
}
