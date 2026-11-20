import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { EnumDefinitions, enumTitleFromName, type EnumGroup } from "@/components/common/EnumDefinitions";
import { DraftBadge } from "@/components/common/Marks";
import { OpenDetailsOnHash } from "@/components/common/OpenDetailsOnHash";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { StageCards } from "@/components/common/StageCards";
import { Stamp } from "@/components/common/Stamp";
import { TypeMark } from "@/components/common/TypeMark";
import { ProvenanceLegend, StageLegend, TypeLegend } from "@/components/provenance/Legends";
import { ProvenanceTag } from "@/components/provenance/ProvenanceTag";
import { buildCodeIndex } from "@/lib/codes";
import { getScorecard, getSources, getTechnologies } from "@/lib/data";
import { allEnumNames, enumValues, milestoneTypes, RUBRIC_VERSION, type EnumName } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS, DISAGREEMENT_RULE_TEXT, DISAGREEMENT_RULE_VERSION } from "@/lib/estimates";
import { realSources, toSourceRef } from "@/lib/sources";
import type { CodebookRow, Provenance, TechnologyPage } from "@/lib/types";

import { CodebookFolds, OverviewItems } from "./Codebook";
import { codebookDescriptions, codebookRuns, runIdForType, type CodebookRun } from "./codebookModel";
import { MethodologyToc } from "./MethodologyToc";
import { RuleSpecimens } from "./RuleSpecimens";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "The rules behind this site's marks, timeline and ratings, how new sources reach the site, and our credibility guidelines for sources.",
};

