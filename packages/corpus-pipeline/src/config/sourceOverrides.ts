import { readFile } from "node:fs/promises";

export type EpisodeOverrides = Record<string, number>;
export type ScriptEpisodeOverrides = Record<string, number>;
export type PreferredScriptUrlsByEpisode = Record<number, string>;

export type SourceOverrides = {
  youtubeEpisodeOverrides: EpisodeOverrides;
  scriptEpisodeOverrides: ScriptEpisodeOverrides;
  preferredScriptUrlsByEpisode: PreferredScriptUrlsByEpisode;
  preferredAsrEpisodes: number[];
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

  const scriptEpisodeOverrides = parseScriptEpisodeOverrides(value.scriptEpisodeOverrides);
  const preferredScriptUrlsByEpisode = parsePreferredScriptUrlsByEpisode(
    value.preferredScriptUrlsByEpisode
  );
  const preferredAsrEpisodes = parsePreferredAsrEpisodes(value.preferredAsrEpisodes);

  return {
    youtubeEpisodeOverrides,
    scriptEpisodeOverrides,
    preferredScriptUrlsByEpisode,
    preferredAsrEpisodes
  };
}

function parseScriptEpisodeOverrides(value: unknown): ScriptEpisodeOverrides {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("sourceOverrides.scriptEpisodeOverrides must be a JSON object");
  }

  const overrides: ScriptEpisodeOverrides = {};

  for (const [scriptUrl, episode] of Object.entries(value)) {
    if (!isUrl(scriptUrl)) {
      throw new Error(`Invalid script URL in source overrides: ${scriptUrl}`);
    }

    if (typeof episode !== "number" || !Number.isInteger(episode) || episode <= 0) {
      throw new Error(`Invalid script episode override for ${scriptUrl}: ${String(episode)}`);
    }

    overrides[scriptUrl] = episode;
  }

  return overrides;
}

function parsePreferredScriptUrlsByEpisode(value: unknown): PreferredScriptUrlsByEpisode {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("sourceOverrides.preferredScriptUrlsByEpisode must be a JSON object");
  }

  const preferences: PreferredScriptUrlsByEpisode = {};

  for (const [rawEpisode, scriptUrl] of Object.entries(value)) {
    const episode = Number.parseInt(rawEpisode, 10);
    if (!Number.isSafeInteger(episode) || episode <= 0 || String(episode) !== rawEpisode) {
      throw new Error(`Invalid preferred script episode: ${rawEpisode}`);
    }

    if (typeof scriptUrl !== "string" || !isUrl(scriptUrl)) {
      throw new Error(`Invalid preferred script URL for ep.${rawEpisode}: ${String(scriptUrl)}`);
    }

    preferences[episode] = scriptUrl;
  }

  return preferences;
}

function parsePreferredAsrEpisodes(value: unknown): number[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("sourceOverrides.preferredAsrEpisodes must be an array");
  }

  const episodes = new Set<number>();
  for (const rawEpisode of value) {
    if (typeof rawEpisode !== "number" || !Number.isSafeInteger(rawEpisode) || rawEpisode <= 0) {
      throw new Error(`Invalid preferred ASR episode: ${String(rawEpisode)}`);
    }

    episodes.add(rawEpisode);
  }

  return Array.from(episodes).sort((left, right) => left - right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isYoutubeId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(value);
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
