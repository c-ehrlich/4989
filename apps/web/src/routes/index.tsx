import { createFileRoute } from "@tanstack/react-router";
import { parseSegmentId } from "@4989/corpus-types";
import { Clock3, ExternalLink, RotateCcw, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { RangeSlider, type RangeSliderValue } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hydrateSegmentIds, type HydratedSegment } from "@/corpus/hydrate";
import {
  searchCorpus,
  type SearchCorpusResult,
  type SearchMode
} from "@/corpus/search";
import {
  loadCorpusStaticStatus,
  type CorpusStaticStatus
} from "@/corpus/smoke";

const MAX_RENDERED_RESULTS = 10_000;

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  const [corpusStatus, setCorpusStatus] = useState<CorpusLoadState>({ status: "loading" });
  const [query, setQuery] = useState("食べる");
  const [searchMode, setSearchMode] = useState<SearchMode>("loose");
  const [searchState, setSearchState] = useState<SearchLoadState>({ status: "idle" });
  const [episodeRange, setEpisodeRange] = useState<EpisodeRange>({
    min: 0,
    max: Number.MAX_SAFE_INTEGER
  });

  useEffect(() => {
    let isCurrent = true;

    void loadCorpusStaticStatus()
      .then((result) => {
        if (isCurrent) {
          setCorpusStatus({ status: "ready", result });
          setEpisodeRange({
            min: result.minEpisodeNumber,
            max: result.maxEpisodeNumber
          });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setCorpusStatus({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown corpus load error"
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const readySearchResult = searchState.status === "ready" ? searchState.result : null;

  useEffect(() => {
    if (!readySearchResult) {
      return;
    }

    let isCurrent = true;
    setSearchState((current) =>
      current.status === "ready" && current.result === readySearchResult
        ? { ...current, isFiltering: true }
        : current
    );

    void hydrateVisibleSearchHits(readySearchResult, episodeRange).then(
      ({ filteredTotal, hits }) => {
        if (!isCurrent) {
          return;
        }

        setSearchState((current) =>
          current.status === "ready" && current.result === readySearchResult
            ? {
                ...current,
                filteredTotal,
                hits,
                isFiltering: false
              }
            : current
        );
      },
      (error: unknown) => {
        if (isCurrent) {
          setSearchState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown hydration error"
          });
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [readySearchResult, episodeRange]);

  async function runSearch(nextMode: SearchMode = searchMode) {
    setSearchState({ status: "loading" });

    try {
      const result = await searchCorpus({
        query,
        mode: nextMode,
        limit: MAX_RENDERED_RESULTS
      });
      setSearchState({ status: "ready", result, hits: [], filteredTotal: 0, isFiltering: true });
    } catch (error: unknown) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown search error"
      });
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function handleSearchModeChange(value: string) {
    const nextMode = value as SearchMode;
    setSearchMode(nextMode);

    if (query.trim()) {
      void runSearch(nextMode);
    }
  }

  return (
    <main className="min-h-screen px-5 py-8 text-foreground sm:px-8">
      <section className="mx-auto grid max-w-6xl gap-6">
        <div className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-secondary">4989 American Life</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
              Corpus Search
            </h1>
          </div>
          <Tabs
            value={searchMode}
            onValueChange={handleSearchModeChange}
          >
            <TabsList aria-label="Search mode">
              <TabsTrigger value="exact">Exact</TabsTrigger>
              <TabsTrigger value="loose">Loose</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Panel>
          <PanelHeader>
            <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleSearch}>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="食べる"
                  aria-label="Search query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Button disabled={searchState.status === "loading"} type="submit">
                <Search />
                {searchState.status === "loading" ? "Searching" : "Search"}
              </Button>
            </form>
          </PanelHeader>
          <PanelBody>
            {corpusStatus.status === "error" ? <CorpusStatusError state={corpusStatus} /> : null}
            {corpusStatus.status === "ready" ? (
              <EpisodeRangeFilter
                bounds={{
                  min: corpusStatus.result.minEpisodeNumber,
                  max: corpusStatus.result.maxEpisodeNumber
                }}
                range={episodeRange}
                onChange={setEpisodeRange}
                onReset={() =>
                  setEpisodeRange({
                    min: corpusStatus.result.minEpisodeNumber,
                    max: corpusStatus.result.maxEpisodeNumber
                  })
                }
              />
            ) : null}
            <SearchResults state={searchState} />
          </PanelBody>
        </Panel>
      </section>
    </main>
  );
}

type SearchLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      result: SearchCorpusResult;
      hits: HydratedSegment[];
      filteredTotal: number;
      isFiltering: boolean;
    }
  | { status: "error"; message: string };

type EpisodeRange = {
  min: number;
  max: number;
};

type CorpusLoadState =
  | { status: "loading" }
  | { status: "ready"; result: CorpusStaticStatus }
  | { status: "error"; message: string };

function CorpusStatusError({ state }: Readonly<{ state: Extract<CorpusLoadState, { status: "error" }> }>) {
  return (
    <div className="mb-5 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
      Corpus assets failed to load: {state.message}
    </div>
  );
}

function EpisodeRangeFilter({
  bounds,
  onReset,
  range,
  onChange
}: Readonly<{
  bounds: EpisodeRange;
  range: EpisodeRange;
  onChange: (range: EpisodeRange) => void;
  onReset: () => void;
}>) {
  const minValue = clampEpisode(range.min, bounds);
  const maxValue = clampEpisode(range.max, bounds);
  const isFiltered = minValue !== bounds.min || maxValue !== bounds.max;

  return (
    <div className="mb-5 grid gap-4 rounded-md border border-border bg-background px-4 py-3 text-sm md:grid-cols-[auto_1fr_auto] md:items-center">
      <div className="min-w-32">
        <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">Episodes</p>
        <p className="m-0 mt-1 font-semibold">
          ep{minValue}-ep{maxValue}
        </p>
      </div>
      <RangeSlider
        getAriaLabel={(index) => (index === 0 ? "Minimum episode" : "Maximum episode")}
        max={bounds.max}
        min={bounds.min}
        minStepsBetweenValues={0}
        onValueChange={(value) => onChange(rangeSliderValueToEpisodeRange(value))}
        step={1}
        value={[minValue, maxValue]}
      />
      <Button disabled={!isFiltered} onClick={onReset} size="sm" variant="outline">
        <RotateCcw />
        Reset
      </Button>
    </div>
  );
}

function SearchResults({ state }: Readonly<{ state: SearchLoadState }>) {
  if (state.status === "idle") {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
        Run a search to see matching segments.
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="rounded-md border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
        Searching corpus indexes...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
        Search failed: {state.message}
      </div>
    );
  }

  if (state.result.total === 0) {
    return (
      <div className="rounded-md border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
        No segments found for {state.result.query}.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm">
        <span className="font-semibold">{state.result.total.toLocaleString()} matches</span>
        <span className="font-semibold text-secondary">
          {state.filteredTotal.toLocaleString()} in range
        </span>
        {state.filteredTotal > state.hits.length ? (
          <span className="text-muted-foreground">
            showing first {state.hits.length.toLocaleString()}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {state.result.mode} search for {state.result.query}
        </span>
        {state.result.matchedTerms.length > 0 ? (
          <span className="text-muted-foreground">
            terms: {state.result.matchedTerms.join(", ")}
          </span>
        ) : null}
        {state.isFiltering ? <span className="text-muted-foreground">updating...</span> : null}
      </div>
      {state.filteredTotal === 0 ? (
        <div className="rounded-md border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
          No matches in the selected episode range.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.hits.map((hit) => (
            <ResultRow hit={hit} key={hit.segmentId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({ hit }: Readonly<{ hit: HydratedSegment }>) {
  return (
    <article className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm shadow-sm sm:col-span-2 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-muted-foreground">
        <span>ep{hit.episode}</span>
        <a
          className="inline-flex items-center gap-1 text-secondary transition-colors hover:text-primary"
          href={hit.youtubeTimestampUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Clock3 className="size-3.5" />
          {hit.timestamp}-{hit.endTimestamp}
        </a>
        {hit.confidence === undefined ? null : (
          <span>{Math.round(hit.confidence * 100)}% confidence</span>
        )}
        <span>{hit.segment.segmentKey}</span>
      </div>
      <p className="m-0 text-base leading-8 text-foreground">{hit.text}</p>
      <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="line-clamp-1">{hit.title}</span>
        <a
          className="inline-flex items-center gap-1 font-semibold text-secondary transition-colors hover:text-primary"
          href={hit.youtubeTimestampUrl}
          rel="noreferrer"
          target="_blank"
        >
          YouTube
          <ExternalLink className="size-3.5" />
        </a>
        {hit.scriptUrl ? (
          <a
            className="inline-flex items-center gap-1 font-semibold text-secondary transition-colors hover:text-primary"
            href={hit.scriptUrl}
            rel="noreferrer"
            target="_blank"
          >
            Script
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

async function hydrateVisibleSearchHits(result: SearchCorpusResult, range: EpisodeRange) {
  const filteredSegmentIds = result.allSegmentIds.filter((segmentId) => {
    const { episode } = parseSegmentId(segmentId);
    return episode >= range.min && episode <= range.max;
  });
  const visibleSegmentIds = filteredSegmentIds.slice(0, MAX_RENDERED_RESULTS);

  return {
    filteredTotal: filteredSegmentIds.length,
    hits:
      visibleSegmentIds.length > 0
        ? await hydrateSegmentIds({ segmentIds: visibleSegmentIds })
        : []
  };
}

function clampEpisode(value: number, bounds: EpisodeRange) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function rangeSliderValueToEpisodeRange(value: RangeSliderValue): EpisodeRange {
  return {
    min: Math.min(value[0], value[1]),
    max: Math.max(value[0], value[1])
  };
}
