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
    "A Sentient Futures incubator project on whether whole brain emulation, brain computer interfaces or neuromorphic AI could help with AI alignment or the Intelligence Curse.",
};

const SITE_IS = [
  "A map of each proposal: what it claims to solve, how it's supposed to work, and the strongest case for and against.",
  "A timeline of milestones with honest, uncertain windows, where every forecast is shown on its own.",
  "Marked line by line as sourced, our read, AI-suggested or unclear.",
];

const SITE_ISNT = [
  "A prediction of one date. When credible sources disagree, we show the disagreement.",
  "Finished. This is an early draft, and some of our categories are still being decided.",
  "Written by an AI without telling you. In this draft the technology pages are AI-written outlines the team hasn't reviewed yet, and every line says so. Once the site launches, nothing AI-written goes live unchecked.",
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
            What would brain tech <em>actually</em> have to do?
          </>
        }
        lede={`${SITE_NAME} looks at three ideas: whole brain emulation, brain computer interfaces and neuromorphic AI. For each, we ask how it's supposed to help with AI alignment or the Intelligence Curse, what would have to happen first, and where the strongest objections are.`}
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
                create, including for any artificial minds created along the way?
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
                participation, gradually weakening human agency.{" "}
                <ExternalLink href="https://intelligence-curse.ai">Background reading</ExternalLink>
              </dd>
            </div>
            <div className={styles.term}>
              <dt>Artificial minds</dt>
              <dd>
                If any of these technologies creates a mind, it raises its own questions about consciousness, moral
                status, identity and welfare. We track those questions alongside the rest.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="stages-heading">
        <div className="container section">
          <SectionHead
            id="stages-heading"
            eyebrow="The key distinction"
            title={
              <>
                Possible isn&rsquo;t the same as <em>helping</em>
              </>
            }
            intro="A technology can be possible for decades before it's widely available, and widely available without helping at all. These are easy to blur together, so every milestone on our timeline is tagged with exactly one."
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
          eyebrow="What you're looking at"
          title={
            <>
              What this site is, and <em>isn&rsquo;t</em>
            </>
          }
        />
        <div className={styles.isGrid}>
          <div className={styles.isCol}>
            <p className={`eyebrow ${styles.isLabel}`}>It is</p>
            <ul className={styles.isList}>
              {SITE_IS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className={`${styles.isCol} ${styles.isntCol}`}>
            <p className={`eyebrow ${styles.isLabel}`}>It isn&rsquo;t</p>
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
          eyebrow="The team"
          title={
            <>
              The <em>people</em> behind it
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
              Questions or corrections? <Link href="/contact/">Get in touch</Link>.
            </span>
          </p>
        </div>
      </section>
    </>
  );
}

// The dashed orbit from the site mark, as a quiet seal for the funding note.
function FundingMark() {
  return (
    <svg className={styles.fundingMark} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <circle cx="16" cy="16" r="5" fill="currentColor" />
    </svg>
  );
}
