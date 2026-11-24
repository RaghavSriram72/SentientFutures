import { CodeText } from "@/components/common/CodeText";
import type { CodeIndex } from "@/lib/codes";
import type { SourceRef } from "@/lib/sources";
import type { CrossFamilyScope } from "@/lib/types";

import styles from "./EvidenceDatabase.module.css";

interface CrossFamilyNoteProps {
  scope: CrossFamilyScope;
  // Source id -> its source, to print the register ids ("S13").
  sources: Record<string, SourceRef>;
  index: CodeIndex;
}

// The "1 Scope" tab's Cross-family row, its cells word for word under
// plain-words labels. The register list shows it while Cross-family is
// picked, so the reader sees what a Cross-family entry is.
export function CrossFamilyNote({ scope, sources, index }: CrossFamilyNoteProps) {
  // The cell word for word when the import kept it ("S13, S15, S16"),
  // otherwise the register ids of its sources.
  let sourceIdsText = scope.source_ids_text ?? "";
  if (!sourceIdsText) {
    const registerIds: string[] = [];
    for (const id of scope.source_ids ?? []) {
      const registerId = sources[id]?.register_id;
      if (registerId) {
        registerIds.push(registerId);
      }
    }
    sourceIdsText = registerIds.join(", ");
  }

  return (
    <div className={styles.scopeNote}>
      <p className={styles.scopeTitle}>Cross-family</p>
      <dl className={styles.scopeFields}>
        <div className={styles.scopeField}>
          <dt className={styles.scopeLabel}>Definition</dt>
          <dd className={styles.scopeValue}>
            <CodeText text={scope.intervention} index={index} />
          </dd>
        </div>
        {scope.deployment_scenario && (
          <div className={styles.scopeField}>
            <dt className={styles.scopeLabel}>Deployment scenarios considered</dt>
            <dd className={styles.scopeValue}>
              <CodeText text={scope.deployment_scenario} index={index} />
            </dd>
          </div>
        )}
        {sourceIdsText && (
          <div className={styles.scopeField}>
            <dt className={styles.scopeLabel}>Sources</dt>
            <dd className={styles.scopeValue}>
              <CodeText text={sourceIdsText} index={index} mode="workbook" />
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
