"use client";

import { formatDateTime } from "./adminFormat";
import type { SavedFirst } from "./editorModel";
import forms from "./forms.module.css";
import { Notice } from "./Notice";

interface ConflictNoticeProps {
  savedFirst: SavedFirst;
  onLoadTheirs: () => void;
  onSaveMine: () => void;
}

// The record changed since the editor opened it. Both choices are explicit,
// and every earlier version stays in the history either way.
export function ConflictNotice({ savedFirst, onLoadTheirs, onSaveMine }: ConflictNoticeProps) {
  const who = savedFirst.by ?? "Someone";
  const when = savedFirst.at ? ` at ${formatDateTime(savedFirst.at)}` : "";
  return (
    <Notice
      tone="warning"
      title={`Not saved. ${who} saved a newer version${when}, in another tab or on another computer.`}
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
        Loading theirs drops what you typed here. Saving yours replaces theirs, but their version stays in the history.
      </p>
    </Notice>
  );
}
