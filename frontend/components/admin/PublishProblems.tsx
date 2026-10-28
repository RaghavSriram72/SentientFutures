import { describePublishProblem, WHO_FIXES_PUBLISH_PROBLEMS } from "./publishProblemText";
import styles from "./Review.module.css";

// Why an approved paper is kept off the public site: plain sentences first,
// then who can fix it, then the export's own wording for whoever does.
export function PublishProblems({ problems }: { problems: string[] }) {
  const sentences: string[] = [];
  for (const problem of problems) {
    const sentence = describePublishProblem(problem);
    if (!sentences.includes(sentence)) {
      sentences.push(sentence);
    }
  }

  return (
    <>
      <ul className={styles.problemList}>
        {sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p>{WHO_FIXES_PUBLISH_PROBLEMS}</p>
      <details className={styles.exportSaid}>
        <summary>What the export said</summary>
        <ul className={styles.exportSaidList}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
