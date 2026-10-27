import Link from "next/link";
import type { ReactNode } from "react";

import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceLegend } from "@/components/provenance/Legends";
import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import { getMilestones, getSiteData, getSources } from "@/lib/data";
import { isDraftEnum } from "@/lib/enums";
import { sourceRefsById, sourceRefsByRegisterId, type SourceRef } from "@/lib/sources";
import type { Claim, ScorecardRow, TechnologyPage } from "@/lib/types";

import { EmphasisText } from "./EmphasisText";
import { EvidenceRegister } from "./EvidenceRegister";
import { MilestonePath } from "./MilestonePath";
import { hasSeverityFlag, Scorecard } from "./Scorecard";
import {
  AssessmentView,
  CausalChain,
  ChainBreaks,
  EvidenceGap,
  MindsGrid,
  ScopeSheet,
  WelfareSheet,
} from "./ScorecardSections";
import { nextTechnology, requireTechnology, technologyNumber, type TechnologyId } from "./technologyData";
import styles from "./TechnologyPageView.module.css";

type Sources = Record<string, SourceRef>;

// One in-page section. The side nav, the section numbers and the sections
// themselves all come from the same list, so they can't drift apart.
interface SectionSpec {
  id: string;
  label: string; // the side nav entry
  kicker: string;
  title: ReactNode; // the h2, with its one italic word in <em>
  body: ReactNode;
}

interface SectionContext {
  technology: TechnologyPage;
  sources: Sources;
  // The same sources keyed by register id ("S02"), for the evidence register.
  sourcesByRegisterId: Sources;
  items: TimelineItem[];
}

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

// The outline fields are optional now, so a missing list is an empty one.
function listOf<T>(items: T[] | undefined): T[] {
  return items ?? [];
}

// True when the page carries any part of the team's populated scorecard.
// Those pages get the scorecard layout; the rest keep the outline layout.
function hasPopulatedScorecard(technology: TechnologyPage): boolean {
  return Boolean(
    technology.scope ||
      listOf(technology.theory_of_change).length > 0 ||
      listOf(technology.alternatives).length > 0 ||
      listOf(technology.evidence_register).length > 0 ||
      technology.alignment_assessment ||
      technology.intelligence_curse_assessment ||
      technology.artificial_minds_assessment ||
      technology.welfare_governance ||
      technology.evidence_gap,
  );
}

function buildSections(context: SectionContext): SectionSpec[] {
  const { technology } = context;
  if (!hasPopulatedScorecard(technology)) {
    return [
      claimsSection(context),
      mechanismSection(context),
      caseSection(context),
      scorecardSection(context),
      mindsQuestionsSection(context),
      milestonesSection(context),
    ];
  }

  // Scorecard order: scope, theory of change, evidence, the two assessments,
  // artificial minds, welfare and governance, then the summary. Outline
  // sections that still hold content keep a place, so nothing in content is
  // dropped from the page.
  const sections: SectionSpec[] = [];
  const steps = listOf(technology.theory_of_change);
  const alternatives = listOf(technology.alternatives);
  const register = listOf(technology.evidence_register);

  if (technology.scope) {
    sections.push(scopeSection(context, technology.scope));
  }
  if (listOf(technology.claims_to_solve).length > 0) {
    sections.push(claimsSection(context));
  }
  if (steps.length > 0 || alternatives.length > 0) {
    sections.push(theorySection(context, steps, alternatives));
  }
  if (listOf(technology.mechanism).length > 0) {
    sections.push(mechanismSection(context));
  }
  if (listOf(technology.strongest_case).length > 0 || listOf(technology.strongest_objections).length > 0) {
    sections.push(caseSection(context));
  }
  if (register.length > 0) {
    sections.push(evidenceSection(context));
  }
  if (technology.alignment_assessment) {
    sections.push({
      id: "alignment",
      label: "Alignment case",
      kicker: "Assessment",
      title: (
        <>
          The <em>alignment</em> case
        </>
      ),
      body: (
        <AssessmentView
          assessment={technology.alignment_assessment}
          mechanismLabel="The alignment problem it targets"
          sources={context.sources}
        />
      ),
    });
  }
  if (technology.intelligence_curse_assessment) {
    sections.push({
      id: "intelligence-curse",
      label: "Intelligence Curse case",
      kicker: "Assessment",
      title: (
        <>
          The <em>Intelligence Curse</em> case
        </>
      ),
      body: (
        <AssessmentView
          assessment={technology.intelligence_curse_assessment}
          mechanismLabel="The mechanism it claims"
          sources={context.sources}
        />
      ),
    });
  }
  if (technology.artificial_minds_assessment) {
    sections.push(mindsAssessmentSection(context));
  } else if (listOf(technology.artificial_minds_questions).length > 0) {
    sections.push(mindsQuestionsSection(context));
  }
  if (technology.welfare_governance) {
    sections.push({
      id: "welfare",
      label: "Welfare and governance",
      kicker: "Welfare and governance",
      title: (
        <>
          Welfare and governance <em>risks</em>
        </>
      ),
      body: (
        <div className="reveal">
          <WelfareSheet
            welfare={technology.welfare_governance}
            shortName={technology.short_name}
            sources={context.sources}
          />
        </div>
      ),
    });
  }
  sections.push(scorecardSection(context));
  sections.push(milestonesSection(context));
  return sections;
}

