// next/link and the router add the base path on their own.
// Anything else (raw <a>, <img>, fetch, CSS url()) has to go through withBase().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`withBase expects an absolute path like "/timeline/", got "${path}"`);
  }
  return `${BASE_PATH}${path}`;
}
