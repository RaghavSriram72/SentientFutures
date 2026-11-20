import Link from "next/link";

import { EmphasisText } from "@/components/common/Emphasis";
import { ARTIFICIAL_MINDS_DEFINITION, INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";
import { StageLegend } from "@/components/provenance/Legends";
import { ProvenanceGlyph } from "@/components/provenance/ProvenanceTag";
import { RatingChip } from "@/components/technology/RatingChip";
import { TrackTeaser } from "@/components/timeline3d/TrackTeaser";
import { getPublicMilestones, getScorecard, getSiteData, getSources, getTechnologies } from "@/lib/data";
import { COMPARE_MINDS_KEY, compareHref } from "@/lib/dimensions";
import { enumDescription, enumLabel } from "@/lib/enums";
import { realSources } from "@/lib/sources";
import type { Confidence, Milestone, ScorecardData, ScorecardRow, TechnologyPage } from "@/lib/types";

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

// The BCI and neuromorphic pages still have AI-drafted outline sections,
// marked unreviewed_ai_sections: true until the team reviews them. Their
// ratings and workbook sections are the team's.
function hasAiSections(tech: TechnologyPage): boolean {
  return tech.unreviewed_ai_sections === true;
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

// A risk row the workbook marks "Not applicable" (BCI, artificial minds).
// Its stored confidence is never shown, so it never counts here either.
function isNotApplicable(row: ScorecardRow): boolean {
  return row.scale === "risk" && row.applicable === false;
}

// "The team has rated all three proposals."
function ratedSentence(technologies: TechnologyPage[]): string | null {
  const rated: TechnologyPage[] = [];
  for (const tech of technologies) {
    if (tech.scorecard.length > 0) {
      rated.push(tech);
    }
  }
  if (rated.length === 0) {
    return null;
  }
  if (rated.length === 1) {
    return `The team has rated ${lowerFirst(rated[0].name)}.`;
  }
  const which =
    rated.length === technologies.length
      ? `all ${numberWord(rated.length)} proposals`
      : `${numberWord(rated.length)} of the ${numberWord(technologies.length)} proposals`;
  return `The team has rated ${which}.`;
}

// "Every rating so far has low confidence." when every row on every page
// shares one confidence; null when they differ.
function confidenceSentence(technologies: TechnologyPage[]): string | null {
  let shared: Confidence | null = null;
  let count = 0;
  for (const tech of technologies) {
    for (const row of tech.scorecard) {
      if (isNotApplicable(row)) {
        continue;
      }
      if (shared !== null && row.confidence !== shared) {
        return null;
      }
      shared = row.confidence;
      count += 1;
    }
  }
  if (shared === null || count < 2) {
    return null;
  }
  return `Every rating so far has ${enumLabel("Confidence", shared).toLowerCase()} confidence.`;
}

// "brain-computer interfaces" -> "brain-computer interface", for a name used
// before a noun ("the brain-computer interface page"). A name that doesn't
// end in a plural s ("neuromorphic AI") stays as it is.
function beforeNoun(name: string): string {
  return name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name;
}

// "Some sections of the brain-computer interface and neuromorphic AI pages
// are still AI drafts. Each one is marked."
function aiSectionsSentence(technologies: TechnologyPage[]): string | null {
  const names: string[] = [];
  for (const tech of technologies) {
    if (hasAiSections(tech)) {
      names.push(beforeNoun(lowerFirst(tech.name)));
    }
  }
  if (names.length === 0) {
    return null;
  }
  const pages = names.length === 1 ? "page" : "pages";
  return `Some sections of the ${joinWithAnd(names)} ${pages} are still AI drafts. Each one is marked.`;
}

function WhereThingsStand({
  technologies,
  milestones,
  sourceCount,
  scorecard,
}: {
  technologies: TechnologyPage[];
  milestones: Milestone[];
  sourceCount: number;
  scorecard: ScorecardData;
}) {
  const lines: string[] = [];
  for (const line of [
    ratedSentence(technologies),
    confidenceSentence(technologies),
    aiSectionsSentence(technologies),
  ]) {
    if (line !== null) {
      lines.push(line);
    }
  }
  const dated = countDated(milestones);
  const entryCount = scorecard.entries?.length ?? 0;

  // A section, not an <aside>: the box sits inside <main>, and an <aside>
  // there is a complementary landmark nested in another landmark, which axe
  // flags. A named section is still a region screen readers can jump to.
  return (
    <section className={`paper ${styles.standing}`} aria-labelledby="standing-heading">
      <p id="standing-heading" className={`eyebrow ${styles.standingTitle}`}>
        Where things stand
      </p>
      {lines.length > 0 && (
        <ul className={styles.standingList}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
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
        {entryCount > 0 && (
          <div className={styles.stat}>
            <dt>
              <Link href="/evidence/" className={styles.statLink}>
                Evidence entries
              </Link>
            </dt>
            <dd>{entryCount}</dd>
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

// A risk row has no rating chip: the workbook keeps its severity and
// likelihood apart. "Severity" and "Likelihood" are its own headers, and the
// values its labels: ["Severity very high", "Likelihood not assessable"], or
// ["Not applicable"] when it says so. Shown joined by a middle dot.
function riskMeta(row: ScorecardRow): string[] {
  if (isNotApplicable(row)) {
    return ["Not applicable"];
  }
  const parts: string[] = [];
  if (row.severity) {
    parts.push(`Severity ${enumLabel("Severity", row.severity).toLowerCase()}`);
  }
  if (row.likelihood) {
    parts.push(`Likelihood ${enumLabel("Likelihood", row.likelihood).toLowerCase()}`);
  }
  return parts;
}

// Everything on a card is the team's: the ratings, the decisive question from
// the alignment judgment, and the site's own headline. The AI-drafted outline
// sections never appear here, so a card has no mark (unmarked is the team's).
function ProposalCard({ tech, number }: { tech: TechnologyPage; number: number }) {
  const question = tech.alignment_assessment?.decisive_question ?? null;
  const ratings = headlineRatings(tech.scorecard);
  const href = `/${tech.id}/`;
  const titleId = `proposal-${tech.id}`;

  return (
    <article className={`paper ${styles.proposal}`} aria-labelledby={titleId}>
      <div className={styles.proposalTop}>
        <span className={styles.proposalNumber}>0{number}</span>
      </div>
      <h3 id={titleId} className={styles.proposalTitle}>
        {tech.name}
      </h3>
      <p className={styles.proposalWhat}>{enumDescription("Technology", tech.id)}</p>
      <p className={styles.proposalClaim}>
        <EmphasisText text={tech.headline} />
      </p>

      {/* The scorecard's own chips for the two cases; the risk row's
          severity and likelihood in words, as in the page's hero. */}
      <dl className={styles.ratings}>
        {ratings.map((item) => (
          <div key={item.label} className={styles.ratingRow}>
            <dt>{item.label}</dt>
            <dd>
              {item.row.scale === "risk" ? (
                <span className={styles.riskMeta}>
                  {riskMeta(item.row).map((part, index) => (
                    <span key={part}>
                      {/* A no-break space before the dot, so a line ends on it */}
                      {index > 0 && "\u00a0· "}
                      <span className={styles.riskMetaPart}>{part}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <RatingChip scale={item.row.scale} rating={item.row.rating} unclearReason={item.row.unclear_reason} />
              )}
            </dd>
          </div>
        ))}
      </dl>

      {question && (
        <div className={styles.question}>
          <p className={styles.questionLabel}>
            <ProvenanceGlyph kind={question.provenance} />
            Decisive open question
          </p>
          <p className={styles.questionText}>{question.text}</p>
        </div>
      )}

      <Link href={href} className={styles.proposalLink}>
        Read the assessment
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
  const scorecard = getScorecard();
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
          <WhereThingsStand
            technologies={technologies}
            milestones={milestones}
            sourceCount={sourceCount}
            scorecard={scorecard}
          />
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
                </li>
              ))}
            </ul>
          </nav>
          {/* The three side by side on the same questions. The aria-label gives
              screen readers the full name, "Compare side by side: Artificial minds".
              A visually-hidden span would not work here: its absolute positioning
              makes the browser add a space, giving "side by side : Artificial". */}
          <p className={styles.mindsCompare}>
            <Link href={compareHref(COMPARE_MINDS_KEY)} aria-label="Compare side by side: Artificial minds">
              Compare side by side
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
            <span className={styles.stageKeyLabel}>Colour shows the stage</span>
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
