import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AlignmentSchema,
  ManifestSchema,
  ScriptsSchema,
  VideosSchema,
  makeEpisodeKey,
  type Manifest,
  type ManifestEntry,
  type Alignment,
  type Script,
  type Video
} from "@4989/corpus-types";

import type { SourceOverrides } from "../config/sourceOverrides.js";

type ResolvedScript = Script & {
  originalEpisode: number;
};

type CanonicalScriptSelection = {
  script: ResolvedScript;
  duplicateCount: number;
  usedPreference: boolean;
};

type AlignmentState =
  | {
      status: "missing";
    }
  | {
      status: "valid";
      path: string;
      alignment: Alignment;
    }
  | {
      status: "invalid";
      path: string;
      message: string;
    };

export type BuildManifestOptions = {
  dataDirectory: string;
  sourceOverrides?: SourceOverrides;
  generatedAt?: string;
};

export type BuildManifestResult = {
  manifest: Manifest;
  manifestPath: string;
};

export async function buildManifest(options: BuildManifestOptions): Promise<BuildManifestResult> {
  const dataDirectory = resolve(options.dataDirectory);
  await mkdir(dataDirectory, { recursive: true });

  const [videos, scripts] = await Promise.all([
    readJsonFile(resolve(dataDirectory, "videos.json")).then((value) => VideosSchema.parse(value)),
    readJsonFile(resolve(dataDirectory, "scripts.json")).then((value) => ScriptsSchema.parse(value))
  ]);

  const videoGroups = groupVideosByEpisode(videos);
  const scriptSelections = selectCanonicalScripts(
    applyScriptEpisodeOverrides(scripts, options.sourceOverrides),
    options.sourceOverrides
  );
  const allEpisodes = collectEpisodeNumbers(videoGroups, scriptSelections);
  const alignmentStates = await readAlignmentStates(dataDirectory, allEpisodes);

  const manifest: Manifest = ManifestSchema.parse({
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    episodes: allEpisodes.map((episode) =>
      buildManifestEntry({
        episode,
        videoGroups,
        scriptSelections,
        alignmentStates
      })
    )
  });

  const manifestPath = resolve(dataDirectory, "manifest.json");
  await writeStableJson(manifestPath, manifest);

  return {
    manifest,
    manifestPath
  };
}

function applyScriptEpisodeOverrides(
  scripts: Script[],
  sourceOverrides: SourceOverrides | undefined
): ResolvedScript[] {
  const scriptEpisodeOverrides = sourceOverrides?.scriptEpisodeOverrides ?? {};

  return scripts.map((script) => ({
    ...script,
    originalEpisode: script.episode,
    episode: scriptEpisodeOverrides[script.url] ?? script.episode
  }));
}

function groupVideosByEpisode(videos: Video[]): Map<number, Video[]> {
  const groups = new Map<number, Video[]>();

  for (const video of videos) {
    if (video.episode === undefined) {
      continue;
    }

    const group = groups.get(video.episode) ?? [];
    group.push(video);
    groups.set(video.episode, group);
  }

  for (const group of groups.values()) {
    group.sort(compareVideosForSelection);
  }

  return groups;
}

function selectCanonicalScripts(
  scripts: ResolvedScript[],
  sourceOverrides: SourceOverrides | undefined = undefined
): Map<number, CanonicalScriptSelection> {
  const groups = new Map<number, ResolvedScript[]>();
  const preferredScriptUrlsByEpisode = sourceOverrides?.preferredScriptUrlsByEpisode ?? {};

  for (const script of scripts) {
    const group = groups.get(script.episode) ?? [];
    group.push(script);
    groups.set(script.episode, group);
  }

  const selections = new Map<number, CanonicalScriptSelection>();

  for (const [episode, group] of groups.entries()) {
    group.sort(compareScriptsForSelection);

    const preferredUrl = preferredScriptUrlsByEpisode[episode];
    const preferredScript = preferredUrl
      ? group.find((script) => script.url === preferredUrl)
      : undefined;

    selections.set(episode, {
      script: preferredScript ?? (group[0] as ResolvedScript),
      duplicateCount: group.length,
      usedPreference: Boolean(preferredScript)
    });
  }

  return selections;
}

function collectEpisodeNumbers(
  videoGroups: Map<number, Video[]>,
  scriptSelections: Map<number, CanonicalScriptSelection>
): number[] {
  return Array.from(new Set([...videoGroups.keys(), ...scriptSelections.keys()])).sort(
    (left, right) => left - right
  );
}

