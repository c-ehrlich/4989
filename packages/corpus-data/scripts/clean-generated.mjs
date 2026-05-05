import { rm } from "node:fs/promises";

const generatedPaths = [
  "../dist",
  "../data/segments",
  "../data/index",
  "../data/manifest.json",
  "../data/episodes.json",
  "../data/videos.json",
  "../data/scripts.json",
  "../data/scripts.sample.json",
  "../data/build-report.json",
  "../data/video-enumeration-report.json",
  "../data/script-discovery-report.json",
  "../data/script-discovery-report.sample.json"
];

await Promise.all(
  generatedPaths.map((path) =>
    rm(new URL(path, import.meta.url), { force: true, recursive: true })
  )
);
