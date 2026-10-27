import type { Metadata } from "next";
import Link from "next/link";

import { LoginCard } from "@/components/admin/LoginCard";
import { ReviewQueueMock } from "@/components/admin/ReviewQueueMock";
import { PageHeader } from "@/components/common/PageHeader";

import styles from "./page.module.css";

// Admin stays out of search engines even after launch.
export const metadata: Metadata = {
  title: "Team admin",
  robots: { index: false, follow: false },
};

// The AI's step carries the dashed AI mark, like everywhere else on the site.
const STEPS: { title: string; text: string; isAi?: boolean }[] = [
  {
    title: "Found",
    text: "A weekly script searches research databases for new papers.",
  },
  {
    title: "Triaged",
    text: "An AI model reads each title and abstract and suggests how to categorize the paper.",
    isAi: true,
  },
  {
    title: "Reviewed",
    text: "A person checks every suggestion, then approves, edits or rejects it.",
  },
  {
    title: "Published",
    text: "Only approved sources go on the public site. They appear the next time it rebuilds.",
  },
];

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Admin preview"
        title={
          <>
            The team&rsquo;s <em>review</em> workspace
          </>
        }
        lede="A static preview of the screens the team will use. None of it is connected to anything yet, so nothing here can change the public site."
      />

      <div className="container section">
        <div className={styles.top}>
          <LoginCard />

          <section className={styles.flow} aria-labelledby="flow-heading">
            <p className="eyebrow">Planned pipeline</p>
            <h2 id="flow-heading" className={styles.flowHeading}>
              How a source gets <em>published</em>
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className={`${styles.stepTitle} ${step.isAi ? styles.stepTitleAi : ""}`}>{step.title}</h3>
                    <p className={styles.stepText}>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.flowNote}>
              The full rules are on the <Link href="/methodology/#ai">methodology page</Link>.
            </p>
          </section>
        </div>

        <div className={styles.mock}>
          <ReviewQueueMock />
        </div>
      </div>
    </>
  );
}
