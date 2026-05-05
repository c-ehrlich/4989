const EPISODE_PATTERNS = [
  /(?:^|[^\p{L}\p{N}])ep(?:isode)?\.?\s*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])第\s*0*(\d{1,4})\s*回(?=$|[^\p{L}\p{N}])/u
];

export function parseEpisodeNumberFromTitle(title: string): number | undefined {
  for (const pattern of EPISODE_PATTERNS) {
    const match = pattern.exec(title);
    if (!match?.[1]) {
      continue;
    }

    const episode = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(episode) && episode > 0) {
      return episode;
    }
  }

  return undefined;
}