// Each section's heading is its label, with one word set in italics, so the
// contents list and the headings always say the same thing. The order here
// gives each section its number in both places.
const SECTIONS = [
  { id: "reading", label: "How to read this site", em: "read" },
  { id: "marks", label: "The marks", em: "marks" },
  { id: "stages", label: "The three stages", em: "stages" },
  { id: "timeline", label: "The timeline", em: "timeline" },
  { id: "pipeline", label: "How sources reach the site", em: "reach" },
  { id: "credibility", label: "Three scales for sources", em: "sources" },
  { id: "ratings", label: "The scorecard's rating scales", em: "rating" },
  { id: "new-sources", label: "How new sources move through the scorecard", em: "move" },
  { id: "scorecard-timeline", label: "How the scorecard feeds the timeline", em: "feeds" },
  // Vilija's codes, terms and rules. The id stays "codebook" so every
  // existing #codebook link still lands here.
  { id: "codebook", label: "Definitions", em: "Definitions" },
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

// The scales the technology scorecards use. Since workbook v0.4 the three
// case rows take a CaseRating and the three risk rows a Severity and a
// Likelihood. UnclearReason stays here because the unclear mark's
// explainer in section 02 points to it.
const RATING_GROUP: EnumName[] = ["CaseRating", "Severity", "Likelihood", "Confidence", "UnclearReason"];

// Not listed in "Other categories". Provenance and Stage have sections of
// their own. The workbook's scales come from the Definitions section (id
// "codebook"; directness and evidence status are defined there word for word)
// or are plain labels on the technology and evidence pages with no definition
// to show; Severity and Likelihood are also in the rating scales above.
const SHOWN_ELSEWHERE: EnumName[] = [
  "Provenance",
  "Stage",
  "EvidenceDirectness",
  "EvidenceRole",
  "EvidenceBasis",
  "EvidenceStatus",
  "Severity",
  "Likelihood",
  "RiskLevel",
  "RiskDomain",
  "GovernanceStatus",
  "AgencyEffect",
];

// Still in enums.json for older records, but no rating has used it since the
// risk rows switched to severity and likelihood (workbook v0.4), so the page
// doesn't list it.
const RETIRED: EnumName[] = ["RiskRating"];

// Hand-written titles and notes. Any category added to enums.py later still
// shows up below, with a title made from its name.
const ENUM_COPY: Partial<Record<EnumName, { title?: string; note?: ReactNode }>> = {
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
  Severity: {
    note: "How bad each risk would be: human welfare risk, artificial-mind welfare and rights risk, and governance risk. A risk's severity, likelihood and confidence are kept separate and never combined into one rating.",
  },
  Likelihood: { note: "How likely each risk is." },
  UnclearReason: { title: "Reason for Unclear", note: "What an Unclear mark gives as its reason." },
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
  TimeHorizon: {
    title: "Time horizon",
    note: (
      <>
        Provisional bands for these are in the <a href="#codebook">Definitions</a> section.
      </>
    ),
  },
};

function enumTitle(name: EnumName): string {
  return ENUM_COPY[name]?.title ?? enumTitleFromName(name);
}

// The milestone categories under their three types (Technical, Deployment,
// and Welfare and governance), for the category's definitions below.
function milestoneCategoryGroups(): EnumGroup[] {
  const groups: EnumGroup[] = [];
  for (const info of milestoneTypes()) {
    groups.push({ id: info.value, title: <TypeMark type={info} announce={false} />, values: info.categories });
  }
  return groups;
}

// The meanings of a rating scale's values from the Codebook rows of one type,
// with a line under the scale that links to those rows in the Definitions
// section. Values the Codebook doesn't define keep the site's wording. With
// no matching rows, nothing changes and there is no line. Each meaning starts
// with a capital letter, since it begins a line of its own: the Confidence
// cell's parts ("High: multiple robust sources, ...") show as "Multiple
// robust sources, ...", the same as in the technology pages' grading key.
// Display only: the data keeps the cell as written.
function fromCodebook(
  name: EnumName,
  codebookType: string,
  rows: CodebookRow[],
  runs: CodebookRun[],
): { descriptions?: Record<string, string>; footer?: ReactNode } {
  const descriptions: Record<string, string> = {};
  for (const [value, text] of Object.entries(codebookDescriptions(rows, codebookType, enumValues(name)))) {
    descriptions[value] = text.charAt(0).toUpperCase() + text.slice(1);
  }
  const runId = runIdForType(runs, codebookType);
  if (Object.keys(descriptions).length === 0 || runId === null) {
    return {};
  }
  return {
    descriptions,
    footer: (
      <>
        Defined in full under <a href={`#${runId}`}>Definitions</a>.
      </>
    ),
  };
}

// "brain-computer interfaces" -> "brain-computer interface", for a name used
// before a noun ("the brain-computer interface pages"), as the home page does.
// A name that doesn't end in a plural s ("neuromorphic AI") stays as it is.
function beforeNoun(name: string): string {
  return name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name;
}

// "brain-computer interface and neuromorphic AI": the pages that still have
// sections an AI drafted and nobody has reviewed, named to go before "pages".
function unreviewedPageNames(technologies: TechnologyPage[]): string {
  const names: string[] = [];
  for (const tech of technologies) {
    if (tech.unreviewed_ai_sections) {
      names.push(beforeNoun(tech.name.charAt(0).toLowerCase() + tech.name.slice(1)));
    }
  }
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The marks in the order the legend uses, for the first bullet. The team's
// own claims carry no mark, so they aren't listed.
const MARK_ORDER: Provenance[] = ["source", "ai", "unclear"];

const PROVENANCE_EXPLAINERS: { kind: Provenance; text: string }[] = [
  {
    kind: "source",
    text: "The quote is 300 characters at most and links to the source, so you can check it yourself.",
  },
  {
    kind: "ai",
    text: "A checked line keeps its dashed mark, and the tag names who checked it.",
  },
  {
    kind: "unclear",
    text: "The reason always comes from the list under the scorecard's rating scales below.",
  },
];

// Whether the weekly run has AI triage switched on. The site is built without
// the pipeline's settings, so it can't tell: set this to true once the team
// confirms the pipeline has its Anthropic API key.
const AI_TRIAGE_IS_ON = false;

const AI_TRIAGE_STEP = AI_TRIAGE_IS_ON
  ? {
      title: "AI triage",
      text: "An AI model reads each paper's title and abstract, suggests whether it's relevant and how to tag it, and quotes the lines it relied on. Our code checks that each quote really appears in the paper.",
    }
  : {
      title: "AI triage, once it's switched on",
      text: "An AI model will read each paper's title and abstract, suggest whether it's relevant and how to tag it, and quote the lines it relied on. Our code will check that each quote really appears in the paper. Until then, papers go straight to review.",
    };

// How a new paper gets from a research database onto this site, as it runs today.
const PIPELINE_STEPS = [
  {
    title: "A weekly search",
    text: "Every Monday a script searches arXiv and Semantic Scholar for new papers on these proposals.",
  },
  AI_TRIAGE_STEP,
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

function MethodSection({ id, intro, children }: { id: SectionId; intro?: ReactNode; children: ReactNode }) {
  // Numbered by its place in SECTIONS, like the contents list, so adding a
  // section renumbers the ones after it.
  let number = 0;
  let title: ReactNode = id;
  SECTIONS.forEach((section, index) => {
    if (section.id === id) {
      number = index + 1;
      title = emphasize(section.label, section.em);
    }
  });
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
// With an id, a link to it opens it (see OpenDetailsOnHash).
// A link to something inside, like a category under "All 10 categories", makes
// the browser open it before React starts up, so it no longer matches the
// server HTML. React never sets `open` here, so suppressHydrationWarning only
// stops the dev warning about that attribute.
function More({ id, summary, children }: { id?: string; summary: ReactNode; children: ReactNode }) {
  return (
    <details id={id} className={styles.more} suppressHydrationWarning>
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
    if (
      !CREDIBILITY_GROUP.includes(name) &&
      !RATING_GROUP.includes(name) &&
      !SHOWN_ELSEWHERE.includes(name) &&
      !RETIRED.includes(name)
    ) {
      otherEnums.push(name);
    }
  }

  const scorecard = getScorecard();
  const workbook = scorecard.workbook;
  const codebook = scorecard.codebook ?? [];
  const runs = codebookRuns(codebook);
  // Where the workbook's codes link, built from the published sources only.
  const codeIndex = buildCodeIndex(scorecard, realSources(getSources()).map(toSourceRef));
  // The case rating and confidence scales take their meanings from the
  // Codebook's "Rating" and "Confidence" rows where it gives them.
  const ratingCopy: Partial<Record<EnumName, ReturnType<typeof fromCodebook>>> = {
    CaseRating: fromCodebook("CaseRating", "Rating", codebook, runs),
    Confidence: fromCodebook("Confidence", "Confidence", codebook, runs),
  };
  const unreviewed = unreviewedPageNames(getTechnologies());

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
        <span className={styles.chips}>
          {workbook.version && <span className="chip">Scorecard v{workbook.version}</span>}
          <span className="chip">Pipeline rubric v{RUBRIC_VERSION}</span>
        </span>
      </PageHeader>

      <OpenDetailsOnHash />
      <div className="container">
        <div className={styles.layout}>
          <MethodologyToc sections={SECTIONS} />

          <div className={styles.content}>
            <MethodSection id="reading">
              <ol className={styles.readingList}>
                <li>
                  <p>Some claims carry one of these marks, each with its own glyph and line style.</p>
                  <p className={styles.inlineKey}>
                    {MARK_ORDER.map((kind) => (
                      <ProvenanceTag key={kind} kind={kind} plain />
                    ))}
                  </p>
                </li>
                <li>
                  <p>
                    Every milestone sits in one of three stages. On the timeline, colour shows the stage and nothing
                    else.
                  </p>
                  <div className={styles.inlineKey}>
                    <StageLegend />
                  </div>
                </li>
                <li>
                  <p>Every milestone also has one of three types, set by its category.</p>
                  <div className={styles.inlineKey}>
                    <TypeLegend />
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
                    one says it will never happen, the milestone gets a{" "}
                    <span className={styles.inlineStamp}>
                      <Stamp size="sm" />
                    </span>{" "}
                    stamp.
                  </p>
                </li>
                <li>
                  <p>
                    Unclear means we can&rsquo;t make a responsible call yet. Every Unclear rating on a scorecard
                    comes with the reason for it.
                  </p>
                </li>
              </ol>
            </MethodSection>

            <MethodSection
              id="marks"
              intro="Claims in milestones, forecasts, source summaries and scorecards can carry one of these marks."
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
                {/* Built from the pages' unreviewed_ai_sections flag, so it stays
                    true as the team reviews them. */}
                <p className={`${styles.callout} ${styles.calloutAi}`}>
                  {unreviewed
                    ? `Nothing AI-written goes on the site until a person has checked it, with one exception while the site is a draft: some sections of the ${unreviewed} pages are AI drafts the team hasn’t reviewed yet. Each of those sections has the AI-suggested mark.`
                    : "Nothing AI-written goes on the site until a person has checked it."}
                </p>
              </More>
            </MethodSection>

            <MethodSection
              id="stages"
              intro="Each stage asks a different question: can it be done, can people get it, and does it help? Claims about brain tech often run these together. Every milestone gets exactly one stage."
            >
              <StageCards compact />
            </MethodSection>

            <MethodSection
              id="timeline"
              intro="Each milestone sits on the track at the years it's expected, if anyone has said. What it's drawn with depends on the estimates we have."
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
                id="disagreement-rule"
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

            <MethodSection id="pipeline">
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
              intro="We rate credibility, independence and evidence type separately and never combine them into one score. A source can be independent and still weak, or affiliated and still careful. Every source starts out unrated."
            >
              <div className={styles.enumList}>
                {CREDIBILITY_GROUP.map((name) => (
                  <EnumDefinitions key={name} name={name} title={enumTitle(name)} note={ENUM_COPY[name]?.note} collapsible />
                ))}
              </div>
            </MethodSection>

            <MethodSection
              id="ratings"
              intro={
                <>
                  Each technology page&rsquo;s scorecard rates the alignment case, the Intelligence Curse case and
                  safeguard adequacy on the first scale below. Human welfare risk, artificial-mind welfare and rights
                  risk, and governance risk each get a severity and a likelihood instead. The full rules are under{" "}
                  <a href="#codebook">Definitions</a>.
                </>
              }
            >
              <div className={styles.enumList}>
                {RATING_GROUP.map((name) => (
                  <EnumDefinitions
                    key={name}
                    name={name}
                    title={enumTitle(name)}
                    note={ENUM_COPY[name]?.note}
                    descriptions={ratingCopy[name]?.descriptions}
                    footer={ratingCopy[name]?.footer}
                    collapsible
                  />
                ))}
              </div>
              <div className={styles.placeholder}>
                <p className={styles.placeholderTitle}>How we handle uncertain moral status</p>
                <p>The team hasn&rsquo;t written this section yet.</p>
              </div>
            </MethodSection>

            {/* Site text adapted from the workbook's update protocol, so a
                reader who never sees the workbook can follow it. The import
                still stores overview.update_protocol, but the page no longer
                prints it. */}
            <MethodSection id="new-sources" intro="What we do each time a new source comes in.">
              <ol className={styles.readingList}>
                <li>
                  <p>
                    Add the source to the <Link href="/sources/">source database</Link> and rate its quality.
                  </p>
                </li>
                <li>
                  <p>
                    Record each relevant claim from it as one entry in the{" "}
                    <Link href="/evidence/">evidence register</Link>, with its scenarios, stage, directness, role and
                    basis.
                  </p>
                </li>
                <li>
                  <p>
                    Link each entry to the causal links, milestones, risks or governance checklist items it bears on.
                  </p>
                </li>
                <li>
                  <p>
                    Recheck the evidence status of each linked item with the status rule (see{" "}
                    <a href="#codebook">Definitions</a>), and check whether the source answers the strongest objection
                    to a causal link or raises a new one.
                  </p>
                </li>
                <li>
                  <p>
                    Decide whether the evidence so far changes a rating or our confidence in it, using the rating rules
                    (see <a href="#codebook">Definitions</a>). If it does, update the rating, the reason given for it,
                    and the ratings each entry informs.
                  </p>
                </li>
              </ol>
            </MethodSection>

            <MethodSection id="scorecard-timeline">
              {/* Placeholder: the workbook has no text on this yet. Replace the note with the team's text. */}
              <div className={styles.placeholder}>
                <p>The team hasn&rsquo;t written this section yet.</p>
              </div>
            </MethodSection>

            <MethodSection id="codebook" intro="The codes, terms and rules the scorecards use, as Vilija defined them.">
              <OverviewItems
                overview={scorecard.overview ?? null}
                scopeNotes={scorecard.scope_notes ?? []}
                index={codeIndex}
              />
              <CodebookFolds runs={runs} frameworks={scorecard.frameworks ?? []} index={codeIndex} />
            </MethodSection>

            <MethodSection
              id="categories"
              intro="Everything else we tag, from technology and milestone category to source type and claim direction, gets a value from a short named list."
            >
              <More summary={`All ${otherEnums.length} categories`}>
                <div className={styles.enumList}>
                  {otherEnums.map((name) => (
                    <EnumDefinitions
                      key={name}
                      name={name}
                      title={enumTitle(name)}
                      note={ENUM_COPY[name]?.note}
                      groups={name === "MilestoneCategory" ? milestoneCategoryGroups() : undefined}
                      collapsible
                    />
                  ))}
                </div>
              </More>
            </MethodSection>

            <MethodSection id="versions">
              <div className={styles.version}>
                {workbook.version && (
                  <>
                    <p className={styles.versionNumber}>
                      <span className="eyebrow">Scorecard</span>
                      <span className={styles.versionValue}>v{workbook.version}</span>
                    </p>
                    <p className={styles.versionText}>
                      The scorecards on the technology pages and the <a href="#codebook">definitions</a> above follow
                      this version of our scoring rules. The definitions and rules change only with a new version.
                    </p>
                  </>
                )}
                {/* RUBRIC_VERSION is stamped on pipeline and review records,
                    so it stays separate from the workbook's version. */}
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Pipeline rubric</span>
                  <span className={styles.versionValue}>v{RUBRIC_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  The categories the weekly pipeline and the team&rsquo;s source reviews use. Each AI assessment and
                  each review records the rubric version it was made under, so an old one can always be read against
                  the rules at the time. Categories marked <DraftBadge /> are still being decided, which is what
                  &ldquo;draft&rdquo; in the version number means.
                </p>
                <p className={styles.versionNumber}>
                  <span className="eyebrow">Disagreement rule</span>
                  <span className={styles.versionValue}>v{DISAGREEMENT_RULE_VERSION}</span>
                </p>
                <p className={styles.versionText}>
                  Changing the {DISAGREEMENT_GAP_YEARS}-year threshold or the wording of the{" "}
                  <a href="#disagreement-rule">disagreement rule</a> bumps this version. Every stamp you see follows the
                  current rule.
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
