import type { ManifestEntry } from "@4989/corpus-types";

export const pipelinePackageName = "@4989/corpus-pipeline";

export function isProcessableEpisode(entry: ManifestEntry): boolean {
  return Boolean(entry.youtubeId && entry.hasScript && entry.status !== "ambiguous");
}