// ---------- Outline sections ----------

function claimsSection({ technology, sources }: SectionContext): SectionSpec {
  return {
    id: "claims",
    label: "What it claims to solve",
    kicker: "The problem",
    title: (
      <>
        What it <em>claims</em> to solve
      </>
    ),
    body: (
      <div className="measure">
        <ClaimList claims={listOf(technology.claims_to_solve)} sources={sources} />
      </div>
    ),
  };
}

function mechanismSection({ technology, sources }: SectionContext): SectionSpec {
  return {
    id: "mechanism",
    label: "How it’s supposed to work",
    kicker: "The mechanism",
    title: (
      <>
        How it&rsquo;s <em>supposed</em> to work
      </>
    ),
    body: (
      <div className="measure">
        <ClaimList claims={listOf(technology.mechanism)} sources={sources} />
      </div>
    ),
  };
}

function caseSection({ technology, sources }: SectionContext): SectionSpec {
  return {
    id: "case",
    label: "Case and objections",
    kicker: "For and against",
    title: (
      <>
        The best arguments on each <em>side</em>
      </>
    ),
    body: (
      <div className={styles.debate}>
        <ArgumentColumn
          tone="for"
          label="For"
          title={
            <>
              The strongest <em>case</em>
            </>
          }
          claims={listOf(technology.strongest_case)}
          sources={sources}
        />
        <ArgumentColumn
          tone="against"
          label="Against"
          title={
            <>
              The strongest <em>objections</em>
            </>
          }
          claims={listOf(technology.strongest_objections)}
          sources={sources}
        />
      </div>
    ),
  };
}

function mindsQuestionsSection({ technology, sources }: SectionContext): SectionSpec {
  return {
    id: "minds",
    label: "The minds involved",
    kicker: "Artificial minds",
    title: (
      <>
        Questions about the <em>minds</em> involved
      </>
    ),
    body: (
      <>
        <p className={`measure ${styles.sectionNote}`}>
          The research still has to answer these questions about consciousness, moral status, identity and
          welfare.
        </p>
        <div className="measure">
          <ClaimList claims={listOf(technology.artificial_minds_questions)} sources={sources} />
        </div>
      </>
    ),
  };
}

// ---------- Populated scorecard sections ----------

function scopeSection({ technology, sources }: SectionContext, scope: NonNullable<TechnologyPage["scope"]>): SectionSpec {
  return {
    id: "scope",
    label: "Scope",
    kicker: "Scope",
    title: (
      <>
        What is being <em>proposed</em>
      </>
    ),
    body: (
      <div className="reveal">
        <ScopeSheet scope={scope} shortName={technology.short_name} sources={sources} />
      </div>
    ),
  };
}

