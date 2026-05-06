import { makeEpisodeKey } from "@4989/corpus-types";

export type IndexBucketName = string;

const INDEX_BUCKET_PATTERN = /^[a-f0-9]{2}$/;

export function normalizeDataBasePath(basePath = "/data") {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

export function episodesPath(basePath?: string) {
  return joinDataPath(basePath, "episodes.json");
}

export function surfaceToLemmasPath(basePath?: string) {
  return joinDataPath(basePath, "index", "surface-to-lemmas.json");
}

export function episodeSegmentsPath(episode: number, basePath?: string) {
  return joinDataPath(basePath, "segments", `${makeEpisodeKey(episode)}.json`);
}

export function lemmaBucketPath(bucketName: IndexBucketName, basePath?: string) {
  assertIndexBucketName(bucketName);
  return joinDataPath(basePath, "index", "lemma-buckets", `${bucketName}.json`);
}

export function surfaceBucketPath(bucketName: IndexBucketName, basePath?: string) {
  assertIndexBucketName(bucketName);
  return joinDataPath(basePath, "index", "surface-buckets", `${bucketName}.json`);
}

export async function getIndexBucketName(value: string): Promise<IndexBucketName> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 1)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function assertIndexBucketName(bucketName: string): asserts bucketName is IndexBucketName {
  if (!INDEX_BUCKET_PATTERN.test(bucketName)) {
    throw new Error(`Invalid index bucket name: ${bucketName}`);
  }
}

function joinDataPath(basePath: string | undefined, ...parts: string[]) {
  return [normalizeDataBasePath(basePath), ...parts.map((part) => encodePathPart(part))]
    .filter(Boolean)
    .join("/");
}

function encodePathPart(part: string) {
  return part
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
