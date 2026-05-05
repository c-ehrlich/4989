export type EpisodeStatus =
  | "discovered"
  | "missing-script"
  | "missing-caption"
  | "processed"
  | "failed";

export type ManifestEntry = {
  episode: number;
  youtubeId?: string;
  videoUrl?: string;
  scriptUrl?: string;
  hasScript: boolean;
  hasCaption: boolean;
  status: EpisodeStatus;
  alignmentPath?: string;
};

export type CorpusToken = {
  surface: string;
  lemma: string;
  pos: string;
  reading?: string;
};

export type CorpusSegment = {
  id: number;
  segmentKey: string;
  episode: number;
  youtubeId: string;
  start: number;
  end: number;
  text: string;
  confidence?: number;
  tokens: CorpusToken[];
};
