import type { Metadata } from "next";
import Link from "next/link";

import { ExternalLink } from "@/components/common/ExternalLink";
import { ARTIFICIAL_MINDS_DEFINITION, INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { getPublicMilestones, getScorecard, getSources, getTechnologies } from "@/lib/data";
import { enumDescription } from "@/lib/enums";
import { AI_TRIAGE_IS_ON } from "@/lib/site";
import { realSources } from "@/lib/sources";
import type { Milestone, TechnologyPage } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "A Sentient Futures incubator project on whether whole brain emulation, brain-computer interfaces or neuromorphic AI could help with AI alignment or keep human agency broadly distributed, and what they would mean for artificial minds.",
};

// True once every page has both lists filled in. Until then the about page
// doesn't promise them.
function everyPageHasForAndAgainst(technologies: TechnologyPage[]): boolean {
  for (const tech of technologies) {
    if ((tech.strongest_case ?? []).length === 0 || (tech.strongest_objections ?? []).length === 0) {
      return false;
    }
  }
  return true;
}

function countUndated(milestones: Milestone[]): number {
  let count = 0;
  for (const milestone of milestones) {
    if (milestone.estimate === null && milestone.forecasts.length === 0 && milestone.achieved_in === null) {
      count += 1;
    }
  }
  return count;
}

// One piece of a line in the "On the site" list: plain text, or the text of
// a link to the part of the site it names.
interface LinePart {
  text: string;
  href?: string;
}

// "Pages on <wbe>, <bci> and <neuromorphic>: ...", with each name linking to its page.
function pagesLine(technologies: TechnologyPage[]): LinePart[] {
  const parts: LinePart[] = [{ text: "Pages on " }];
  for (let index = 0; index < technologies.length; index++) {
    const tech = technologies[index];
    if (index > 0) {
      parts.push({ text: index === technologies.length - 1 ? " and " : ", " });
    }
    parts.push({ text: tech.name.charAt(0).toLowerCase() + tech.name.slice(1), href: `/${tech.id}/` });
  }
  parts.push({
    text: everyPageHasForAndAgainst(technologies)
      ? ": what each claims to solve, how it's meant to work, and the strongest case for and against it."
      : ": what each claims to solve and how it's meant to work. Not every page has its case for and against yet.",
  });
  return parts;
}

// What's on the site, one line per part of it, each linking there. The rules
// behind them are on the methodology page, so they aren't repeated here.
// Since workbook v0.4 every technology has a team scorecard, so the line
// links to the compare page, which shows all three side by side.
function siteIs(technologies: TechnologyPage[], milestones: Milestone[]): LinePart[][] {
  const allUndated = milestones.length > 0 && countUndated(milestones) === milestones.length;
  return [
    pagesLine(technologies),
    [{ text: "Ratings", href: "/compare/" }, { text: " for all three, side by side." }],
    allUndated
      ? [
          { text: "A timeline", href: "/timeline/" },
          { text: " of the milestones, which will show each one's estimated window once sources give dates." },
        ]
      : [{ text: "A timeline", href: "/timeline/" }, { text: " that places each milestone by its estimated window." }],
    [
      { text: "A source database", href: "/sources/" },
      {
        text: " of the papers, talks and other work we've collected, each with a summary and details on its type, peer review and affiliation.",
      },
    ],
    [{ text: "The methodology", href: "/methodology/" }, { text: ", which explains the marks, ratings and timeline rules." }],
  ];
}

// The text of a line, for its key.
function lineText(line: LinePart[]): string {
  let text = "";
  for (const part of line) {
    text += part.text;
  }
  return text;
}

// "brain-computer interfaces" -> "brain-computer interface", for a name used
// before a noun ("the brain-computer interface page"), as the home page does.
// A name that doesn't end in a plural s ("neuromorphic AI") stays as it is.
function beforeNoun(name: string): string {
  return name.endsWith("s") && !name.endsWith("ss") ? name.slice(0, -1) : name;
}