async function readAlignmentStates(
  dataDirectory: string,
  episodes: number[]
): Promise<Map<number, AlignmentState>> {
  const states = new Map<number, AlignmentState>();

  await Promise.all(
    episodes.map(async (episode) => {
      const relativePath = `data/alignments/${makeEpisodeKey(episode)}.json`;
      const absolutePath = resolve(dataDirectory, "alignments", `${makeEpisodeKey(episode)}.json`);

      if (!(await fileExists(absolutePath))) {
        states.set(episode, { status: "missing" });
        return;
      }

      try {
        const alignment = AlignmentSchema.parse(await readJsonFile(absolutePath));
        if (alignment.episode !== episode) {
          states.set(episode, {
            status: "invalid",
            path: relativePath,
            message: `alignment episode ${alignment.episode} does not match manifest episode ${episode}`
          });
          return;
        }

        states.set(episode, { status: "valid", path: relativePath, alignment });
      } catch (error: unknown) {
        states.set(episode, {
          status: "invalid",
          path: relativePath,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })
  );

  return states;
}

function buildManifestEntry(input: {
  episode: number;
  videoGroups: Map<number, Video[]>;
  scriptSelections: Map<number, CanonicalScriptSelection>;
  alignmentStates: Map<number, AlignmentState>;
}): ManifestEntry {
  const videos = input.videoGroups.get(input.episode) ?? [];
  const selectedVideo = videos[0];
  const scriptSelection = input.scriptSelections.get(input.episode);
  const selectedScript = scriptSelection?.script;
  const alignmentState = normalizeAlignmentStateForSelectedVideo(
    input.alignmentStates.get(input.episode) ?? { status: "missing" },
    selectedVideo
  );

  const entry: ManifestEntry = {
    episode: input.episode,
    hasScript: Boolean(selectedScript),
    // TODO(captions): this is provisional until the caption-download step writes
    // durable caption metadata. For now, only validated alignment files prove
    // that a usable caption timing source existed for the episode.
    hasCaption: alignmentState.status === "valid",
    status: resolveStatus({
      hasVideo: Boolean(selectedVideo),
      hasScript: Boolean(selectedScript),
      duplicateVideoCount: videos.length,
      hasUnresolvedDuplicateScripts: scriptSelection
        ? scriptSelection.duplicateCount > 1 && !scriptSelection.usedPreference
        : false,
      alignmentState
    })
  };

  if (selectedVideo) {
    entry.youtubeId = selectedVideo.youtubeId;
    entry.videoUrl = selectedVideo.url;
  }

  if (selectedScript) {
    entry.scriptUrl = selectedScript.url;
  }

  if (alignmentState.status === "valid") {
    entry.alignmentPath = alignmentState.path;
  }

  const notes = buildNotes({
    videos,
    scriptSelection,
    alignmentState
  });
  if (notes) {
    entry.notes = notes;
  }

  return entry;
}

function resolveStatus(input: {
  hasVideo: boolean;
  hasScript: boolean;
  duplicateVideoCount: number;
  hasUnresolvedDuplicateScripts: boolean;
  alignmentState: AlignmentState;
}): ManifestEntry["status"] {
  if (!input.hasVideo) {
    return "missing-video";
  }

  if (!input.hasScript) {
    return "missing-script";
  }

  if (input.duplicateVideoCount > 1 || input.hasUnresolvedDuplicateScripts) {
    return "ambiguous";
  }

  if (input.alignmentState.status === "invalid") {
    return "failed";
  }

  if (input.alignmentState.status === "valid") {
    return "processed";
  }

  return "discovered";
}

function normalizeAlignmentStateForSelectedVideo(
  alignmentState: AlignmentState,
  selectedVideo: Video | undefined
): AlignmentState {
  if (alignmentState.status !== "valid" || !selectedVideo) {
    return alignmentState;
  }

  if (alignmentState.alignment.youtubeId !== selectedVideo.youtubeId) {
    return {
      status: "invalid",
      path: alignmentState.path,
      message: `alignment YouTube ID ${alignmentState.alignment.youtubeId} does not match selected video ${selectedVideo.youtubeId}`
    };
  }

  return alignmentState;
}

function buildNotes(input: {
  videos: Video[];
  scriptSelection: CanonicalScriptSelection | undefined;
  alignmentState: AlignmentState;
}): string | undefined {
  const notes: string[] = [];

  if (input.videos.length > 1) {
    notes.push(`multiple videos found for episode; selected ${input.videos[0]?.youtubeId ?? "none"}`);
  }

  if (input.scriptSelection && input.scriptSelection.duplicateCount > 1) {
    notes.push(
      input.scriptSelection.usedPreference
        ? `multiple scripts found; selected preferred ${input.scriptSelection.script.url}`
        : `multiple scripts found without preference; selected newest only for reference ${input.scriptSelection.script.url}`
    );
  }

  if (
    input.scriptSelection &&
    input.scriptSelection.script.originalEpisode !== input.scriptSelection.script.episode
  ) {
    notes.push(
      `script episode corrected from ${input.scriptSelection.script.originalEpisode} to ${input.scriptSelection.script.episode}`
    );
  }

  if (input.alignmentState.status === "invalid") {
    notes.push(`invalid alignment at ${input.alignmentState.path}: ${input.alignmentState.message}`);
  }

  return notes.length > 0 ? notes.join("; ") : undefined;
}

function compareVideosForSelection(left: Video, right: Video): number {
  return compareOptionalDateDescending(left.publishedAt, right.publishedAt) ||
    left.youtubeId.localeCompare(right.youtubeId);
}

function compareScriptsForSelection(left: Script, right: Script): number {
  return (
    compareOptionalDateDescending(left.publishedAt, right.publishedAt) ||
    compareOptionalDateDescending(left.modifiedAt, right.modifiedAt) ||
    compareOptionalDateDescending(left.lastmod, right.lastmod) ||
    left.url.localeCompare(right.url)
  );
}

function compareOptionalDateDescending(left: string | undefined, right: string | undefined): number {
  if (left && right && left !== right) {
    return right.localeCompare(left);
  }

  if (left && !right) {
    return -1;
  }

  if (!left && right) {
    return 1;
  }

  return 0;
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
