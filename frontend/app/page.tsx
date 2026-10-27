import Link from "next/link";

import { ProvenanceLegend } from "@/components/provenance/Legends";
import { TimelinePreview } from "@/components/timeline/TimelinePreview";
import { getSiteData } from "@/lib/data";
import { enumDescription, enumValues } from "@/lib/enums";
import type { Stage, Technology } from "@/lib/types";

import styles from "./page.module.css";

const TECH_CARDS: { id: Exclude<Technology, "hybrid">; href: string; title: string; number: string }[] = [
  { id: "wbe", href: "/wbe/", title: "Whole brain emulation", number: "01" },
  { id: "bci", href: "/bci/", title: "Brain computer interfaces", number: "02" },
  { id: "neuromorphic", href: "/neuromorphic/", title: "Neuromorphic AI", number: "03" },
];

const STEPS = [
  {
    title: "An AI pipeline will find new work",
    text: "Once it's running, it will search research databases each week for papers and posts that bear on these proposals, and sort out the noise. For this draft, the team adds sources by hand.",
  },
  {
    title: "A person reviews every item",
    text: "Nothing the AI finds goes live on its own. We keep its original assessment next to ours, so we can see where it gets things wrong.",
  },
  {
    title: "Reviewed work goes live",
    text: "Approved sources and team-reviewed milestones go on the site, and everything else stays in the queue. Until launch, the technology pages also show AI-written outlines, marked “not yet reviewed”.",
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
            could help with AI alignment, or keep human work and voices valuable as AI gets more
            capable. We map how each idea is supposed to work, what would have to happen first, and
            where the strongest objections are.
          </p>
          <div className={styles.heroActions}>
            <Link href="/timeline/" className="btn btn-primary">
              Explore the timeline
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
              <dt>Forecasts shown</dt>
              <dd>{forecastTotal}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{data.sources.length}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">The key distinction</p>
            <h2>
              Possible is not the same as <em>helpful</em>.
            </h2>
            <p className="lede">
              It&rsquo;s easy to jump from &ldquo;someone built it&rdquo; straight to &ldquo;it fixes
              the problem.&rdquo; We keep three stages apart, and color the timeline by them.
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
              <p className="eyebrow">The timeline</p>
              <h2>
                Uncertain dates, <em>shown honestly</em>.
              </h2>
              <p className="lede">
                Every forecast stays visible. When credible sources disagree, we show the
                disagreement instead of averaging it into one tidy date.
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
              What each one <em>claims</em> to do.
            </h2>
          </div>
          <ul className={styles.techGrid}>
            {TECH_CARDS.map((tech) => (
              <li key={tech.id}>
                <Link href={tech.href} className={`paper reveal ${styles.techCard}`}>
                  <span className="eyebrow">Technology {tech.number}</span>
                  <h3>{tech.title}</h3>
                  <p>{enumDescription("Technology", tech.id)}</p>
                  <span className={styles.techMeta}>
                    {milestoneCounts[tech.id] ?? 0} milestones
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
              Always know what <em>you&rsquo;re reading</em>.
            </h2>
            <p className="lede">
              Every research claim is marked as coming from a source, our own read, an AI suggestion,
              or genuine uncertainty. The marks look different, so you never have to guess.
            </p>
          </div>
          <ProvenanceLegend />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className={styles.sectionHead}>
            <p className="eyebrow">How it will stay current</p>
            <h2>
              Automated search, <em>human</em> judgment.
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
