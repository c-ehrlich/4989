import { readFile } from "node:fs/promises";

export type EpisodeOverrides = Record<string, number>;

export type SourceOverrides = {
  youtubeEpisodeOverrides: EpisodeOverrides;
};

export async function readSourceOverrides(path: string): Promise<SourceOverrides> {
  const rawValue = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseSourceOverrides(rawValue);
}

export function parseSourceOverrides(value: unknown): SourceOverrides {
  if (!isRecord(value)) {
    throw new Error("Source overrides must be a JSON object");
  }

  const rawYoutubeEpisodeOverrides = value.youtubeEpisodeOverrides;
  if (!isRecord(rawYoutubeEpisodeOverrides)) {
    throw new Error("Source overrides must include youtubeEpisodeOverrides");
  }

  const youtubeEpisodeOverrides: EpisodeOverrides = {};

  for (const [youtubeId, episode] of Object.entries(rawYoutubeEpisodeOverrides)) {
    if (!isYoutubeId(youtubeId)) {
      throw new Error(`Invalid YouTube ID in source overrides: ${youtubeId}`);
    }

    if (typeof episode !== "number" || !Number.isInteger(episode) || episode <= 0) {
      throw new Error(`Invalid episode override for ${youtubeId}: ${String(episode)}`);
    }

    youtubeEpisodeOverrides[youtubeId] = episode;
  }

  return { youtubeEpisodeOverrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isYoutubeId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(value);
}
