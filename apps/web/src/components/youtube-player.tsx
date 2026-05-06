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
  const [episodeSegmentsState, setEpisodeSegmentsState] = useState<EpisodeSegmentsLoadState>({
    status: "idle"
  });
  const seekSeconds = selectedHit ? getClipSeekSeconds(selectedHit) : 0;
  const activeCaption = useMemo(
    () => getActiveCaption(episodeSegmentsState, currentSeconds),
    [currentSeconds, episodeSegmentsState]
  );

  useEffect(() => {
    if (!selectedHit) {
      playerRef.current?.stopVideo();
      setCurrentSeconds(0);
      setEpisodeSegmentsState({ status: "idle" });
      lastLoadedClipRef.current = null;
      return;
    }

    let isCurrent = true;
    setEpisodeSegmentsState({ status: "loading" });

    void corpusClient.loadEpisodeSegments(selectedHit.episode).then(
      (episodeSegments) => {
        if (isCurrent) {
          setEpisodeSegmentsState({ status: "ready", episodeSegments });
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setEpisodeSegmentsState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown episode load error"
          });
        }
      }
    );

    return () => {
      isCurrent = false;
    };
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

function CaptionPanel({
  activeCaption,
  currentSeconds,
  episodeSegmentsState,
  selectedHit
}: Readonly<{
  activeCaption: ActiveCaption | null;
  currentSeconds: number;
  episodeSegmentsState: EpisodeSegmentsLoadState;
  selectedHit: HydratedSegment | null;
}>) {
  if (!selectedHit) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
        Synced captions will appear here.
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

  if (!activeCaption) {
    return (
      <div className="rounded-md border border-border bg-background px-4 py-4 text-sm text-muted-foreground">
        No caption segment at {formatTimestamp(currentSeconds)}.
      </div>
    );
  }

  const isSelectedSegment = activeCaption.segmentKey === selectedHit.segment.segmentKey;

  return (
    <div className="grid gap-3 rounded-md border border-border bg-background px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span>
          {formatTimestamp(activeCaption.start)}-{formatTimestamp(activeCaption.end)}
        </span>
        <span>{activeCaption.segmentKey}</span>
        {isSelectedSegment ? <span className="text-secondary">selected clip</span> : null}
      </div>
      <p className="m-0 text-lg leading-8 text-foreground">{activeCaption.text}</p>
    </div>
  );
}

function getActiveCaption(
  episodeSegmentsState: EpisodeSegmentsLoadState,
  currentSeconds: number
): ActiveCaption | null {
  if (episodeSegmentsState.status !== "ready") {
    return null;
  }

  const activeSegment = episodeSegmentsState.episodeSegments.segments.find(
    (segment) => currentSeconds >= segment.start && currentSeconds < segment.end
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

function getClipSeekSeconds(hit: HydratedSegment) {
  return Math.max(0, Math.floor(hit.start - DEFAULT_PLAYBACK_LEAD_SECONDS));
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
