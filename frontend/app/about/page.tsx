import type { Metadata } from "next";
import Link from "next/link";

import { ExternalLink } from "@/components/common/ExternalLink";
import { ARTIFICIAL_MINDS_DEFINITION, INTELLIGENCE_CURSE_DEFINITION } from "@/components/common/keyTerms";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { getPublicMilestones, getTechnologies } from "@/lib/data";
import { enumDescription } from "@/lib/enums";
import { DISAGREEMENT_GAP_YEARS } from "@/lib/estimates";
import { SITE_NAME } from "@/lib/site";
import type { Milestone, TechnologyPage } from "@/lib/types";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "A Sentient Futures incubator project looking at whether whole brain emulation, brain computer interfaces or neuromorphic AI could help with AI alignment or counter the Intelligence Curse.",
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

// What's on the site and what isn't finished, worked out from the data where
// it can be, so the lists stay true as the team fills things in.
function siteIs(technologies: TechnologyPage[]): string[] {
  const pages = everyPageHasForAndAgainst(technologies)
    ? "A page for each proposal on what it claims to solve and how it's supposed to work, with the strongest case for it and against it."
    : "A page for each proposal on what it claims to solve and how it's supposed to work. Not every page has its strongest case for and against written yet.";
  return [
    pages,
    "The team's completed scorecard for whole brain emulation.",
    `A timeline that places each milestone by its estimated window, or in a “Timing unknown” zone until it has one. Forecasts are listed one by one, never averaged. When two of them are more than ${DISAGREEMENT_GAP_YEARS} years apart, or one says it will never happen, the milestone is flagged.`,
    "A source database of the papers and essays we've collected, each with a summary the team wrote. A weekly search finds new papers, and a person on the team approves every one before it appears.",
    "One of four marks on every research claim: From a source, Our read, AI-suggested or Unclear.",
  ];
}

function siteIsnt(technologies: TechnologyPage[], milestones: Milestone[]): string[] {
  const lines = [
    "This is an early draft. Some categories are still being decided, including how we rate a source's relevance and credibility.",
  ];
  const drafts: string[] = [];
  for (const tech of technologies) {
    if (tech.sample) {
      drafts.push(tech.name.charAt(0).toLowerCase() + tech.name.slice(1));
    }
  }
  if (drafts.length > 0) {
    lines.push(
      `The ${drafts.join(" and ")} ${drafts.length === 1 ? "page is" : "pages are"} still AI-written drafts that nobody on the team has reviewed.`,
    );
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
  role: string;
  detail?: string;
}

const TEAM: Person[] = [
  { name: "Hyacinth Zia", role: "Mentor", detail: "Iliad" },
  { name: "Raghav Sriram", role: "Mentee", detail: "Site and research pipeline" },
  { name: "Vilija", role: "Mentee", detail: "Research, content and the source database" },
];

const ADVISORS: Person[] = [
  { name: "Jeff Sebo", role: "Advisor" },
  { name: "Katrina Schleisman", role: "Advisor" },
  { name: "Adam Safron", role: "Advisor" },
];

function PersonCard({ person }: { person: Person }) {
  return (
    <li className={`paper ${styles.person}`}>
      <p className="eyebrow">{person.role}</p>
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
        lede={`${SITE_NAME} covers three ideas: whole brain emulation, brain computer interfaces and neuromorphic AI. People have suggested each one as a way to help with AI alignment or to counter the Intelligence Curse. We want to know how well those suggestions hold up, which means working out how each idea is meant to work, what it depends on, and what the strongest objections are.`}
      />

      <section className="container section" aria-labelledby="question-heading">
        <div className={styles.questionGrid}>
          <figure className={`${styles.question} reveal`}>
            <p id="question-heading" className="eyebrow">
              Our central question
            </p>
            <blockquote className={styles.questionText}>
              <p>
                How strong is the case that whole brain emulation, brain computer interfaces or neuromorphic AI could
                address AI alignment or the Intelligence Curse? And what new welfare and governance problems would each
                bring, including for any artificial minds made along the way?
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

      <section className="container section" aria-labelledby="team-heading">
        <SectionHead
          id="team-heading"
          eyebrow="People"
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
              {siteIs(technologies).map((line) => (
                <li key={line}>{line}</li>
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

// The dashed orbit from the site mark, drawn small next to the funding note.
function FundingMark() {
  return (
    <svg className={styles.fundingMark} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <circle cx="16" cy="16" r="5" fill="currentColor" />
    </svg>
  );
}
