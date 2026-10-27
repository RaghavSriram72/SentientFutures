import type { Metadata } from "next";

import { PageHeader } from "@/components/common/PageHeader";
import { CONTACT_EMAIL } from "@/lib/site";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Contact",
  description: "Email the team with corrections, sources we missed, or places where you read the evidence differently.",
};

const WELCOME = [
  {
    title: "Corrections",
    text: "Tell us the page and what's wrong with it, whether that's a date, a quote we misread or a broken link.",
  },
  {
    title: "Sources we missed",
    text: "If a paper, post or report is relevant to one of the milestones or arguments here, a link to it is plenty.",
  },
  {
    title: "Disagreements",
    text: "Lines marked “Our read” are the team's interpretation of the evidence. If you read it differently, tell us why.",
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
        lede="If something on the site is off, missing or overstated, we'd like to hear about it while the site is still a draft."
      />

      <div className="container section">
        <div className={styles.grid}>
          <div className={`${styles.mailCard} reveal`}>
            <p className="eyebrow">Email the team</p>
            <a className={styles.address} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <p className={styles.mailNote}>
              Email is the only way to reach us, and it goes to the whole team. Including a link or an exact quote
              helps us check things faster.
            </p>
            <a className="btn btn-primary" href={`mailto:${CONTACT_EMAIL}`}>
              Write to us <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          <div className={styles.welcome}>
            <h2 className={styles.welcomeHeading}>
              What to <em>send</em> us
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