function theorySection({ sources }: SectionContext, steps: Claim[], alternatives: Claim[]): SectionSpec {
  return {
    id: "theory",
    label: "How it would work",
    kicker: "Theory of change",
    title: (
      <>
        How it would <em>work</em>
      </>
    ),
    body: (
      <>
        {steps.length > 0 && (
          <>
            <p className={`measure ${styles.sectionNote}`}>The steps the proposal depends on, in order.</p>
            <CausalChain steps={steps} sources={sources} />
          </>
        )}
        {alternatives.length > 0 && (
          <ChainBreaks claims={alternatives} sources={sources} afterChain={steps.length > 0} />
        )}
      </>
    ),
  };
}

function evidenceSection({ technology, sourcesByRegisterId }: SectionContext): SectionSpec {
  return {
    id: "evidence",
    label: "Evidence register",
    kicker: "Evidence",
    title: (
      <>
        The evidence for each <em>claim</em>
      </>
    ),
    body: (
      <>
        <p className={`measure ${styles.sectionNote}`}>
          Directness is how close each piece of evidence comes to the scenario being assessed.
        </p>
        <div className="reveal">
          <EvidenceRegister
            rows={listOf(technology.evidence_register)}
            technologyName={technology.name}
            shortName={technology.short_name}
            sourcesByRegisterId={sourcesByRegisterId}
          />
        </div>
      </>
    ),
  };
}

function mindsAssessmentSection({ technology, sources }: SectionContext): SectionSpec {
  const minds = technology.artificial_minds_assessment;
  const questions = listOf(technology.artificial_minds_questions);
  return {
    id: "minds",
    label: "Digital minds",
    kicker: "Artificial minds",
    title: (
      <>
        How it deals with digital <em>minds</em>
      </>
    ),
    body: (
      <>
        <p className={`measure ${styles.sectionNote}`}>
          The scorecard asks how the proposal handles each of these for any digital mind it might create.
        </p>
        {minds && <MindsGrid minds={minds} sources={sources} />}
        {questions.length > 0 && (
          <div className={`measure ${styles.subsection}`}>
            <h3 className={styles.subsectionTitle}>Other open questions</h3>
            <ClaimList claims={questions} sources={sources} />
          </div>
        )}
      </>
    ),
  };
}

// ---------- Sections every page has ----------

function scorecardSection({ technology, sources }: SectionContext): SectionSpec {
  return {
    id: "scorecard",
    label: "Scorecard",
    kicker: "Scorecard",
    title: (
      <>
        The <em>ratings</em> so far
      </>
    ),
    body: (
      <>
        <ScorecardNote rows={technology.scorecard} />
        <div className="reveal">
          <Scorecard
            rows={technology.scorecard}
            technologyName={technology.name}
            shortName={technology.short_name}
            sources={sources}
          />
        </div>
        {technology.evidence_gap && <EvidenceGap claim={technology.evidence_gap} sources={sources} />}
      </>
    ),
  };
}

function milestonesSection({ items }: SectionContext): SectionSpec {
  return {
    id: "milestones",
    label: "On the timeline",
    kicker: "Milestones",
    title: (
      <>
        On the <em>timeline</em>
      </>
    ),
    body: (
      <>
        <p className={`measure ${styles.sectionNote}`}>
          The milestones are grouped by stage, and each stage depends on the one before it. Each card links
          to the full timeline, which shows any forecasts behind its milestone.
        </p>
        <div className="reveal">
          <MilestonePath items={items} />
        </div>
        <p className={styles.timelineCta}>
          <Link href="/timeline/" className="btn btn-secondary">
            Open the full timeline
          </Link>
        </p>
      </>
    ),
  };
}

// ---------- Page ----------

