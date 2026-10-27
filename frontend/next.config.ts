import type { NextConfig } from "next";

// GitHub Pages serves a project site under /<repo>, so every URL needs that prefix.
// Set NEXT_PUBLIC_BASE_PATH="/SentientFutures" for Pages, or leave it empty for
// local dev and for a custom domain later.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

if (basePath !== "" && (!basePath.startsWith("/") || basePath.endsWith("/"))) {
  throw new Error(
    `NEXT_PUBLIC_BASE_PATH must look like "/RepoName" (leading slash, no trailing slash). Got "${basePath}".`,
  );
}

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // Everything is rendered at build time, so the runtime caching features are off.
  cacheComponents: false,
  partialPrefetching: false,
};

export default nextConfig;
