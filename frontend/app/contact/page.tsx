import type { Metadata } from "next";

import { PageHeader } from "@/components/common/PageHeader";
import { CONTACT_EMAIL } from "@/lib/site";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Contact",
  description: "Corrections, sources we missed and disagreements with our reads. Email the team.",
};

const WELCOME = [
  {
    title: "Corrections",
    text: "A wrong date, a misread quote, a broken link. Tell us the page and what's off.",
  },
  {
    title: "Sources we missed",
    text: "A paper, post or report that bears on a milestone or an argument here. A link is plenty.",
  },
  {
    title: "Disagreements with our reads",
    text: "Anything marked “Our read” is our interpretation. If you read the evidence differently, we want to hear why.",
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title={
          <>
            Tell us where we&rsquo;re <em>wrong</em>
          </>
        }
        lede="We'd rather hear it now. If something on this site is off, missing or overstated, write to us."
      />

      <div className="container section">
        <div className={styles.grid}>
          <div className={`${styles.mailCard} reveal`}>
            <p className="eyebrow">Email the team</p>
            <a className={styles.address} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <p className={styles.mailNote}>
              There&rsquo;s no form. Email is the simplest way to reach all of us, and a link or an exact quote helps us
              check things quickly.
            </p>
            <a className="btn btn-primary" href={`mailto:${CONTACT_EMAIL}`}>
              Write to us <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          <div className={styles.welcome}>
            <h2 className={styles.welcomeHeading}>
              What we&rsquo;d love <em>to hear</em>
            </h2>
            <ol className={styles.welcomeList}>
              {WELCOME.map((item, index) => (
                <li key={item.title} className={styles.welcomeItem}>
                  <span className={styles.welcomeNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className={styles.welcomeTitle}>{item.title}</h3>
                    <p className={styles.welcomeText}>{item.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
