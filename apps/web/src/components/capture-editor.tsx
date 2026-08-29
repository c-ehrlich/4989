import {
  AudioLines,
  Camera,
  CircleAlert,
  Play,
  Scissors,
  ShieldAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  RangeSlider,
  SingleSlider,
  type RangeSliderValue,
} from "@/components/ui/slider";
import { formatTimestamp } from "@/corpus/hydrate";
import type {
  FreegakuPhase,
  FreegakuTargetMismatch,
} from "@/lib/use-freegaku";

export type CaptureSelection = {
  lines: string[];
  selectedText: string;
  start: number;
  end: number;
  windowStart: number;
  windowEnd: number;
};

export type CaptureDraft = {
  end: number;
  frame: number;
  sentence: string;
  start: number;
};

export function CaptureEditor({
  available,
  busy,
  draft,
  error,
  onCancel,
  onConfirm,
  onDraftChange,
  onPreview,
  onSeekFrame,
  phase,
  selection,
  targetMismatch,
}: Readonly<{
  available: boolean;
  busy: boolean;
  draft: CaptureDraft;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onDraftChange: (draft: CaptureDraft) => void;
  onPreview: () => void;
  onSeekFrame: (seconds: number) => void;
  phase: FreegakuPhase;
  selection: CaptureSelection;
  targetMismatch: FreegakuTargetMismatch | null;
}>) {
  const duration = draft.end - draft.start;
  const invalidDuration = duration < 0.25 || duration > 30;
  const canConfirm =
    available && !busy && !invalidDuration && draft.sentence.trim().length > 0;
  const handleRangeChange = (range: RangeSliderValue) => {
    const start = range[0];
    const end = range[1];
    onDraftChange({
      ...draft,
      start,
      end,
      frame: Math.min(end, Math.max(start, draft.frame)),
    });
  };

  return (
    <section className="overflow-hidden rounded-md border border-secondary/50 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-secondary/20 bg-secondary px-4 py-3 text-secondary-foreground">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
            <Scissors className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[0.65rem] font-bold uppercase tracking-[0.18em] opacity-70">
              Freegaku cut
            </p>
            <p className="m-0 truncate text-sm font-semibold">
              Amend the latest Anki card
            </p>
          </div>
        </div>
        <button
          aria-label="Close capture editor"
          className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-5 p-4">
        <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Card sentence
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-medium normal-case leading-6 tracking-normal text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            disabled={busy}
            onChange={(event) =>
              onDraftChange({ ...draft, sentence: event.target.value })
            }
            value={draft.sentence}
          />
        </label>

        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 uppercase tracking-wide text-muted-foreground">
              <AudioLines className="size-3.5" />
              Audio cut
            </span>
            <span className={invalidDuration ? "text-primary" : "text-secondary"}>
              {formatPreciseTime(draft.start)}–{formatPreciseTime(draft.end)} · {duration.toFixed(1)}s
            </span>
          </div>
          <RangeSlider
            disabled={busy}
            getAriaLabel={(index) => (index === 0 ? "Audio start" : "Audio end")}
            max={selection.windowEnd}
            min={selection.windowStart}
            minStepsBetweenValues={5}
            onValueChange={handleRangeChange}
            step={0.05}
            value={[draft.start, draft.end]}
          />
          <div className="flex justify-between text-[0.65rem] font-semibold tabular-nums text-muted-foreground">
            <span>{formatTimestamp(selection.windowStart)}</span>
            <span>{formatTimestamp(selection.windowEnd)}</span>
          </div>
        </div>

        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 uppercase tracking-wide text-muted-foreground">
              <Camera className="size-3.5" />
              Card image
            </span>
            <span className="text-secondary">{formatPreciseTime(draft.frame)}</span>
          </div>
          <SingleSlider
            disabled={busy}
            getAriaLabel={() => "Screenshot time"}
            max={draft.end}
            min={draft.start}
            onValueChange={(frame) => {
              onDraftChange({ ...draft, frame });
              onSeekFrame(frame);
            }}
            step={0.05}
            value={draft.frame}
          />
        </div>

        {invalidDuration ? (
          <InlineNotice>
            Keep the audio between 0.25 and 30 seconds.
          </InlineNotice>
        ) : null}
        {!available ? (
          <InlineNotice>
            Freegaku is not connected. Install or update it, then reload this page.
          </InlineNotice>
        ) : null}
        {targetMismatch ? (
          <div className="grid gap-2.5 rounded-md border border-accent bg-accent/15 px-3 py-3 text-accent-foreground shadow-[inset_3px_0_0_var(--accent)]">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold uppercase tracking-wide">
                  Check the Anki target
                </p>
                <p className="m-0 mt-1 text-sm leading-5">
                  The latest card is <strong>「{targetMismatch.target.word}」</strong>, but that
                  term was not found in this sentence.
                </p>
              </div>
            </div>
            <p className="m-0 pl-6 text-xs leading-5 text-muted-foreground">
              Edit the sentence to check again, close this cut, or update this exact card anyway.
            </p>
          </div>
        ) : null}
        {error ? <InlineNotice>{error}</InlineNotice> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            disabled={busy}
            onClick={onPreview}
            size="sm"
            variant="outline"
          >
            <Play />
            Preview cut
          </Button>
          <Button disabled={!canConfirm} onClick={onConfirm} size="sm">
            <Scissors />
            {busy
              ? phaseLabel(phase)
              : targetMismatch
                ? "Update this card anyway"
                : "Update latest card"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function InlineNotice({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/8 px-3 py-2 text-xs font-medium text-primary">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </div>
  );
}

function phaseLabel(phase: FreegakuPhase) {
  if (phase === "capturing") return "Recording cut…";
  if (phase === "updating-anki") return "Updating Anki…";
  return "Checking Anki…";
}

function formatPreciseTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(2).padStart(5, "0")}`;
}
