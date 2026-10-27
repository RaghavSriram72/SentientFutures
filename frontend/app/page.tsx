import Link from "next/link";

import { ProvenanceLegend } from "@/components/provenance/Legends";
import { TimelinePreview } from "@/components/timeline/TimelinePreview";
import { getSiteData } from "@/lib/data";
import { enumDescription, enumValues } from "@/lib/enums";
import { realSources } from "@/lib/sources";
import type { Stage, Technology } from "@/lib/types";

import styles from "./page.module.css";

// status says what the page holds right now: the team's own scorecard, or an
// AI-drafted outline nobody on the team has reviewed yet.
const TECH_CARDS: {
  id: Exclude<Technology, "hybrid">;
  href: string;
  title: string;
  number: string;
  status: string;
}[] = [
  { id: "wbe", href: "/wbe/", title: "Whole brain emulation", number: "01", status: "Team scorecard" },
  { id: "bci", href: "/bci/", title: "Brain computer interfaces", number: "02", status: "AI-drafted outline" },
  { id: "neuromorphic", href: "/neuromorphic/", title: "Neuromorphic AI", number: "03", status: "AI-drafted outline" },
];

const STEPS = [
  {
    title: "A weekly search",
    text: "Once it's built, the AI pipeline will check research databases every week for papers and posts relevant to these proposals and screen out the irrelevant ones. Until then the team adds sources by hand.",
  },
  {
    title: "A person reviews every item",
    text: "A reviewer approves, edits or rejects each item the AI finds, and the AI's original assessment is saved next to the final version so we can see where it gets things wrong. Only approved sources and reviewed milestones appear on the site, and the rest stays in the queue.",
  },
];

export default function HomePage() {
  const data = getSiteData();

  const milestoneCounts: Record<string, number> = {};
  for (const milestone of data.milestones) {
    milestoneCounts[milestone.technology] = (milestoneCounts[milestone.technology] ?? 0) + 1;
  }

  let forecastTotal = 0;
  for (const milestone of data.milestones) {
    forecastTotal += milestone.forecasts.length;
  }

  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <p className="eyebrow">A Sentient Futures project · Draft</p>
          <h1 className={styles.heroTitle}>
            Could brain tech <em>keep humans</em> in the loop?
          </h1>
          <p className={`lede ${styles.heroLede}`}>
            Some people think whole brain emulation, brain computer interfaces or brain-inspired AI
            could help with AI alignment, or keep people&rsquo;s work and political voice from losing
            value as AI gets more capable. For each idea we lay out how it&rsquo;s supposed to work
            and what would have to happen first, and we collect the strongest objections.
          </p>
          <div className={styles.heroActions}>
            <Link href="/timeline/" className="btn btn-primary">
              See the timeline
            </Link>
            <Link href="/methodology/" className="btn btn-secondary">
              How we judge evidence
            </Link>
          </div>
          <dl className={styles.heroStats}>
            <div>
              <dt>Milestones</dt>
              <dd>{data.milestones.length}</dd>
            </div>
            <div>
              <dt>Forecasts</dt>
              <dd>{forecastTotal}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{realSources(data.sources).length}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Stages</p>
            <h2>
              Every milestone sits in one of three <em>stages</em>
            </h2>
            <p className="lede">
              We split &ldquo;someone built it&rdquo; and &ldquo;it fixes the problem&rdquo; into
              separate stages, with a third in between, and the timeline is colored by stage.
            </p>
          </div>
          <ol className={styles.stages}>
            {enumValues("Stage").map((stage, index) => (
              <li key={stage.value} className={`paper reveal ${styles.stageCard}`}>
                <span className={`${styles.stageBar} ${styles[`stage_${stage.value as Stage}`]}`} aria-hidden="true" />
                <span className={styles.stageNumber}>0{index + 1}</span>
                <h3>{stage.label}</h3>
                <p>{stage.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`section ${styles.timelineSection}`}>
        <div className="container">
          <div className={styles.sectionHeadRow}>
            <div className={styles.sectionHead}>
              <p className="eyebrow">Timeline preview</p>
              <h2>
                When the milestones <em>might</em> happen
              </h2>
              <p className="lede">
                Milestones are drawn as ranges of years, and the full timeline lists every forecast
                behind each one separately. Where credible sources disagree, the milestone gets a red
                &ldquo;Sources disagree&rdquo; stamp.
              </p>
            </div>
            <Link href="/timeline/" className="btn btn-secondary">
              Open the full timeline
            </Link>
          </div>
          <div className={`paper ${styles.previewFrame}`}>
            <TimelinePreview milestones={data.milestones} nowYear={data.nowYear} />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Three proposals</p>
            <h2>
              What each one <em>is</em>
            </h2>
            <p className="lede">
              Only the whole brain emulation page has the team&rsquo;s completed scorecard. The other
              two are still AI-drafted outlines, and each of their lines stays marked &ldquo;not yet
              reviewed&rdquo; until someone on the team checks it.
            </p>
          </div>
          <ul className={styles.techGrid}>
            {TECH_CARDS.map((tech) => (
              <li key={tech.id}>
                <Link href={tech.href} className={`paper reveal ${styles.techCard}`}>
                  <span className="eyebrow">Technology {tech.number}</span>
                  <h3>{tech.title}</h3>
                  <p>{enumDescription("Technology", tech.id)}</p>
                  <span className={styles.techMeta}>
                    {milestoneCounts[tech.id] ?? 0} milestones · {tech.status}
                    <span aria-hidden="true"> →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`section ${styles.kindsSection}`}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Four kinds of content</p>
            <h2>
              The four <em>marks</em>
            </h2>
            <p className="lede">
              You don&rsquo;t need color to tell them apart, since each has its own glyph and line
              style.
            </p>
          </div>
          <ProvenanceLegend />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Keeping it current</p>
            <h2>
              How new sources will reach the <em>site</em>
            </h2>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={`reveal ${styles.step}`}>
                <span className={styles.stepNumber}>0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
