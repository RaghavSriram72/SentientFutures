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
    text: "An AI model reads the title and abstract and suggests what the paper is about.",
    isAi: true,
  },
  {
    title: "Reviewed",
    text: "A person checks every suggestion and approves, edits or rejects it.",
  },
  {
    title: "Published",
    text: "Only approved sources reach the public site, on the next rebuild.",
  },
];

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Admin preview"
        title={
          <>
            Where people <em>check the AI</em>
          </>
        }
        lede="This is a static preview of the team's workspace. Nothing on this page is live yet, and nothing here can change the public site."
      />

      <div className="container section">
        <div className={styles.top}>
          <LoginCard />

          <section className={styles.flow} aria-labelledby="flow-heading">
            <p className="eyebrow">How a source gets here</p>
            <h2 id="flow-heading" className={styles.flowHeading}>
              No source goes live <em>without a person</em>
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