function siteIsnt(technologies: TechnologyPage[], milestones: Milestone[]): string[] {
  const lines = [
    "We're still deciding some of the site's categories, including how we rate a source's relevance and credibility.",
  ];
  const drafts: string[] = [];
  for (const tech of technologies) {
    if (tech.unreviewed_ai_sections) {
      drafts.push(beforeNoun(tech.name.charAt(0).toLowerCase() + tech.name.slice(1)));
    }
  }
  // Only some sections of these pages are AI drafts: their ratings and
  // workbook sections are the team's.
  if (drafts.length > 0) {
    lines.push(
      `Some sections of the ${drafts.join(" and ")} ${drafts.length === 1 ? "page" : "pages"} are still AI drafts we haven't reviewed yet. Each carries the AI-suggested mark.`,
    );
  }
  if (!AI_TRIAGE_IS_ON) {
    lines.push("The AI step that sorts and tags new papers isn't switched on yet. Until it is, new papers go straight to the team for review.");
  }
  const undated = countUndated(milestones);
  if (milestones.length > 0 && undated === milestones.length) {
    lines.push(`None of the ${milestones.length} milestones on the timeline has a date yet.`);
  } else if (undated > 0) {
    lines.push(`${undated} of the ${milestones.length} milestones on the timeline don't have a date yet.`);
  }
  return lines;
}

interface Person {
  name: string;
  // Left out on the advisor cards, which sit under their own "Advisors" heading.
  role?: string;
  detail?: string;
}

const TEAM: Person[] = [
  { name: "Hyacinth Zia", role: "Mentor", detail: "Iliad" },
  { name: "Raghav Sriram", role: "Mentee", detail: "Site and research pipeline" },
  { name: "Vilija", role: "Mentee", detail: "Research, content and the source database" },
];

const ADVISORS: Person[] = [{ name: "Jeff Sebo" }, { name: "Katrina Schleisman" }, { name: "Adam Safron" }];

function PersonCard({ person }: { person: Person }) {
  return (
    <li className={`paper ${styles.person}`}>
      {person.role && <p className="eyebrow">{person.role}</p>}
      <p className={styles.personName}>{person.name}</p>
      {person.detail && <p className={styles.personDetail}>{person.detail}</p>}
    </li>
  );
}

