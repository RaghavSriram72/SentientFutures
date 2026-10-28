"use client";

import type { CatalogSource } from "@/lib/adminTypes";

import forms from "./forms.module.css";
import { catalogLabel } from "./milestoneModel";
import styles from "./Pickers.module.css";

export interface PickerOption {
  value: string;
  label: string;
  // Options with a group are listed under it, in the order groups first appear.
  group?: string;
}

// Every source a milestone can cite, grouped by whether readers can see it yet.
export function sourceOptions(catalog: CatalogSource[]): PickerOption[] {
  const options: PickerOption[] = [];
  for (const source of catalog) {
    let group = "Approved in admin, public after the next publish";
    if (source.sample) {
      group = "Samples (made up, for worked examples only)";
    } else if (source.on_site) {
      group = "On the public site";
    }
    options.push({ value: source.id, label: catalogLabel(source), group });
  }
  return options;
}

function groupsOf(options: PickerOption[]): { name: string; options: PickerOption[] }[] {
  const groups: { name: string; options: PickerOption[] }[] = [];
  for (const option of options) {
    const name = option.group ?? "";
    let group = groups.find((entry) => entry.name === name);
    if (!group) {
      group = { name, options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }
  return groups;
}

function OptionList({ options }: { options: PickerOption[] }) {
  const groups = groupsOf(options);
  return (
    <>
      {groups.map((group) =>
        group.name === "" ? (
          group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))
        ) : (
          <optgroup key={group.name} label={group.name}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </>
  );
}

interface MultiPickerProps {
  // The id of the "add" select, so an error can move focus to it.
  id: string;
  label: string;
  hint?: string;
  options: PickerOption[];
  chosen: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  errors: string[];
  // Shown when nothing is chosen.
  emptyText: string;
}

// A list of chosen ids, each with a Remove button, and a select to add more.
// Ids the options don't know (a source since removed, say) still show, so
// they can be removed.
export function MultiPicker({ id, label, hint, options, chosen, onChange, disabled, errors, emptyText }: MultiPickerProps) {
  const labelId = `${id}-label`;
  const remaining: PickerOption[] = [];
  for (const option of options) {
    if (!chosen.includes(option.value)) {
      remaining.push(option);
    }
  }

  function labelFor(value: string): string {
    const option = options.find((entry) => entry.value === value);
    return option ? option.label : `${value} (not found)`;
  }

  function remove(value: string) {
    const next: string[] = [];
    for (const item of chosen) {
      if (item !== value) {
        next.push(item);
      }
    }
    onChange(next);
    // The button that had focus is gone, so focus goes back to the add select.
    window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  const describedBy: string[] = [];
  if (hint) {
    describedBy.push(`${id}-hint`);
  }
  if (errors.length > 0) {
    describedBy.push(`${id}-error`);
  }

  return (
    <div className={forms.field} role="group" aria-labelledby={labelId}>
      <p id={labelId} className={forms.label}>
        {label}
      </p>
      {hint && (
        <p id={`${id}-hint`} className={forms.hint}>
          {hint}
        </p>
      )}
      {chosen.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.chosen}>
          {chosen.map((value) => (
            <li key={value} className={styles.chosenItem}>
              <span className={styles.chosenLabel}>{labelFor(value)}</span>
              <button
                type="button"
                className={forms.linkButton}
                onClick={() => remove(value)}
                disabled={disabled}
                aria-label={`Remove ${labelFor(value)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        id={id}
        className={`${forms.select} ${errors.length > 0 ? forms.invalid : ""}`}
        value=""
        onChange={(event) => {
          if (event.target.value !== "") {
            onChange([...chosen, event.target.value]);
          }
        }}
        disabled={disabled || remaining.length === 0}
        aria-label={`Add to ${label}`}
        aria-describedby={describedBy.length > 0 ? describedBy.join(" ") : undefined}
        aria-invalid={errors.length > 0 ? true : undefined}
      >
        <option value="">{remaining.length === 0 ? "Nothing left to add" : "Add one…"}</option>
        <OptionList options={remaining} />
      </select>
      {errors.length > 0 && (
        <p id={`${id}-error`} className={forms.error}>
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}

interface SinglePickerProps {
  id: string;
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  errors: string[];
}

export function SinglePicker({ id, label, options, value, onChange, disabled, errors }: SinglePickerProps) {
  const known = value === "" || options.some((option) => option.value === value);
  return (
    <div className={forms.field}>
      <label htmlFor={id} className={forms.label}>
        {label}
      </label>
      <select
        id={id}
        className={`${forms.select} ${errors.length > 0 ? forms.invalid : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={errors.length > 0 ? true : undefined}
        aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
      >
        <option value="">Pick one…</option>
        {!known && <option value={value}>{value} (not found)</option>}
        <OptionList options={options} />
      </select>
      {errors.length > 0 && (
        <p id={`${id}-error`} className={forms.error}>
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}
