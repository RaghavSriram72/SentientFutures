import Link from "next/link";

import { EmphasisText } from "@/components/common/Emphasis";
import { ARTIFICIAL_MINDS_DEFINITION, INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";
import { StageLegend } from "@/components/provenance/Legends";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { RatingChip } from "@/components/technology/Scorecard";
import { stillNeedsClauses, unclearReasonSentence } from "@/components/technology/text";
import { TrackTeaser } from "@/components/timeline3d/TrackTeaser";
import { getPublicMilestones, getSiteData, getSources, getTechnologies } from "@/lib/data";
import { COMPARE_MINDS_KEY, compareHref } from "@/lib/dimensions";
import { enumDescription, enumLabel } from "@/lib/enums";
import { realSources } from "@/lib/sources";
import type { Claim, Milestone, ScorecardRow, TechnologyPage } from "@/lib/types";

import styles from "./page.module.css";

// Everything on this page that describes the research is worked out from the
// data, so it stays true as the team fills things in. Sample milestones never
// count: getPublicMilestones() leaves them out.

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

// 6 -> "six", 14 -> "14"
function numberWord(count: number): string {
  return count < NUMBER_WORDS.length ? NUMBER_WORDS[count] : String(count);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Neuromorphic AI" -> "neuromorphic AI", for use mid-sentence.
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ["a", "b", "c"] -> "a, b and c"
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A page the team has reviewed is not a sample. The BCI and neuromorphic pages
// are AI drafts, marked sample: true until the team reviews them.
function isTeamReviewed(tech: TechnologyPage): boolean {
  return !tech.sample;
}

// A milestone has a place on the dates once it has a team range, a forecast
// or the year it was achieved. The rest sit in the timeline's Timing unknown zone.
function hasDate(milestone: Milestone): boolean {
  return milestone.estimate !== null || milestone.forecasts.length > 0 || milestone.achieved_in !== null;
}

function countDated(milestones: Milestone[]): number {
  let count = 0;
  for (const milestone of milestones) {
    if (hasDate(milestone)) {
      count += 1;
    }
  }
  return count;
}

// ---------- "Where things stand" ----------

// "All six of its scorecard ratings are Unclear." or "Its six scorecard
// ratings: two Moderate and four Unclear."
function ratingsSentence(rows: ScorecardRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = enumLabel(row.scale === "case" ? "CaseRating" : "RiskRating", row.rating);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 1) {
    const [label] = counts.keys();
    return `All ${numberWord(rows.length)} of its scorecard ratings are ${label}.`;
  }
  const parts: string[] = [];
  for (const [label, count] of counts) {
    parts.push(`${numberWord(count)} ${label}`);
  }
  return `Its ${numberWord(rows.length)} scorecard ratings: ${joinWithAnd(parts)}.`;
}

// When every rating is held back by a gap the team has found, say what's
// missing rather than "All six of its ratings are Unclear".
function statusSentence(rows: ScorecardRow[]): string {
  const stillNeeds = stillNeedsClauses(rows);
  if (stillNeeds !== null) {
    return `Each of its ${numberWord(rows.length)} ratings names what's missing: ${stillNeeds}.`;
  }
  return `${ratingsSentence(rows)} ${unclearReasonSentence(rows)}`.trim();
}

function WhereThingsStand({
  technologies,
  milestones,
  sourceCount,
}: {
  technologies: TechnologyPage[];
  milestones: Milestone[];
  sourceCount: number;
}) {
  const reviewed: TechnologyPage[] = [];
  const drafts: TechnologyPage[] = [];
  for (const tech of technologies) {
    if (isTeamReviewed(tech)) {
      reviewed.push(tech);
    } else {
      drafts.push(tech);
    }
  }
  const draftNames: string[] = [];
  for (const tech of drafts) {
    draftNames.push(lowerFirst(tech.name));
  }
  const dated = countDated(milestones);

  // A section, not an <aside>: the box sits inside <main>, and an <aside>
  // there is a complementary landmark nested in another landmark, which axe
  // flags. A named section is still a region screen readers can jump to.
  return (
    <section className={`paper ${styles.standing}`} aria-labelledby="standing-heading">
      <p id="standing-heading" className={`eyebrow ${styles.standingTitle}`}>
        Where things stand
      </p>
      <ul className={styles.standingList}>
        {reviewed.map((tech) => (
          <li key={tech.id}>
            {reviewed.length === 1
              ? `${tech.name} is the only proposal the team has rated so far.`
              : `The team has rated ${lowerFirst(tech.name)}.`}{" "}
            {statusSentence(tech.scorecard)}
          </li>
        ))}
        {drafts.length > 0 && (
          <li>
            The {drafts.length === 1 ? "page" : "pages"} on {joinWithAnd(draftNames)}{" "}
            {drafts.length === 1 ? "is an AI draft" : "are AI drafts"} nobody on the team has reviewed yet.
          </li>
        )}
      </ul>
      {/* Each stat links to the page that lists what it counts. "With a date"
          only shows once a milestone has one, since a big 0 reads as "nothing
          done". */}
      <dl className={styles.standingStats}>
        <div className={styles.stat}>
          <dt>
            <Link href="/timeline/" className={styles.statLink}>
              Milestones
            </Link>
          </dt>
          <dd>{milestones.length}</dd>
        </div>
        {dated > 0 && (
          <div className={styles.stat}>
            <dt>
              <Link href="/timeline/" className={styles.statLink}>
                With a date
              </Link>
            </dt>
            <dd>{dated}</dd>
          </div>
        )}
        <div className={styles.stat}>
          <dt>
            <Link href="/sources/" className={styles.statLink}>
              Sources
            </Link>
          </dt>
          <dd>{sourceCount}</dd>
        </div>
      </dl>
    </section>
  );
}

// ---------- Key terms ----------

const KEY_TERMS = [
  { term: "AI alignment", definition: enumDescription("Problem", "alignment") },
  { term: "The Intelligence Curse", definition: INTELLIGENCE_CURSE_DEFINITION },
  { term: "Artificial minds", definition: ARTIFICIAL_MINDS_DEFINITION },
];

// ---------- Proposal cards ----------

interface HeadlineRating {
  label: string;
  row: ScorecardRow;
}

// The three scorecard rows that answer the central question directly: the two
// positive cases and the risk to any minds created. The full six are on each page.
function headlineRatings(rows: ScorecardRow[]): HeadlineRating[] {
  const ratings: HeadlineRating[] = [];
  for (const row of rows) {
    let label = "";
    if (row.scale === "case" && row.problem === "alignment") {
      label = "Alignment case";
    } else if (row.scale === "case" && row.problem === "intelligence_curse") {
      label = "Intelligence Curse case";
    } else if (row.scale === "risk" && row.dimension.toLowerCase().startsWith("artificial-mind")) {
      // The page's own name for the row, so the card and the page match.
      label = row.dimension;
    } else {
      continue;
    }
    ratings.push({ label, row });
  }
  return ratings;
}

interface OpenQuestion {
  label: string;
  claim: Claim;
}

// WBE has the team's decisive question for the alignment case. The drafts
// don't, so they show their first question about artificial minds instead.
function openQuestion(tech: TechnologyPage): OpenQuestion | null {
  if (tech.alignment_assessment?.decisive_question) {
    return { label: "Decisive open question", claim: tech.alignment_assessment.decisive_question };
  }
  const mindsQuestions = tech.artificial_minds_questions ?? [];
  if (mindsQuestions.length > 0) {
    return { label: "An open question about minds", claim: mindsQuestions[0] };
  }
  return null;
}

function ProposalCard({ tech, number }: { tech: TechnologyPage; number: number }) {
  const reviewed = isTeamReviewed(tech);
  const question = openQuestion(tech);
  const ratings = headlineRatings(tech.scorecard);
  const href = `/${tech.id}/`;
  const titleId = `proposal-${tech.id}`;

  return (
    <article className={`paper ${styles.proposal}`} aria-labelledby={titleId}>
      <div className={styles.proposalTop}>
        <span className={styles.proposalNumber}>0{number}</span>
        <span className={`chip ${reviewed ? styles.statusTeam : styles.statusAi}`}>
          <ProvenanceGlyph kind={reviewed ? "team" : "ai"} />
          {reviewed ? "Written by the team" : "AI draft, not yet reviewed"}
        </span>
      </div>
      <h3 id={titleId} className={styles.proposalTitle}>
        {tech.name}
      </h3>
      <p className={styles.proposalWhat}>{enumDescription("Technology", tech.id)}</p>
      <p className={styles.proposalClaim}>
        <EmphasisText text={tech.headline} />
      </p>

      {/* The scorecard's own chips, so an Unclear shows its reason and an
          Unclear risk that could be severe shows the warning beside the chip. */}
      <dl className={styles.ratings}>
        {ratings.map((item) => (
          <div key={item.label} className={styles.ratingRow}>
            <dt>{item.label}</dt>
            <dd>
              <RatingChip
                scale={item.row.scale}
                rating={item.row.rating}
                unclearReason={item.row.unclear_reason}
                potentialSeverity={item.row.scale === "risk" ? item.row.potential_severity : null}
              />
            </dd>
          </div>
        ))}
      </dl>

      {question && (
        <div className={styles.question}>
          <p className={styles.questionLabel}>
            <ProvenanceGlyph kind={question.claim.provenance} />
            {question.label}
          </p>
          <p className={styles.questionText}>{question.claim.text}</p>
        </div>
      )}

      <Link href={href} className={styles.proposalLink}>
        {reviewed ? "Read the assessment" : "Read the draft"}
        <span className="visually-hidden"> on {lowerFirst(tech.name)}</span>
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </article>
  );
}

// ---------- Artificial minds ----------

const MINDS_QUESTIONS = [
  { topic: "Consciousness", question: "Would it have experiences at all?" },
  { topic: "Moral status", question: "If it does, how much do its interests count?" },
  { topic: "Identity", question: "How does it relate to the person or brain it came from?" },
  { topic: "Welfare and governance", question: "Who would protect its interests, and how?" },
];

// ---------- Timeline caption ----------

// "8 milestones are mapped so far, all for whole brain emulation. None has a
// date yet, so they all sit in the timeline's Timing unknown zone."
function timelineCaption(milestones: Milestone[], technologies: TechnologyPage[]): string {
  const total = milestones.length;
  if (total === 0) {
    return "No milestones are mapped yet.";
  }
  const techIds = new Set<string>();
  for (const milestone of milestones) {
    techIds.add(milestone.technology);
  }
  let first = `${total} ${total === 1 ? "milestone is" : "milestones are"} mapped so far`;
  if (techIds.size === 1) {
    const [onlyId] = techIds;
    let name = onlyId;
    for (const tech of technologies) {
      if (tech.id === onlyId) {
        name = lowerFirst(tech.name);
      }
    }
    first += total === 1 ? `, for ${name}.` : `, all for ${name}.`;
  } else {
    first += ".";
  }

  const dated = countDated(milestones);
  let second = "";
  if (dated === 0) {
    second = total === 1 ? "It has no date yet, so it sits in the Timing unknown zone." : "None has a date yet, so they all sit in the Timing unknown zone.";
  } else if (dated === total) {
    second = "Each one has a team range, a forecast or the year it was reached.";
  } else {
    second = `${capitalize(numberWord(dated))} of them ${dated === 1 ? "has" : "have"} a date, and the other ${total - dated} sit in the Timing unknown zone.`;
  }
  return `${first} ${second}`;
}

// ---------- Page ----------

export default function HomePage() {
  const technologies = getTechnologies();
  const milestones = getPublicMilestones();
  const sourceCount = realSources(getSources()).length;
  const nowYear = getSiteData().nowYear;

  return (
    <>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroText}>
            <p className="eyebrow">A Sentient Futures project · Draft</p>
            <h1 id="home-title" className={styles.heroTitle}>
              Could brain tech keep humans in the loop, and what <em>minds</em> might it create?
            </h1>
            <p className={`lede ${styles.heroLede}`}>
              How strong is the case that whole brain emulation, brain-computer interfaces or neuromorphic AI could
              help with AI alignment, or keep people&rsquo;s work and political voice from losing value as AI
              improves? And what new welfare and governance problems would each bring, including for any artificial
              minds made along the way?
            </p>
            <div className={styles.heroActions}>
              <Link href="/wbe/" className="btn btn-primary">
                Read the brain emulation assessment
              </Link>
              <Link href="/timeline/" className="btn btn-secondary">
                Explore the timeline
              </Link>
            </div>
          </div>
          <WhereThingsStand technologies={technologies} milestones={milestones} sourceCount={sourceCount} />
        </div>

        <div className={styles.terms}>
          <dl className={`container ${styles.termsInner}`}>
            {KEY_TERMS.map((item) => (
              <div key={item.term} className={styles.term}>
                <dt>{item.term}</dt>
                <dd>{item.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section" aria-labelledby="proposals-heading">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Three proposals</p>
            <h2 id="proposals-heading">
              Where each one <em>stands</em>
            </h2>
            <p className={styles.headLink}>
              <Link href="/methodology/#ratings">
                How we rate<span aria-hidden="true"> &rarr;</span>
              </Link>
              <Link href={compareHref(null)}>
                Compare side by side<span aria-hidden="true"> &rarr;</span>
              </Link>
            </p>
          </div>
          <ul className={styles.proposals}>
            {technologies.map((tech, index) => (
              <li key={tech.id}>
                <ProposalCard tech={tech} number={index + 1} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`section ${styles.mindsSection}`} aria-labelledby="minds-heading">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Artificial minds</p>
            <h2 id="minds-heading">
              Questions about the <em>minds</em> themselves
            </h2>
            <p className={styles.sectionIntro}>
              If one of these technologies creates a mind, it raises questions of its own, apart from whether it helps
              people. Each technology page has a section on them.
            </p>
          </div>
          <ul className={styles.mindsGrid}>
            {MINDS_QUESTIONS.map((item) => (
              <li key={item.topic} className={styles.mindsTile}>
                <h3 className={styles.mindsTopic}>{item.topic}</h3>
                <p>{item.question}</p>
              </li>
            ))}
          </ul>
          <nav className={styles.mindsLinks} aria-label="The artificial minds section on each page">
            <span className={styles.mindsLinksLabel}>Read the section on</span>
            <ul>
              {technologies.map((tech) => (
                <li key={tech.id}>
                  <Link href={`/${tech.id}/#minds`}>{tech.name}</Link>
                  {!isTeamReviewed(tech) && <span className={styles.mindsDraft}> (AI draft)</span>}
                </li>
              ))}
            </ul>
          </nav>
          {/* The three side by side on the same questions */}
          <p className={styles.mindsCompare}>
            <Link href={compareHref(COMPARE_MINDS_KEY)}>
              Compare side by side<span className="visually-hidden">: Artificial minds</span>
              <span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        </div>
      </section>

      <section className={`section ${styles.timelineSection}`} aria-labelledby="timeline-heading">
        <div className="container">
          <div className={styles.sectionHeadRow}>
            <div className={styles.sectionHead}>
              <p className="eyebrow">Timeline</p>
              <h2 id="timeline-heading">
                When the milestones <em>might</em> happen
              </h2>
              <p className={styles.sectionIntro}>{timelineCaption(milestones, technologies)}</p>
            </div>
            <Link href="/timeline/" className="btn btn-secondary">
              Open the full timeline
            </Link>
          </div>
          <div className={styles.stageKey}>
            <span className={styles.stageKeyLabel}>Color shows the stage</span>
            <StageLegend />
            <Link href="/methodology/#stages" className={styles.stageKeyLink}>
              What the stages mean<span aria-hidden="true"> &rarr;</span>
            </Link>
          </div>
          <div className={styles.teaser}>
            <TrackTeaser milestones={milestones} nowYear={nowYear} />
          </div>
          <p className={styles.methodLine}>
            <Link href="/methodology/">
              How to read the marks, stages and ratings<span aria-hidden="true"> &rarr;</span>
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