export default function AboutPage() {
  const technologies = getTechnologies();
  const milestones = getPublicMilestones();

  return (
    <>
      <PageHeader
        eyebrow="About"
        title={
          <>
            The <em>question</em> we&rsquo;re working on
          </>
        }
        lede="We keep three stages separate: a technology becoming technically possible, becoming widely available and actually delivering the benefits claimed for it."
      />

      <section className="container section" aria-labelledby="question-heading">
        <div className={styles.questionGrid}>
          <figure className={`${styles.question} reveal`}>
            <p id="question-heading" className="eyebrow">
              Our central question
            </p>
            <blockquote className={styles.questionText}>
              <p>
                Could whole brain emulation, brain-computer interfaces or neuromorphic AI help with AI alignment, or
                counter the Intelligence Curse by keeping human agency broadly distributed as AI grows more capable?
                And what would they mean for any artificial minds they create, and what welfare and governance risks
                would they bring?
              </p>
            </blockquote>
          </figure>

          <dl className={styles.terms}>
            <div className={styles.term}>
              <dt>AI alignment</dt>
              <dd>{enumDescription("Problem", "alignment")}</dd>
            </div>
            <div className={styles.term}>
              <dt>The Intelligence Curse</dt>
              <dd>
                {INTELLIGENCE_CURSE_DEFINITION}{" "}
                <ExternalLink href="https://intelligence-curse.ai">Background reading</ExternalLink>
              </dd>
            </div>
            <div className={styles.term}>
              <dt>Artificial minds</dt>
              <dd>{ARTIFICIAL_MINDS_DEFINITION} Each technology page has a section on them.</dd>
            </div>
          </dl>
        </div>
      </section>

      <HowWeWork />

      <section className="container section" aria-labelledby="team-heading">
        <SectionHead
          id="team-heading"
          title={
            <>
              The team and <em>advisors</em>
            </>
          }
        />
        <ul className={styles.people}>
          {TEAM.map((person) => (
            <PersonCard key={person.name} person={person} />
          ))}
        </ul>

        <h3 className={styles.advisorsHeading}>Advisors</h3>
        <ul className={styles.people}>
          {ADVISORS.map((person) => (
            <PersonCard key={person.name} person={person} />
          ))}
        </ul>

        <div className={styles.funding}>
          <FundingMark />
          <p>
            <span className={styles.fundingName}>A Sentient Futures incubator project</span>
            <span className={styles.fundingNote}>
              Questions and corrections are welcome. The <Link href="/contact/">contact page</Link> has our email.
            </span>
          </p>
        </div>
      </section>

      <section className="container section" aria-labelledby="is-heading">
        <SectionHead
          id="is-heading"
          eyebrow="Where things stand"
          title={
            <>
              What&rsquo;s here so far, and what&rsquo;s <em>unfinished</em>
            </>
          }
        />
        <div className={styles.isGrid}>
          <div className={styles.isCol}>
            <p className={`eyebrow ${styles.isLabel}`}>On the site</p>
            <ul className={styles.isList}>
              {siteIs(technologies, milestones).map((line) => (
                <li key={lineText(line)}>
                  {line.map((part, index) =>
                    part.href ? (
                      <Link key={index} href={part.href}>
                        {part.text}
                      </Link>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className={`${styles.isCol} ${styles.isntCol}`}>
            <p className={`eyebrow ${styles.isLabel}`}>Still in progress</p>
            <ul className={styles.isList}>
              {siteIsnt(technologies, milestones).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>

      </section>

    </>
  );
}

// The scorecard and what it produces, and how AI and people share the work.
// Adapted from Hyacinth's summary of the project (2026-11-23). The counts come
// from the data, so they stay true as the scorecard grows.
function HowWeWork() {
  const scorecard = getScorecard();
  // The scorecard's own sources: those with a register id. Sources approved
  // later in admin join the source database but not the scorecard.
  const sourceCount = realSources(getSources()).filter((source) => source.register_id).length;
  const entryCount = (scorecard.entries ?? []).length;
  const linkCount = (scorecard.links ?? []).length;
  return (
    <section className="container section" aria-labelledby="how-heading">
      <SectionHead
        id="how-heading"
        eyebrow="How we work"
        title={
          <>
            The scorecard behind the <em>site</em>
          </>
        }
        intro="The ratings and milestones on this site come from a scorecard we built."
      />
      <div className={styles.howIntro}>
        <p>
          It sets the rules for judging a source&rsquo;s quality, independence, relevance and strength of evidence,
          and for classing each claim we take from a source: whether it supports, challenges or qualifies a proposed
          mechanism (or is only a prerequisite for one), and whether its evidence is demonstrated, projected, argued
          or assumed.
        </p>
        <p className={styles.howCounts}>
          So far it draws on <Link href="/sources/">{sourceCount} sources</Link>,{" "}
          <Link href="/evidence/">{entryCount} evidence entries</Link> and {linkCount} causal links. No source on the
          site has been given these ratings yet.
        </p>
      </div>

      <ul className={styles.howGrid}>
        <li className={`paper ${styles.howCard}`}>
          <h3 className={styles.howTitle}>Technology assessments</h3>
          <p>
            Ratings for the alignment and Intelligence Curse cases and for safeguard adequacy, and a severity and
            likelihood for human welfare risk, artificial-mind welfare and rights risk, and governance risk. Each comes
            with a confidence level, based on the evidence gathered so far.
          </p>
          <Link href="/compare/" className={styles.howLink}>
            Compare the three technologies<span aria-hidden="true"> &rarr;</span>
          </Link>
        </li>
        <li className={`paper ${styles.howCard}`}>
          <h3 className={styles.howTitle}>Milestones and timeline</h3>
          <p>
            Each milestone falls in an area such as technical capability, high-level fidelity, reliability,
            scalability, economic viability or institutional capacity, and has a success criterion and a rule for what
            counts as evidence. These inform its status and, once sources give dates, its estimated timing.
          </p>
          <Link href="/timeline/" className={styles.howLink}>
            See the timeline<span aria-hidden="true"> &rarr;</span>
          </Link>
        </li>
      </ul>

      <div className={styles.oversight}>
        <h3 className={styles.howTitle}>AI and human oversight</h3>
        <p>
          We plan to have an AI system use the scorecard&rsquo;s criteria and decision rules to process new sources
          and propose updates to the assessments, milestones and timeline.{" "}
          {AI_TRIAGE_IS_ON
            ? "The AI step running today does less: it sorts and tags new papers by their title and abstract."
            : "The AI step we’ve built so far does less: once it’s switched on, it will sort and tag new papers by their title and abstract."}
        </p>
        <p>
          In the first phase, researchers will check the AI&rsquo;s evidence classifications and proposed updates
          before they go on the site. That will show us how accurate and consistent the system is and how closely it
          follows the scorecard&rsquo;s rules, so we can refine the process.
        </p>
        <p>
          We&rsquo;ll automate more only once the system has proved reliable, and people will keep overseeing it
          where needed. Where the evidence is too thin, we say Unclear or Not assessable and leave dates open.
        </p>
        <Link href="/methodology/#pipeline" className={styles.howLink}>
          How sources reach the site<span aria-hidden="true"> &rarr;</span>
        </Link>
      </div>
    </section>
  );
}

// The dashed orbit from the site mark, drawn small next to the funding note.
function FundingMark() {
  return (
    <svg className={styles.fundingMark} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <circle cx="16" cy="16" r="5" fill="currentColor" />
    </svg>
  );
}
