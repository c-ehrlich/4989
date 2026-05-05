import { rm } from "node:fs/promises";

const generatedPaths = [
  "../dist",
  "../data/segments",
  "../data/index",
  "../data/manifest.json",
  "../data/episodes.json",
  "../data/videos.json",
  "../data/build-report.json",
  "../data/video-enumeration-report.json"
];

await Promise.all(
  generatedPaths.map((path) =>
    rm(new URL(path, import.meta.url), { force: true, recursive: true })
  )
);
