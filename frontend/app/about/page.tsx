import type { Metadata } from "next";
import Link from "next/link";

import { ExternalLink } from "@/components/common/ExternalLink";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionHead } from "@/components/common/SectionHead";
import { StageCards } from "@/components/common/StageCards";
import { enumDescription } from "@/lib/enums";
import { SITE_NAME } from "@/lib/site";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "A Sentient Futures incubator project looking at whether whole brain emulation, brain computer interfaces or neuromorphic AI could help with AI alignment or counter the Intelligence Curse.",
};

const SITE_IS = [
  "A page for each proposal on what it claims to solve and how it's supposed to work, with the strongest case for it and against it.",
  "The team's completed scorecard for whole brain emulation.",
  "A timeline that draws each milestone as a range of years. Forecasts are listed one by one, and when credible sources disagree, the timeline flags it.",
  "One of four marks on every research claim: From a source, Our read, AI-suggested or Unclear.",
];

const SITE_ISNT = [
  "This is an early draft. Some categories are still being decided, including how we rate a source's relevance and credibility.",
  "The brain computer interface and neuromorphic AI pages are still AI-written outlines that nobody on the team has reviewed.",
];

interface Person {
  name: string;
  role: string;
  detail?: string;
}

const TEAM: Person[] = [
  { name: "Hyacinth Zia", role: "Mentor", detail: "Iliad" },
  { name: "Raghav Sriram", role: "Mentee", detail: "Site and research pipeline" },
  { name: "Vilija", role: "Mentee", detail: "Research and content" },
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
                The risk that increasingly capable AI reduces the economic and political value of human labor and
                participation, and that this gradually weakens human agency.{" "}
                <ExternalLink href="https://intelligence-curse.ai">Background reading</ExternalLink>
              </dd>
            </div>
            <div className={styles.term}>
              <dt>Artificial minds</dt>
              <dd>
                If one of these technologies creates a mind, that mind brings its own questions about consciousness,
                moral status, identity and welfare. Each technology page has a section on them.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="stages-heading">
        <div className="container section">
          <SectionHead
            id="stages-heading"
            eyebrow="Stages"
            title={
              <>
                How we sort milestones into <em>stages</em>
              </>
            }
            intro="A technology can be possible for decades before it's widely available, and it can be widely available without helping at all. So every milestone on our timeline is tagged with exactly one stage."
          />
          <StageCards />
          <p className={styles.stagesLink}>
            <Link href="/timeline/">See the timeline</Link>
            <span aria-hidden="true"> · </span>
            <Link href="/methodology/#stages">How we assign stages</Link>
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
              {SITE_IS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className={`${styles.isCol} ${styles.isntCol}`}>
            <p className={`eyebrow ${styles.isLabel}`}>Still in progress</p>
            <ul className={styles.isList}>
              {SITE_ISNT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
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
