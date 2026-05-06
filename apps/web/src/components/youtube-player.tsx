import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { AlertCircle, Clock3, ExternalLink, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { corpusClient, type EpisodeSegments } from "@/corpus/client";
import {
  DEFAULT_PLAYBACK_LEAD_SECONDS,
  formatTimestamp,
  type HydratedSegment
} from "@/corpus/hydrate";
import { cn } from "@/lib/cn";

type YouTubePlayerProps = {
  className?: string;
  selectedHit: HydratedSegment | null;
};

type YouTubePlayerApi = {
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  destroy: () => void;
  getCurrentTime: () => number;
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  stopVideo: () => void;
};

type YouTubePlayerEvent = {
  target: YouTubePlayerApi;
};

type YouTubePlayerOptions = {
  events?: {
    onError?: () => void;
    onReady?: (event: YouTubePlayerEvent) => void;
  };
  height?: string;
  playerVars?: Record<string, number | string>;
  videoId?: string;
  width?: string;
};

type YouTubeNamespace = {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerApi;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<YouTubeNamespace> | null = null;

export function YouTubePlayer({ className, selectedHit }: Readonly<YouTubePlayerProps>) {
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const lastLoadedClipRef = useRef<string | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const episodeSegmentsQuery = useQuery({
    queryKey: ["episode-segments", selectedHit?.episode],
    queryFn: () => {
      if (!selectedHit) {
        throw new Error("Episode segments were requested before a clip was selected.");
      }

      return corpusClient.loadEpisodeSegments(selectedHit.episode);
    },
    enabled: selectedHit !== null
  });
  const seekSeconds = selectedHit ? getClipSeekSeconds(selectedHit) : 0;
  const episodeSegmentsState = getEpisodeSegmentsState(selectedHit, episodeSegmentsQuery);
  const activeCaption = useMemo(
    () => getActiveCaption(episodeSegmentsState, currentSeconds),
    [currentSeconds, episodeSegmentsState]
  );

  useEffect(() => {
    if (!selectedHit) {
      playerRef.current?.stopVideo();
      setCurrentSeconds(0);
      lastLoadedClipRef.current = null;
    }
  }, [selectedHit]);

  useEffect(() => {
    if (!selectedHit || !playerHostRef.current || playerRef.current) {
      return;
    }

    let isCurrent = true;
    setPlayerError(null);

    void loadYouTubeIframeApi().then(
      (youTube) => {
        if (!isCurrent || !playerHostRef.current || playerRef.current) {
          return;
        }

        playerRef.current = new youTube.Player(playerHostRef.current, {
          height: "100%",
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0
          },
          videoId: selectedHit.youtubeId,
          width: "100%",
          events: {
            onReady: () => {
              if (isCurrent) {
                setIsPlayerReady(true);
              }
            },
            onError: () => {
              if (isCurrent) {
                setPlayerError("YouTube could not load this video.");
              }
            }
          }
        });
      },
      (error: unknown) => {
        if (isCurrent) {
          setPlayerError(error instanceof Error ? error.message : "Failed to load YouTube player.");
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [selectedHit]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isPlayerReady || !selectedHit || !playerRef.current) {
      return;
    }

    const clipKey = `${selectedHit.youtubeId}:${seekSeconds}`;
    if (lastLoadedClipRef.current === clipKey) {
      return;
    }

    lastLoadedClipRef.current = clipKey;
    setPlayerError(null);
    setCurrentSeconds(seekSeconds);
    playerRef.current.loadVideoById({
      videoId: selectedHit.youtubeId,
      startSeconds: seekSeconds
    });
  }, [isPlayerReady, seekSeconds, selectedHit]);

  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const nextSeconds = playerRef.current?.getCurrentTime();

      if (typeof nextSeconds === "number" && Number.isFinite(nextSeconds)) {
        setCurrentSeconds((previousSeconds) =>
          Math.abs(previousSeconds - nextSeconds) > 0.15 ? nextSeconds : previousSeconds
        );
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [isPlayerReady]);

  const handleBackToClip = useCallback(() => {
    if (!selectedHit || !playerRef.current) {
      return;
    }

    playerRef.current.seekTo(seekSeconds, true);
    setCurrentSeconds(seekSeconds);
  }, [seekSeconds, selectedHit]);

  const seekBy = useCallback((offsetSeconds: number) => {
    if (!playerRef.current) {
      return;
    }

    const nextSeconds = Math.max(0, playerRef.current.getCurrentTime() + offsetSeconds);
    playerRef.current.seekTo(nextSeconds, true);
    setCurrentSeconds(nextSeconds);
  }, []);

  const handleSeekToSegment = useCallback((segment: TranscriptSegment) => {
    if (!playerRef.current) {
      return;
    }

    const nextSeconds = getSegmentSeekSeconds(segment.start);
    playerRef.current.seekTo(nextSeconds, true);
    setCurrentSeconds(nextSeconds);
  }, []);

  useEffect(() => {
    if (!selectedHit || !isPlayerReady) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-5);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(5);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlayerReady, seekBy, selectedHit]);

  return (
    <aside className={cn("grid gap-3", className)}>
      <div className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
        <div className="relative aspect-video bg-foreground">
          <div className="absolute inset-0" ref={playerHostRef} />
          {!selectedHit ? (
            <div className="absolute inset-0 grid place-items-center bg-foreground px-5 text-center text-sm text-primary-foreground/75">
              Select a result to load the clip.
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 border-t border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">
                {selectedHit ? `ep${selectedHit.episode}` : "No clip selected"}
              </p>
              <p className="m-0 mt-1 text-sm font-semibold">
                {selectedHit
                  ? `${selectedHit.timestamp}-${selectedHit.endTimestamp}`
                  : "Choose a segment from the results"}
              </p>
            </div>
            <Button disabled={!selectedHit || !isPlayerReady} onClick={handleBackToClip} size="sm">
              <RotateCcw />
              Back to clip
            </Button>
          </div>
          {selectedHit ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" />
                Player {formatTimestamp(currentSeconds)}
              </span>
              <a
                className="inline-flex items-center gap-1 font-semibold text-secondary transition-colors hover:text-primary"
                href={selectedHit.youtubeTimestampUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open YouTube
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          ) : null}
          {playerError ? (
            <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {playerError}
            </div>
          ) : null}
        </div>
      </div>
      <CaptionPanel
        activeCaption={activeCaption}
        currentSeconds={currentSeconds}
        episodeSegmentsState={episodeSegmentsState}
        onSeekToSegment={handleSeekToSegment}
        selectedHit={selectedHit}
      />
    </aside>
  );
}

type EpisodeSegmentsLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; episodeSegments: EpisodeSegments }
  | { status: "error"; message: string };

type ActiveCaption = {
  end: number;
  segmentKey: string;
  start: number;
  text: string;
};

type TranscriptSegment = EpisodeSegments["segments"][number];

function getEpisodeSegmentsState(
  selectedHit: HydratedSegment | null,
  query: UseQueryResult<EpisodeSegments>
): EpisodeSegmentsLoadState {
  if (!selectedHit) {
    return { status: "idle" };
  }

  if (query.isError && !query.data) {
    return {
      status: "error",
      message: query.error instanceof Error ? query.error.message : "Unknown episode load error"
    };
  }

  if (query.data) {
    return {
      status: "ready",
      episodeSegments: query.data
    };
  }

  return { status: "loading" };
}

function CaptionPanel({
  activeCaption,
  currentSeconds,
  episodeSegmentsState,
  onSeekToSegment,
  selectedHit
}: Readonly<{
  activeCaption: ActiveCaption | null;
  currentSeconds: number;
  episodeSegmentsState: EpisodeSegmentsLoadState;
  onSeekToSegment: (segment: TranscriptSegment) => void;
  selectedHit: HydratedSegment | null;
}>) {
  const activeCaptionRef = useRef<HTMLButtonElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const activeCaptionElement = activeCaptionRef.current;
    const transcriptScrollElement = transcriptScrollRef.current;

    if (!activeCaptionElement || !transcriptScrollElement) {
      return;
    }

    const activeCaptionRect = activeCaptionElement.getBoundingClientRect();
    const transcriptScrollRect = transcriptScrollElement.getBoundingClientRect();
    const nextScrollTop =
      transcriptScrollElement.scrollTop +
      activeCaptionRect.top -
      transcriptScrollRect.top -
      transcriptScrollElement.clientHeight / 2 +
      activeCaptionElement.clientHeight / 2;

    transcriptScrollElement.scrollTo({
      behavior: "smooth",
      top: Math.max(0, nextScrollTop)
    });
  }, [activeCaption?.segmentKey]);

  if (!selectedHit) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
        Transcript will appear here.
      </div>
    );
  }

  if (episodeSegmentsState.status === "loading") {
    return (
      <div className="rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
        Loading episode captions...
      </div>
    );
  }

  if (episodeSegmentsState.status === "error") {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
        Captions failed to load: {episodeSegmentsState.message}
      </div>
    );
  }

  if (episodeSegmentsState.status !== "ready") {
    return (
      <div className="rounded-md border border-border bg-background px-4 py-4 text-sm text-muted-foreground">
        No caption segment at {formatTimestamp(currentSeconds)}.
      </div>
    );
  }

  const activeIndex = activeCaption
    ? episodeSegmentsState.episodeSegments.segments.findIndex(
        (segment) => segment.segmentKey === activeCaption.segmentKey
      )
    : -1;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">Transcript</p>
          <p className="m-0 mt-1 text-sm font-semibold">{episodeSegmentsState.episodeSegments.title}</p>
        </div>
        <span className="text-xs font-semibold text-muted-foreground">
          {formatTimestamp(currentSeconds)}
        </span>
      </div>
      <div
        className="max-h-[min(52vh,560px)] overflow-y-auto px-2 py-3"
        ref={transcriptScrollRef}
      >
        <div className="grid gap-1">
          {episodeSegmentsState.episodeSegments.segments.map((segment, index) => (
            <TranscriptRow
              activeIndex={activeIndex}
              index={index}
              isSelectedSearchHit={selectedHit.segment.segmentKey === segment.segmentKey}
              key={segment.segmentKey}
              onClick={() => onSeekToSegment(segment)}
              ref={(element) => {
                if (activeCaption?.segmentKey === segment.segmentKey) {
                  activeCaptionRef.current = element;
                }
              }}
              segment={segment}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TranscriptRow({
  activeIndex,
  index,
  isSelectedSearchHit,
  onClick,
  ref,
  segment
}: Readonly<{
  activeIndex: number;
  index: number;
  isSelectedSearchHit: boolean;
  onClick: () => void;
  ref: (element: HTMLButtonElement | null) => void;
  segment: TranscriptSegment;
}>) {
  const isActive = activeIndex === index;
  const distanceFromActive = activeIndex >= 0 ? Math.abs(index - activeIndex) : Number.POSITIVE_INFINITY;
  const isNearby = distanceFromActive <= 2;

  return (
    <button
      className={cn(
        "grid w-full grid-cols-[4.5rem_1fr] gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        isActive
          ? "border-secondary bg-card text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
        !isActive && isNearby ? "opacity-85" : null,
        !isActive && !isNearby ? "opacity-55" : null,
        isSelectedSearchHit && !isActive ? "border-primary/40" : null
      )}
      onClick={onClick}
      ref={ref}
      type="button"
    >
      <span
        className={cn(
          "pt-1 text-xs font-semibold tabular-nums",
          isActive ? "text-secondary" : "text-muted-foreground"
        )}
      >
        {formatTimestamp(segment.start)}
      </span>
      <span className="text-sm font-medium leading-7">
        {segment.text}
      </span>
    </button>
  );
}

function getActiveCaption(
  episodeSegmentsState: EpisodeSegmentsLoadState,
  currentSeconds: number
): ActiveCaption | null {
  if (episodeSegmentsState.status !== "ready") {
    return null;
  }

  const activeSegment = findActiveOrPreviousSegment(
    episodeSegmentsState.episodeSegments.segments,
    currentSeconds
  );

  return activeSegment
    ? {
        end: activeSegment.end,
        segmentKey: activeSegment.segmentKey,
        start: activeSegment.start,
        text: activeSegment.text
      }
    : null;
}

function findActiveOrPreviousSegment(segments: TranscriptSegment[], currentSeconds: number) {
  if (segments.length === 0 || currentSeconds < segments[0].start) {
    return null;
  }

  let previousSegment: TranscriptSegment | null = null;

  for (const segment of segments) {
    if (currentSeconds < segment.start) {
      return previousSegment;
    }

    previousSegment = segment;

    if (currentSeconds < segment.end) {
      return segment;
    }
  }

  return previousSegment;
}

function getClipSeekSeconds(hit: HydratedSegment) {
  return getSegmentSeekSeconds(hit.start);
}

function getSegmentSeekSeconds(start: number) {
  return Math.max(0, Math.floor(start - DEFAULT_PLAYBACK_LEAD_SECONDS));
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

function loadYouTubeIframeApi(): Promise<YouTubeNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube player can only load in the browser."));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youTubeApiPromise) {
    return youTubeApiPromise;
  }

  youTubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();

      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube API loaded without a player constructor."));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Failed to load YouTube IFrame API."));
    document.head.appendChild(script);
  });

  return youTubeApiPromise;
}
