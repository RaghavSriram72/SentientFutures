// Labels and descriptions for every category, read from the shared enums.json.
// Never copy values into the frontend by hand: edit shared/sf_shared/enums.py instead.
import enumsJson from "./generated/enums.json";

export type EnumName = keyof typeof enumsJson.enums;

interface EnumValueInfo {
  value: string;
  label: string;
  description: string;
}

export const RUBRIC_VERSION: string = enumsJson.rubric_version;

export function enumValues(name: EnumName): EnumValueInfo[] {
  return enumsJson.enums[name].values;
}

export function isDraftEnum(name: EnumName): boolean {
  return enumsJson.enums[name].draft;
}

function findValue(name: EnumName, value: string): EnumValueInfo | undefined {
  for (const info of enumsJson.enums[name].values) {
    if (info.value === value) {
      return info;
    }
  }
  return undefined;
}

export function enumLabel(name: EnumName, value: string): string {
  const info = findValue(name, value);
  return info ? info.label : value;
}

export function enumDescription(name: EnumName, value: string): string {
  const info = findValue(name, value);
  return info ? info.description : "";
}

export function allEnumNames(): EnumName[] {
  return Object.keys(enumsJson.enums) as EnumName[];
}
