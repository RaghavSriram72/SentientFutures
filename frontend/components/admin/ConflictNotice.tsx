"use client";

import type { Ref } from "react";

import { formatDateTime } from "./adminFormat";
import type { SavedFirst } from "./editorModel";
import forms from "./forms.module.css";
import { Notice } from "./Notice";

interface ConflictNoticeProps {
  savedFirst: SavedFirst;
  onLoadTheirs: () => void;
  onSaveMine: () => void;
  // True where the editor keeps a history of versions (milestones), so their
  // version is still there if yours replaces it. Posts keep no history.
  hasHistory?: boolean;
  // For moving focus to the title once the save that found the conflict is over.
  titleRef?: Ref<HTMLParagraphElement>;
}

// The record changed since the editor opened it. Both choices are explicit.
export function ConflictNotice({ savedFirst, onLoadTheirs, onSaveMine, hasHistory = false, titleRef }: ConflictNoticeProps) {
  const who = savedFirst.by ?? "Someone";
  const when = savedFirst.at ? ` at ${formatDateTime(savedFirst.at)}` : "";
  return (
    <Notice
      tone="warning"
      title={`Not saved. ${who} saved a newer version${when}, in another tab or on another computer.`}
      titleRef={titleRef}
      action={
        <div className={forms.actions}>
          <button type="button" className={`btn btn-secondary ${forms.smallButton}`} onClick={onLoadTheirs}>
            Load their version
          </button>
          <button type="button" className={`btn btn-primary ${forms.smallButton}`} onClick={onSaveMine}>
            Save mine over it
          </button>
        </div>
      }
    >
      <p>
        Loading theirs drops what you typed here.
        {hasHistory && " If you save yours, theirs stays in the history."}
      </p>
    </Notice>
  );
}
