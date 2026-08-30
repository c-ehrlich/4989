import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RotateCcw,
  Scissors,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureEditor,
  type CaptureDraft,
  type CaptureSelection,
} from "@/components/capture-editor";
import { Button } from "@/components/ui/button";
import { corpusClient, type EpisodeSegments } from "@/corpus/client";
import {
  DEFAULT_PLAYBACK_LEAD_SECONDS,
  formatTimestamp,
  type HydratedSegment,
} from "@/corpus/hydrate";
import { cn } from "@/lib/cn";
import {
  useFreegaku,
  type FreegakuMiningTarget,
  type FreegakuTargetMismatch,
} from "@/lib/use-freegaku";

type YouTubePlayerProps = {
  className?: string;
  selectedHit: HydratedSegment | null;
};

type YouTubePlayerApi = {
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void;
  pauseVideo: () => void;
  playVideo: () => void;
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
  Player: new (
    element: HTMLElement,
    options: YouTubePlayerOptions,
  ) => YouTubePlayerApi;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<YouTubeNamespace> | null = null;

export function YouTubePlayer({
  className,
  selectedHit,
}: Readonly<YouTubePlayerProps>) {
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerApi | null>(null);
  const lastLoadedClipRef = useRef<string | null>(null);
  const previewIntervalRef = useRef<number | null>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [captureSelection, setCaptureSelection] =
    useState<CaptureSelection | null>(null);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSuccess, setCaptureSuccess] = useState<string | null>(null);
  const [targetMismatch, setTargetMismatch] =
    useState<FreegakuTargetMismatch | null>(null);
  const [isMining, setIsMining] = useState(false);
  const freegaku = useFreegaku();
  const episodeSegmentsQuery = useQuery({
    queryKey: ["episode-segments", selectedHit?.episode],
    queryFn: () => {
      if (!selectedHit) {
        throw new Error(
          "Episode segments were requested before a clip was selected.",
        );
      }

      return corpusClient.loadEpisodeSegments(selectedHit.episode);
    },
    enabled: selectedHit !== null,
  });
  const seekSeconds = selectedHit ? getClipSeekSeconds(selectedHit) : 0;
  const episodeSegmentsState = getEpisodeSegmentsState(
    selectedHit,
    episodeSegmentsQuery,
  );
  const activeCaption = useMemo(
    () => getActiveCaption(episodeSegmentsState, currentSeconds),
    [currentSeconds, episodeSegmentsState],
  );

  useEffect(() => {
    if (!selectedHit) {
      playerRef.current?.stopVideo();
      setCurrentSeconds(0);
      lastLoadedClipRef.current = null;
    }
    setCaptureSelection(null);
    setCaptureDraft(null);
    setCaptureError(null);
    setCaptureSuccess(null);
    setTargetMismatch(null);
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
            rel: 0,
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
            },
          },
        });
      },
      (error: unknown) => {
        if (isCurrent) {
          setPlayerError(
            error instanceof Error
              ? error.message
              : "Failed to load YouTube player.",
          );
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [selectedHit]);

  useEffect(() => {
    return () => {
      if (previewIntervalRef.current !== null) {
        window.clearInterval(previewIntervalRef.current);
      }
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
      startSeconds: seekSeconds,
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
          Math.abs(previousSeconds - nextSeconds) > 0.15
            ? nextSeconds
            : previousSeconds,
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

    const nextSeconds = Math.max(
      0,
      playerRef.current.getCurrentTime() + offsetSeconds,
    );
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

  const stopPreview = useCallback(() => {
    if (previewIntervalRef.current !== null) {
      window.clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
  }, []);

  const handleTranscriptSelection = useCallback(
    (selection: CaptureSelection) => {
      stopPreview();
      const frame = selection.start + (selection.end - selection.start) / 2;
      setCaptureSelection(selection);
      setCaptureDraft({
        start: selection.start,
        end: selection.end,
        frame,
        sentence: selection.selectedText,
      });
      setCaptureError(null);
      setCaptureSuccess(null);
      setTargetMismatch(null);
      playerRef.current?.pauseVideo();
      playerRef.current?.seekTo(frame, true);
      setCurrentSeconds(frame);
    },
    [stopPreview],
  );

  const handlePreviewCapture = useCallback(() => {
    if (!captureDraft || !playerRef.current) return;
    stopPreview();
    playerRef.current.seekTo(captureDraft.start, true);
    playerRef.current.playVideo();
    setCurrentSeconds(captureDraft.start);
    previewIntervalRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || player.getCurrentTime() < captureDraft.end) return;
      player.pauseVideo();
      stopPreview();
    }, 50);
  }, [captureDraft, stopPreview]);

  const handleSeekFrame = useCallback(
    (seconds: number) => {
      stopPreview();
      playerRef.current?.pauseVideo();
      playerRef.current?.seekTo(seconds, true);
      setCurrentSeconds(seconds);
    },
    [stopPreview],
  );

  const handleCancelCapture = useCallback(() => {
    stopPreview();
    setCaptureSelection(null);
    setCaptureDraft(null);
    setCaptureError(null);
    setTargetMismatch(null);
  }, [stopPreview]);

  const handleCaptureDraftChange = useCallback(
    (nextDraft: CaptureDraft) => {
      if (captureDraft && nextDraft.sentence !== captureDraft.sentence) {
        setTargetMismatch(null);
        setCaptureError(null);
      }
      setCaptureDraft(nextDraft);
    },
    [captureDraft],
  );

  const handleConfirmCapture = useCallback(async (targetOverride?: FreegakuMiningTarget) => {
    if (!selectedHit || !captureSelection || !captureDraft || isMining) return;
    setIsMining(true);
    setCaptureError(null);
    stopPreview();
    const lines = captureDraft.sentence
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const result = await freegaku.mine({
      mode: "update",
      lines,
      selectedText: captureSelection.selectedText,
      targetOverride,
      capture: {
        startMs: Math.round(captureDraft.start * 1000),
        endMs: Math.round(captureDraft.end * 1000),
        imageMs: Math.round(captureDraft.frame * 1000),
      },
      video: {
        id: selectedHit.youtubeId,
        title: selectedHit.episodeTitle,
        author: "4989 American Life",
        startSec: Math.floor(captureDraft.start),
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(selectedHit.youtubeId)}&t=${Math.floor(captureDraft.start)}s`,
      },
    });
    setIsMining(false);
    if (!result.ok) {
      if (result.code === "target-word-mismatch") {
        setTargetMismatch(result);
        return;
      }
      setCaptureError(result.error);
      return;
    }
    setCaptureSelection(null);
    setCaptureDraft(null);
    setTargetMismatch(null);
    setCaptureSuccess(
      result.word ? `Updated the latest “${result.word}” card.` : "Updated the latest Anki card.",
    );
  }, [captureDraft, captureSelection, freegaku, isMining, selectedHit, stopPreview]);

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
            <Button
              disabled={!selectedHit || !isPlayerReady}
              onClick={handleBackToClip}
              size="sm"
            >
              <RotateCcw />
              Back to clip
            </Button>
          </div>
          {selectedHit ? (
            <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" />
                Player {formatTimestamp(currentSeconds)}
              </span>
              <div className="flex items-center gap-2">
                <a
                  className="inline-flex items-center gap-1 font-semibold text-secondary transition-colors hover:text-primary"
                  href={selectedHit.youtubeTimestampUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  YouTube
                  <ExternalLink className="size-3.5" />
                </a>
                {selectedHit.scriptUrl ? (
                  <a
                    className="inline-flex items-center gap-1 font-semibold text-secondary transition-colors hover:text-primary"
                    href={selectedHit.scriptUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Script
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
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
      {captureSelection && captureDraft ? (
        <CaptureEditor
          available={freegaku.available}
          busy={isMining}
          draft={captureDraft}
          error={captureError}
          onCancel={handleCancelCapture}
          onConfirm={() => void handleConfirmCapture()}
          onConfirmOverride={() => {
            if (targetMismatch) void handleConfirmCapture(targetMismatch.target);
          }}
          onDraftChange={handleCaptureDraftChange}
          onPreview={handlePreviewCapture}
          onSeekFrame={handleSeekFrame}
          phase={freegaku.phase}
          selection={captureSelection}
          targetMismatch={targetMismatch}
        />
      ) : null}
      {captureSuccess ? (
        <div className="flex items-start gap-2 rounded-md border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm font-medium text-secondary">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {captureSuccess}
        </div>
      ) : null}
      <CaptionPanel
        activeCaption={activeCaption}
        currentSeconds={currentSeconds}
        episodeSegmentsState={episodeSegmentsState}
        onSelectTranscript={handleTranscriptSelection}
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
  query: UseQueryResult<EpisodeSegments>,
): EpisodeSegmentsLoadState {
  if (!selectedHit) {
    return { status: "idle" };
  }

  if (query.isError && !query.data) {
    return {
      status: "error",
      message:
        query.error instanceof Error
          ? query.error.message
          : "Unknown episode load error",
    };
  }

  if (query.data) {
    return {
      status: "ready",
      episodeSegments: query.data,
    };
  }

  return { status: "loading" };
}

function CaptionPanel({
  activeCaption,
  currentSeconds,
  episodeSegmentsState,
  onSelectTranscript,
  onSeekToSegment,
  selectedHit,
}: Readonly<{
  activeCaption: ActiveCaption | null;
  currentSeconds: number;
  episodeSegmentsState: EpisodeSegmentsLoadState;
  onSelectTranscript: (selection: CaptureSelection) => void;
  onSeekToSegment: (segment: TranscriptSegment) => void;
  selectedHit: HydratedSegment | null;
}>) {
  const activeCaptionRef = useRef<HTMLDivElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const [selectionAction, setSelectionAction] = useState<{
    left: number;
    selection: CaptureSelection;
    top: number;
  } | null>(null);

  useEffect(() => {
    const activeCaptionElement = activeCaptionRef.current;
    const transcriptScrollElement = transcriptScrollRef.current;

    if (!activeCaptionElement || !transcriptScrollElement) {
      return;
    }

    const activeCaptionRect = activeCaptionElement.getBoundingClientRect();
    const transcriptScrollRect =
      transcriptScrollElement.getBoundingClientRect();
    const nextScrollTop =
      transcriptScrollElement.scrollTop +
      activeCaptionRect.top -
      transcriptScrollRect.top -
      transcriptScrollElement.clientHeight / 2 +
      activeCaptionElement.clientHeight / 2;

    transcriptScrollElement.scrollTo({
      behavior: "smooth",
      top: Math.max(0, nextScrollTop),
    });
  }, [activeCaption?.segmentKey]);

  useEffect(() => {
    const transcriptElement = transcriptScrollRef.current;
    if (!transcriptElement || episodeSegmentsState.status !== "ready") return;
    const segments = episodeSegmentsState.episodeSegments.segments;

    const updateSelectionAction = () => {
      const selection = window.getSelection();
      const transcriptSelection = selection
        ? readTranscriptSelection(selection, transcriptElement, segments)
        : null;
      if (!transcriptSelection || !selection || selection.rangeCount === 0) {
        setSelectionAction(null);
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - 92,
        Math.max(92, rect.left + rect.width / 2),
      );
      const top = rect.top > 54 ? rect.top - 10 : rect.bottom + 44;
      setSelectionAction({ left, selection: transcriptSelection, top });
    };

    document.addEventListener("selectionchange", updateSelectionAction);
    return () =>
      document.removeEventListener("selectionchange", updateSelectionAction);
  }, [episodeSegmentsState]);

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
        (segment) => segment.segmentKey === activeCaption.segmentKey,
      )
    : -1;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">
            Transcript
          </p>
          <p className="m-0 mt-1 text-sm font-semibold">
            {episodeSegmentsState.episodeSegments.title}
          </p>
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
          {episodeSegmentsState.episodeSegments.segments.map(
            (segment, index) => (
              <TranscriptRow
                activeIndex={activeIndex}
                index={index}
                isSelectedSearchHit={
                  selectedHit.segment.segmentKey === segment.segmentKey
                }
                key={segment.segmentKey}
                onSeek={() => onSeekToSegment(segment)}
                ref={(element) => {
                  if (activeCaption?.segmentKey === segment.segmentKey) {
                    activeCaptionRef.current = element;
                  }
                }}
                segment={segment}
              />
            ),
          )}
        </div>
      </div>
      {selectionAction ? (
        <button
          className="fixed z-50 inline-flex h-9 -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border border-secondary/50 bg-secondary px-3 text-xs font-bold text-secondary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => {
            onSelectTranscript(selectionAction.selection);
            window.getSelection()?.removeAllRanges();
            setSelectionAction(null);
          }}
          onMouseDown={(event) => event.preventDefault()}
          style={{ left: selectionAction.left, top: selectionAction.top }}
          type="button"
        >
          <Scissors className="size-3.5" />
          Cut to Anki
        </button>
      ) : null}
    </div>
  );
}

function TranscriptRow({
  activeIndex,
  index,
  isSelectedSearchHit,
  onSeek,
  ref,
  segment,
}: Readonly<{
  activeIndex: number;
  index: number;
  isSelectedSearchHit: boolean;
  onSeek: () => void;
  ref: (element: HTMLDivElement | null) => void;
  segment: TranscriptSegment;
}>) {
  const isActive = activeIndex === index;
  const distanceFromActive =
    activeIndex >= 0 ? Math.abs(index - activeIndex) : Number.POSITIVE_INFINITY;
  const isNearby = distanceFromActive <= 2;

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[4.5rem_1fr] gap-3 rounded-md border px-3 py-2 text-left transition-colors",
        isActive
          ? "border-secondary bg-card text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
        !isActive && isNearby ? "opacity-85" : null,
        !isActive && !isNearby ? "opacity-55" : null,
        isSelectedSearchHit && !isActive ? "border-primary/40" : null,
      )}
      data-transcript-index={index}
      data-transcript-row=""
      ref={ref}
    >
      <button
        className={cn(
          "h-fit rounded-sm pt-1 text-left text-xs font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          isActive ? "text-secondary" : "text-muted-foreground",
        )}
        onClick={onSeek}
        title={`Seek to ${formatTimestamp(segment.start)}`}
        type="button"
      >
        {formatTimestamp(segment.start)}
      </button>
      <span
        className="cursor-text select-text text-sm font-medium leading-7 selection:bg-accent/60 selection:text-foreground"
        data-transcript-text=""
      >
        {segment.text}
      </span>
    </div>
  );
}

function readTranscriptSelection(
  selection: Selection,
  transcriptElement: HTMLElement,
  segments: TranscriptSegment[],
): CaptureSelection | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!selection.toString().trim()) return null;

  const range = selection.getRangeAt(0);
  if (
    !transcriptElement.contains(range.startContainer) ||
    !transcriptElement.contains(range.endContainer)
  ) {
    return null;
  }

  const startTextElement = getTranscriptTextElement(range.startContainer);
  const endTextElement = getTranscriptTextElement(range.endContainer);
  const startRow = startTextElement?.closest<HTMLElement>(
    "[data-transcript-row]",
  );
  const endRow = endTextElement?.closest<HTMLElement>("[data-transcript-row]");
  if (!startTextElement || !endTextElement || !startRow || !endRow) return null;

  const startIndex = Number(startRow.dataset.transcriptIndex);
  const endIndex = Number(endRow.dataset.transcriptIndex);
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(endIndex) ||
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex >= segments.length
  ) {
    return null;
  }

  const startOffset = getTextOffset(
    startTextElement,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = getTextOffset(
    endTextElement,
    range.endContainer,
    range.endOffset,
  );
  if (startOffset === null || endOffset === null) return null;

  const first = segments[startIndex];
  const last = segments[endIndex];
  if (!first || !last) return null;
  const selectedText =
    startIndex === endIndex
      ? first.text.slice(startOffset, endOffset).trim()
      : [
          first.text.slice(startOffset),
          ...segments
            .slice(startIndex + 1, endIndex)
            .map((segment) => segment.text),
          last.text.slice(0, endOffset),
        ]
          .join("\n")
          .trim();
  if (!selectedText) return null;
  const estimatedStart = estimateCharacterTime(first, startOffset);
  const estimatedEnd = estimateCharacterTime(last, endOffset);
  let start = Math.max(first.start, estimatedStart - 0.25);
  let end = Math.min(last.end, estimatedEnd + 0.25);
  if (end - start < 0.25) {
    start = Math.max(first.start, end - 0.25);
    end = Math.min(last.end, start + 0.25);
  }
  if (!(end > start)) return null;

  return {
    selectedText,
    lines: segments.slice(startIndex, endIndex + 1).map((segment) => segment.text),
    start,
    end,
    windowStart: first.start,
    windowEnd: last.end,
  };
}

function getTranscriptTextElement(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-transcript-text]") ?? null;
}

function getTextOffset(
  textElement: HTMLElement,
  container: Node,
  offset: number,
) {
  if (!textElement.contains(container)) return null;
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(container, offset);
    return Math.min(textElement.textContent?.length ?? 0, range.toString().length);
  } catch {
    return null;
  }
}

function estimateCharacterTime(segment: TranscriptSegment, offset: number) {
  const length = Math.max(1, segment.text.length);
  const fraction = Math.min(1, Math.max(0, offset / length));
  return segment.start + (segment.end - segment.start) * fraction;
}

function getActiveCaption(
  episodeSegmentsState: EpisodeSegmentsLoadState,
  currentSeconds: number,
): ActiveCaption | null {
  if (episodeSegmentsState.status !== "ready") {
    return null;
  }

  const activeSegment = findActiveOrPreviousSegment(
    episodeSegmentsState.episodeSegments.segments,
    currentSeconds,
  );

  return activeSegment
    ? {
        end: activeSegment.end,
        segmentKey: activeSegment.segmentKey,
        start: activeSegment.start,
        text: activeSegment.text,
      }
    : null;
}

function findActiveOrPreviousSegment(
  segments: TranscriptSegment[],
  currentSeconds: number,
) {
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
    return Promise.reject(
      new Error("YouTube player can only load in the browser."),
    );
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
      'script[src="https://www.youtube.com/iframe_api"]',
    );

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () =>
      reject(new Error("Failed to load YouTube IFrame API."));
    document.head.appendChild(script);
  });

  return youTubeApiPromise;
}
