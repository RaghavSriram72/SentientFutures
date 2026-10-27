import Link from "next/link";
import type { ReactNode } from "react";

import { ClaimList, ClaimText } from "@/components/provenance/ClaimText";
import { ProvenanceLegend } from "@/components/provenance/Legends";
import { buildTimeline, type TimelineItem } from "@/components/timeline/timelineModel";
import { getMilestones, getSiteData, getSources } from "@/lib/data";
import { isDraftEnum } from "@/lib/enums";
import { sourceRefsById, type SourceRef } from "@/lib/sources";
import type { Claim, ScorecardRow, TechnologyPage } from "@/lib/types";

import { EmphasisText } from "./EmphasisText";
import { MilestonePath } from "./MilestonePath";
import { Scorecard } from "./Scorecard";
import { nextTechnology, requireTechnology, technologyNumber, type TechnologyId } from "./technologyData";
import styles from "./TechnologyPageView.module.css";

interface SectionInfo {
  id: string;
  label: string;
}

// The in-page sections in reading order. The side nav and the section
// numbers both come from this list, so they can't drift apart.
const SECTIONS: SectionInfo[] = [
  { id: "claims", label: "What it claims to solve" },
  { id: "mechanism", label: "How it's supposed to work" },
  { id: "case", label: "Case and objections" },
  { id: "scorecard", label: "Scorecard" },
  { id: "minds", label: "The minds involved" },
  { id: "milestones", label: "On the timeline" },
];

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

function sectionNumber(id: string): string {
  for (let index = 0; index < SECTIONS.length; index++) {
    if (SECTIONS[index].id === id) {
      return twoDigits(index + 1);
    }
  }
  return "00";
}

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
  const next = nextTechnology(id);

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
              {technology.sample && <SampleNotice />}
              <QuickFacts facts={facts} />
            </div>
          </div>
        </div>
      </header>

      <div className={`container ${styles.body}`}>
        <nav className={styles.toc} aria-label="On this page">
          <p className={`eyebrow ${styles.tocTitle}`}>On this page</p>
          <ol className={styles.tocList}>
            {SECTIONS.map((section, index) => (
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

          <PageSection
            id="claims"
            kicker="The problem"
            title={
              <>
                What it <em>claims</em> to solve
              </>
            }
          >
            <div className="measure">
              <ClaimList claims={technology.claims_to_solve} sources={sources} />
            </div>
          </PageSection>

          <PageSection
            id="mechanism"
            kicker="The mechanism"
            title={
              <>
                How it&apos;s <em>supposed</em> to work
              </>
            }
          >
            <div className="measure">
              <ClaimList claims={technology.mechanism} sources={sources} />
            </div>
          </PageSection>

          <PageSection
            id="case"
            kicker="For and against"
            title={
              <>
                The best case, and the best reasons to <em>doubt it</em>
              </>
            }
          >
            <div className={styles.debate}>
              <ArgumentColumn
                tone="for"
                label="The case for"
                title={
                  <>
                    The strongest <em>case</em>
                  </>
                }
                claims={technology.strongest_case}
                sources={sources}
              />
              <ArgumentColumn
                tone="against"
                label="The case against"
                title={
                  <>
                    The strongest <em>objections</em>
                  </>
                }
                claims={technology.strongest_objections}
                sources={sources}
              />
            </div>
          </PageSection>

          <PageSection
            id="scorecard"
            kicker="Scorecard"
            title={
              <>
                The report card, <em>so far</em>
              </>
            }
          >
            <ScorecardNote technology={technology} />
            <div className="reveal">
              <Scorecard
                rows={technology.scorecard}
                technologyName={technology.name}
                shortName={technology.short_name}
                sources={sources}
              />
            </div>
          </PageSection>

          <PageSection
            id="minds"
            kicker="Artificial minds"
            title={
              <>
                Questions about the <em>minds</em> involved
              </>
            }
          >
            <p className={`measure ${styles.sectionNote}`}>
              Consciousness, moral status, identity and welfare. These are open questions the research
              has to answer, so we list them here instead of guessing.
            </p>
            <div className="measure">
              <ClaimList claims={technology.artificial_minds_questions} sources={sources} />
            </div>
          </PageSection>

          <PageSection
            id="milestones"
            kicker="Milestones"
            title={
              <>
                On the <em>timeline</em>
              </>
            }
          >
            <p className={`measure ${styles.sectionNote}`}>
              Each technology has to become possible, then widely available, then actually helping.
              This is where its milestones sit today. Every card opens the full timeline, where you can
              see the forecasts behind each milestone.
            </p>
            <div className="reveal">
              <MilestonePath items={items} />
            </div>
            <p className={styles.timelineCta}>
              <Link href="/timeline/" className="btn btn-secondary">
                Open the full timeline
              </Link>
            </p>
          </PageSection>

          {next && <NextTechnology next={next} />}
        </div>
      </div>
    </article>
  );
}

function PageSection({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={`${styles.sectionHeader} reveal`}>
        <p className="eyebrow">
          <span className={styles.sectionNumber}>{sectionNumber(id)}</span> · {kicker}
        </p>
        <h2 id={`${id}-title`}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function SampleNotice() {
  return (
    <aside className={styles.sample} aria-label="About this draft">
      <p className={styles.sampleStamp}>Sample draft</p>
      <p className={styles.sampleText}>
        An AI drafted this page as an outline for the team to react to. Nobody on the team has
        reviewed it yet and it cites no sources, so read each line as a starting point for research,
        not a finding.
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
  sources: Record<string, SourceRef>;
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

// A short reading guide above the scorecard. The counts come from the data, so
// the note stays true as the team fills ratings in.
function ScorecardNote({ technology }: { technology: TechnologyPage }) {
  const unclearCount = countUnclearRatings(technology.scorecard);
  const total = technology.scorecard.length;
  return (
    <div className={`measure ${styles.sectionNote}`}>
      <p>
        Ratings follow the team&apos;s draft scorecard.{" "}
        {unclearCount > 0 && (
          <>
            {unclearCount} of {total} are Unclear for now, and each one says why.{" "}
          </>
        )}
        Not claimed means the proposal doesn&rsquo;t claim that outcome, which is different from a weak case. A risk is
        never rated Low just because nobody has studied it.
        {isDraftEnum("RiskRating") && " The risk thresholds themselves are still being defined."}{" "}
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