// This technology's milestones, built by the same model the timeline uses so
// the codes ("WBE-01") and estimate summaries match what the timeline shows.
function timelineItemsFor(id: TechnologyId): TimelineItem[] {
  const { nowYear } = getSiteData();
  const groups = buildTimeline(getMilestones(), nowYear);
  for (const group of groups) {
    if (group.technology === id) {
      return group.items;
    }
  }
  return [];
}

interface TimelineFacts {
  milestones: number;
  withForecasts: number;
  forecasts: number;
  disagreements: number;
}

function countTimelineFacts(items: TimelineItem[]): TimelineFacts {
  const facts: TimelineFacts = { milestones: items.length, withForecasts: 0, forecasts: 0, disagreements: 0 };
  for (const item of items) {
    if (item.view.forecastCount > 0) {
      facts.withForecasts += 1;
    }
    facts.forecasts += item.view.forecastCount;
    if (item.view.disagreement.flagged) {
      facts.disagreements += 1;
    }
  }
  return facts;
}

function countUnclearRatings(rows: ScorecardRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.rating === "unclear") {
      count += 1;
    }
  }
  return count;
}

export function TechnologyPageView({ id }: { id: TechnologyId }) {
  const technology = requireTechnology(id);
  const number = technologyNumber(id);
  const items = timelineItemsFor(id);
  const facts = countTimelineFacts(items);
  const sources = sourceRefsById(getSources());
  const sourcesByRegisterId = sourceRefsByRegisterId(getSources());
  const next = nextTechnology(id);
  const sections = buildSections({ technology, sources, sourcesByRegisterId, items });

  return (
    <article>
      <header className={styles.hero}>
        <div className="container">
          <div className={styles.heroPanel}>
            <span className={styles.numeral} aria-hidden="true">
              {number}
            </span>
            <div className={styles.heroMain}>
              <p className="eyebrow">
                Technology {number} · {technology.short_name}
              </p>
              <h1 className={styles.headline}>
                <EmphasisText text={technology.headline} />
              </h1>
              <div className={styles.intro}>
                <ClaimText claim={technology.intro} sources={sources} />
              </div>
            </div>
            <div className={styles.heroSide}>
              {technology.sample === true && <SampleNotice />}
              <QuickFacts facts={facts} />
            </div>
          </div>
        </div>
      </header>

      <div className={`container ${styles.body}`}>
        <nav className={styles.toc} aria-label="On this page">
          <p className={`eyebrow ${styles.tocTitle}`}>On this page</p>
          <ol className={styles.tocList}>
            {sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={styles.tocLink}>
                  <span className={styles.tocNumber}>{twoDigits(index + 1)}</span>
                  {section.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.content}>
          <div className={styles.legend}>
            <p className="eyebrow">How to read the marks</p>
            <ProvenanceLegend compact />
            <Link href="/methodology/" className={styles.legendLink}>
              What they mean
            </Link>
          </div>

          {sections.map((section, index) => (
            <PageSection
              key={section.id}
              id={section.id}
              number={twoDigits(index + 1)}
              kicker={section.kicker}
              title={section.title}
            >
              {section.body}
            </PageSection>
          ))}

          {next && <NextTechnology next={next} />}
        </div>
      </div>
    </article>
  );
}

function PageSection({
  id,
  number,
  kicker,
  title,
  children,
}: {
  id: string;
  number: string;
  kicker: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={`${styles.sectionHeader} reveal`}>
        <p className="eyebrow">
          <span className={styles.sectionNumber}>{number}</span> · {kicker}
        </p>
        <h2 id={`${id}-title`}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

// Only sample pages get this. A page the team wrote has no AI notice.
function SampleNotice() {
  return (
    <aside className={styles.sample} aria-label="About this draft">
      <p className={styles.sampleStamp}>Sample draft</p>
      <p className={styles.sampleText}>
        An AI drafted this page as an outline for the team to react to. Nobody on the team has reviewed it
        yet, and it cites no sources. Treat every line as something still to be checked.
      </p>
    </aside>
  );
}

function QuickFacts({ facts }: { facts: TimelineFacts }) {
  return (
    <div className={styles.facts}>
      <div className={styles.factsHead}>
        <p className="eyebrow">On the timeline</p>
        <a href="#milestones" className={styles.factsLink}>
          See them
        </a>
      </div>
      <dl className={styles.factList}>
        <div>
          <dt>Milestones</dt>
          <dd>{facts.milestones}</dd>
        </div>
        <div>
          <dt>With forecasts</dt>
          <dd>{facts.withForecasts}</dd>
        </div>
        <div>
          <dt>Forecasts collected</dt>
          <dd>{facts.forecasts}</dd>
        </div>
        <div>
          <dt>Where sources disagree</dt>
          <dd>{facts.disagreements}</dd>
        </div>
      </dl>
    </div>
  );
}

interface ArgumentColumnProps {
  tone: "for" | "against";
  label: string;
  title: ReactNode;
  claims: Claim[];
  sources: Sources;
}

// One side of the argument, set as numbered pull quotes on a paper card.
function ArgumentColumn({ tone, label, title, claims, sources }: ArgumentColumnProps) {
  const toneClass = tone === "for" ? styles.columnFor : styles.columnAgainst;
  return (
    <div className={`paper ${styles.column} ${toneClass} reveal`}>
      <p className={styles.columnLabel}>{label}</p>
      <h3 className={styles.columnTitle}>{title}</h3>
      {claims.length === 0 ? (
        <p className={styles.sectionNote}>Nothing recorded yet.</p>
      ) : (
        <ol className={styles.pullList}>
          {claims.map((claim, index) => (
            <li key={index} className={styles.pullItem}>
              <span className={styles.pullIndex}>{twoDigits(index + 1)}</span>
              <div className={styles.pullClaim}>
                <ClaimText claim={claim} sources={sources} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

// "six" for small counts, "12" for the rest
function countWord(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function unclearSentence(unclear: number, total: number): string {
  if (unclear === total) {
    return total === 1
      ? "The one rating is Unclear for now, and its row gives the reason."
      : `All ${countWord(total)} ratings are Unclear for now, and each row gives the reason.`;
  }
  return `${capitalize(countWord(unclear))} of the ${countWord(total)} ratings are Unclear for now, and each of those rows gives the reason.`;
}

// A short reading guide above the scorecard. The counts and the optional
// sentence come from the data, so the note stays true as ratings change.
function ScorecardNote({ rows }: { rows: ScorecardRow[] }) {
  const unclearCount = countUnclearRatings(rows);
  return (
    <div className={`measure ${styles.sectionNote}`}>
      <p>
        The ratings use the scales in the team&rsquo;s draft scorecard.
        {unclearCount > 0 && <> {unclearSentence(unclearCount, rows.length)}</>}
        {hasSeverityFlag(rows) && (
          <>
            {" "}
            If an Unclear risk could be severe, its row also says how severe.
          </>
        )}
      </p>
      <p>
        &ldquo;Not claimed&rdquo; means the proposal doesn&rsquo;t claim that outcome, so there is no case to
        grade. We never rate a risk Low just because nobody has studied it
        {isDraftEnum("RiskRating") && ", and the cutoffs for the risk ratings aren’t set yet"}.{" "}
        <Link href="/methodology/">How we rate</Link>
      </p>
    </div>
  );
}

function NextTechnology({ next }: { next: TechnologyPage }) {
  return (
    <Link href={`/${next.id}/`} className={styles.next}>
      <span className="eyebrow">Next · Technology {technologyNumber(next.id)}</span>
      <span className={styles.nextName}>{next.name}</span>
      <span className={styles.nextHeadline}>
        <EmphasisText text={next.headline} />
      </span>
      <span className={styles.nextArrow} aria-hidden="true">
        &rarr;
      </span>
    </Link>
  );
}
