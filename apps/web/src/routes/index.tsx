import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { parseSegmentId } from "@4989/corpus-types";
import { Clock3, Play, RotateCcw, Search, Sparkles } from "lucide-react";
import {
  type FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { RangeSlider, type RangeSliderValue } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { YouTubePlayer } from "@/components/youtube-player";
import { getSearchHighlightParts } from "@/corpus/highlight";
import { hydrateSegmentIds, type HydratedSegment } from "@/corpus/hydrate";
import {
  searchCorpus,
  type SearchCorpusResult,
  type SearchMode,
} from "@/corpus/search";
import {
  loadCorpusStaticStatus,
  type CorpusStaticStatus,
} from "@/corpus/smoke";

const MAX_RENDERED_RESULTS = 10_000;
const PAGE_TITLE = "4989単語調べ";
const EPISODE_RANGE_URL_DEBOUNCE_MS = 300;

export const Route = createFileRoute("/")({
  validateSearch: validateRouteSearch,
  head: ({ match }) => ({
    meta: [
      {
        title: match.search.q ? `${PAGE_TITLE}・${match.search.q}` : PAGE_TITLE,
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const urlSearch = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const searchMode: SearchMode = urlSearch.mode ?? "loose";
  const submittedSearch = urlSearch.q
    ? {
        query: urlSearch.q,
        mode: searchMode,
      }
    : null;
  const [query, setQuery] = useState(urlSearch.q ?? "食べる");
  const [searchRequestId, setSearchRequestId] = useState(0);
  const [episodeRange, setEpisodeRange] = useState<EpisodeRange>({
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  const episodeRangeUrlTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const deferredEpisodeRange = useDeferredValue(episodeRange);
  const corpusStatusQuery = useQuery({
    queryKey: ["corpus-status"],
    queryFn: () => loadCorpusStaticStatus(),
  });
  const searchQuery = useQuery({
    queryKey: ["corpus-search", submittedSearch, searchRequestId],
    queryFn: () => {
      if (!submittedSearch) {
        throw new Error(
          "Search query was requested before a query was submitted.",
        );
      }

      return searchCorpus({
        query: submittedSearch.query,
        mode: submittedSearch.mode,
        limit: MAX_RENDERED_RESULTS,
      });
    },
    enabled: submittedSearch !== null,
    placeholderData: keepPreviousData,
  });
  const hydratedHitsInput = useMemo(
    () =>
      searchQuery.data
        ? getVisibleSearchHitInput(searchQuery.data, deferredEpisodeRange)
        : null,
    [deferredEpisodeRange, searchQuery.data],
  );
  const hydratedHitsQuery = useQuery({
    queryKey: [
      "hydrated-search-hits",
      searchQuery.dataUpdatedAt,
      searchQuery.data?.query,
      searchQuery.data?.mode,
      deferredEpisodeRange.min,
      deferredEpisodeRange.max,
    ],
    queryFn: async () => {
      if (!hydratedHitsInput) {
        throw new Error(
          "Hydration was requested before search results were ready.",
        );
      }

      return {
        filteredTotal: hydratedHitsInput.filteredTotal,
        hits:
          hydratedHitsInput.visibleSegmentIds.length > 0
            ? await hydrateSegmentIds({
                segmentIds: hydratedHitsInput.visibleSegmentIds,
              })
            : [],
      };
    },
    enabled: hydratedHitsInput !== null,
    placeholderData: keepPreviousData,
  });

  const corpusStatusState = getCorpusStatusState(corpusStatusQuery);
  const selectedHitFromResults =
    urlSearch.clip && hydratedHitsQuery.data
      ? hydratedHitsQuery.data.hits.find(
          (hit) => hit.segmentId === urlSearch.clip,
        )
      : null;
  const selectedClipQuery = useQuery({
    queryKey: ["selected-clip", urlSearch.clip],
    queryFn: async () => {
      if (!urlSearch.clip) {
        throw new Error("Selected clip was requested before a clip was set.");
      }

      const [hit] = await hydrateSegmentIds({ segmentIds: [urlSearch.clip] });
      return hit;
    },
    enabled: Boolean(urlSearch.clip) && !selectedHitFromResults,
  });
  const selectedHit = selectedHitFromResults ?? selectedClipQuery.data ?? null;
  const searchState = getSearchState({
    isRangePending: deferredEpisodeRange !== episodeRange,
    hydratedHitsInput,
    hydratedHitsQuery,
    searchQuery,
    submittedSearch,
  });

  useEffect(() => {
    setQuery(urlSearch.q ?? "食べる");
  }, [urlSearch.q]);

  useEffect(() => {
    const corpusStatus = corpusStatusQuery.data;
    if (!corpusStatus) {
      return;
    }

    clearPendingEpisodeRangeUrlUpdate();
    setEpisodeRange(
      getEpisodeRangeFromSearch(urlSearch.episodes, {
        min: corpusStatus.minEpisodeNumber,
        max: corpusStatus.maxEpisodeNumber,
      }),
    );
  }, [corpusStatusQuery.data, urlSearch.episodes]);

  useEffect(
    () => () => {
      if (episodeRangeUrlTimer.current !== null) {
        clearTimeout(episodeRangeUrlTimer.current);
      }
    },
    [],
  );

  function runSearch(nextMode: SearchMode = searchMode) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    setSearchRequestId((current) => current + 1);
    void navigate({
      search: (previous) =>
        cleanRouteSearch({
          ...previous,
          q: trimmedQuery,
          mode: modeToSearchParam(nextMode),
          clip: undefined,
        }),
    });
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function handleSearchModeChange(value: string) {
    const nextMode = value as SearchMode;

    if (query.trim()) {
      runSearch(nextMode);
      return;
    }

    void navigate({
      search: (previous) =>
        cleanRouteSearch({
          ...previous,
          mode: modeToSearchParam(nextMode),
        }),
      replace: true,
    });
  }

  function handleEpisodeRangeChange(nextRange: EpisodeRange) {
    setEpisodeRange(nextRange);

    if (corpusStatusState.status !== "ready") {
      return;
    }

    const bounds = {
      min: corpusStatusState.result.minEpisodeNumber,
      max: corpusStatusState.result.maxEpisodeNumber,
    };

    clearPendingEpisodeRangeUrlUpdate();
    episodeRangeUrlTimer.current = setTimeout(() => {
      episodeRangeUrlTimer.current = null;
      updateEpisodeRangeUrl(nextRange, bounds);
    }, EPISODE_RANGE_URL_DEBOUNCE_MS);
  }

  function handleEpisodeRangeReset() {
    if (corpusStatusState.status !== "ready") {
      return;
    }

    clearPendingEpisodeRangeUrlUpdate();

    const nextRange = {
      min: corpusStatusState.result.minEpisodeNumber,
      max: corpusStatusState.result.maxEpisodeNumber,
    };

    setEpisodeRange(nextRange);
    updateEpisodeRangeUrl(nextRange, nextRange);
  }

  function updateEpisodeRangeUrl(nextRange: EpisodeRange, bounds: EpisodeRange) {
    void navigate({
      search: (previous) =>
        cleanRouteSearch({
          ...previous,
          episodes: serializeEpisodeRange(nextRange, bounds),
        }),
      replace: true,
    });
  }

  function clearPendingEpisodeRangeUrlUpdate() {
    if (episodeRangeUrlTimer.current === null) {
      return;
    }

    clearTimeout(episodeRangeUrlTimer.current);
    episodeRangeUrlTimer.current = null;
  }

  function handleSelectHit(hit: HydratedSegment) {
    void navigate({
      search: (previous) =>
        cleanRouteSearch({
          ...previous,
          clip: hit.segmentId,
        }),
    });
  }

  return (
    <main className="min-h-screen px-5 py-8 text-foreground sm:px-8">
      <section className="mx-auto grid max-w-[1440px] gap-2">
        <TitleSection />

        <Panel>
          <PanelHeader>
            <form
              className="flex flex-col gap-3 md:flex-row"
              onSubmit={handleSearch}
            >
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
              <Tabs value={searchMode} onValueChange={handleSearchModeChange}>
                <TabsList aria-label="Search mode" className="h-11">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <TabsTrigger className="h-9" value="loose">
                          Loose
                        </TabsTrigger>
                      }
                    />
                    <TooltipContent>
                      Finds matching forms of the same word, like 食べる and
                      食べた.
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <TabsTrigger className="h-9" value="exact">
                          Exact
                        </TabsTrigger>
                      }
                    />
                    <TooltipContent>
                      Finds only the exact text you typed.
                    </TooltipContent>
                  </Tooltip>
                </TabsList>
              </Tabs>
              <Button
                className="h-11"
                disabled={searchState.status === "loading"}
                type="submit"
              >
                <Search />
                {searchState.status === "loading" ? "Searching" : "Search"}
              </Button>
            </form>
          </PanelHeader>
          <PanelBody>
            {corpusStatusState.status === "error" ? (
              <CorpusStatusError state={corpusStatusState} />
            ) : null}
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] xl:items-start">
              <div className="grid gap-5">
                <SearchFilterBar
                  episodeBounds={
                    corpusStatusState.status === "ready"
                      ? {
                          min: corpusStatusState.result.minEpisodeNumber,
                          max: corpusStatusState.result.maxEpisodeNumber,
                        }
                      : null
                  }
                  episodeRange={episodeRange}
                  onEpisodeRangeChange={handleEpisodeRangeChange}
                  onEpisodeRangeReset={handleEpisodeRangeReset}
                />
                <SearchResults
                  onSelectHit={handleSelectHit}
                  selectedHit={selectedHit}
                  state={searchState}
                />
              </div>
              <YouTubePlayer
                className="xl:sticky xl:top-6"
                selectedHit={selectedHit}
              />
            </div>
          </PanelBody>
        </Panel>
      </section>
    </main>
  );
}

function TitleSection() {
  return (
    <header
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ fontFamily: '"Courier New", Courier, monospace' }}
    >
      <div className="flex items-center gap-4">
        <div className="relative grid size-20 shrink-0 place-items-center sm:size-24">
          <div className="absolute inset-2 rounded-full border-[7px] border-[#f35a1c]" />
          <Sparkles
            aria-hidden="true"
            className="absolute left-0 top-1 size-5 rotate-[-18deg] fill-[#f0b516] text-[#f0b516]"
          />
          <Sparkles
            aria-hidden="true"
            className="absolute right-1 top-0 size-6 rotate-12 fill-[#f35a1c] text-[#f35a1c]"
          />
          <Sparkles
            aria-hidden="true"
            className="absolute bottom-1 right-0 size-5 rotate-[20deg] fill-[#f0b516] text-[#f0b516]"
          />
          <div className="relative grid grid-cols-2 text-center text-[2rem] font-black leading-none tracking-normal">
            <span className="text-[#8a8d90]">4</span>
            <span className="text-[#202321]">9</span>
            <span className="text-[#202321]">8</span>
            <span className="text-[#8a8d90]">9</span>
          </div>
        </div>
        <div>
          <p className="m-0 text-2xl font-black tracking-wide">
            <span className="text-[#202321]">A</span>
            <span className="text-[#4a91cf]">m</span>
            <span className="text-[#202321]">e</span>
            <span className="text-[#4a91cf]">r</span>
            <span className="text-[#f35a1c]">i</span>
            <span className="text-[#4a91cf]">c</span>
            <span className="text-[#202321]">a</span>
            <span className="text-[#4a91cf]">n</span>
            <span> </span>
            <span className="text-[#202321]">L</span>
            <span className="text-[#f0b516]">i</span>
            <span className="text-[#202321]">f</span>
            <span className="text-[#f0b516]">e</span>
          </p>
          <h1 className="m-0 mt-1 text-4xl font-black tracking-normal text-foreground sm:text-5xl">
            <span className="text-[#4a91cf]">単語</span>
            <span className="text-[#f0b516]">調べ</span>
          </h1>
        </div>
      </div>
    </header>
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

type SubmittedSearch = {
  mode: SearchMode;
  query: string;
};

type RouteSearch = {
  clip?: number;
  episodes?: string;
  mode?: "exact";
  q?: string;
};

type HydratedSearchHits = {
  filteredTotal: number;
  hits: HydratedSegment[];
};

type HydratedHitsInput = {
  filteredTotal: number;
  visibleSegmentIds: number[];
};

type EpisodeRange = {
  min: number;
  max: number;
};

type CorpusLoadState =
  | { status: "loading" }
  | { status: "ready"; result: CorpusStaticStatus }
  | { status: "error"; message: string };

function CorpusStatusError({
  state,
}: Readonly<{ state: Extract<CorpusLoadState, { status: "error" }> }>) {
  return (
    <div className="mb-5 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
      Corpus assets failed to load: {state.message}
    </div>
  );
}

function SearchFilterBar({
  episodeBounds,
  episodeRange,
  onEpisodeRangeChange,
  onEpisodeRangeReset,
}: Readonly<{
  episodeBounds: EpisodeRange | null;
  episodeRange: EpisodeRange;
  onEpisodeRangeChange: (range: EpisodeRange) => void;
  onEpisodeRangeReset: () => void;
}>) {
  const minValue = episodeBounds
    ? clampEpisode(episodeRange.min, episodeBounds)
    : 0;
  const maxValue = episodeBounds
    ? clampEpisode(episodeRange.max, episodeBounds)
    : 0;
  const isFiltered = episodeBounds
    ? minValue !== episodeBounds.min || maxValue !== episodeBounds.max
    : false;

  return (
    <div className="grid gap-4 rounded-md border border-border bg-background px-4 py-3 text-sm md:grid-cols-[auto_minmax(14rem,1fr)_auto] md:items-center">
      <div className="min-w-32">
        <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">
          Episodes
        </p>
        <p className="m-0 mt-1 font-semibold">
          {episodeBounds ? `ep${minValue}-ep${maxValue}` : "Loading"}
        </p>
      </div>
      {episodeBounds ? (
        <RangeSlider
          getAriaLabel={(index) =>
            index === 0 ? "Minimum episode" : "Maximum episode"
          }
          max={episodeBounds.max}
          min={episodeBounds.min}
          minStepsBetweenValues={0}
          onValueChange={(value) =>
            onEpisodeRangeChange(rangeSliderValueToEpisodeRange(value))
          }
          step={1}
          value={[minValue, maxValue]}
        />
      ) : (
        <div className="h-6 rounded-full bg-muted" />
      )}
      <Button
        disabled={!isFiltered}
        onClick={onEpisodeRangeReset}
        size="sm"
        variant="outline"
      >
        <RotateCcw />
        Reset
      </Button>
    </div>
  );
}

function SearchResults({
  onSelectHit,
  selectedHit,
  state,
}: Readonly<{
  onSelectHit: (hit: HydratedSegment) => void;
  selectedHit: HydratedSegment | null;
  state: SearchLoadState;
}>) {
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
        <span className="font-semibold">
          {state.filteredTotal < state.result.total
            ? `${state.filteredTotal.toLocaleString()}/`
            : null}
          {state.result.total.toLocaleString()} matches
        </span>
        {state.filteredTotal > state.hits.length ? (
          <span className="text-muted-foreground">
            showing first {state.hits.length.toLocaleString()}
          </span>
        ) : null}
        {state.isFiltering ? (
          <span className="text-muted-foreground">updating...</span>
        ) : null}
      </div>
      {state.filteredTotal === 0 ? (
        <div className="rounded-md border border-border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
          No matches in the selected episode range.
        </div>
      ) : (
        <div className="grid gap-2">
          {state.hits.map((hit) => (
            <ResultRow
              hit={hit}
              isSelected={selectedHit?.segmentId === hit.segmentId}
              key={hit.segmentId}
              onSelect={() => onSelectHit(hit)}
              searchHighlight={{
                query: state.result.query,
                mode: state.result.mode,
                matchedTerms: state.result.matchedTerms,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  hit,
  isSelected,
  onSelect,
  searchHighlight,
}: Readonly<{
  hit: HydratedSegment;
  isSelected: boolean;
  onSelect: () => void;
  searchHighlight: Pick<SearchCorpusResult, "query" | "mode" | "matchedTerms">;
}>) {
  const textParts = getSearchHighlightParts(hit.segment, searchHighlight);

  return (
    <article
      className={[
        "grid gap-3 rounded-md border bg-card p-4 text-sm shadow-sm transition-colors",
        isSelected ? "border-primary" : "border-border",
      ].join(" ")}
    >
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
      </div>
      <p className="m-0 text-base leading-8 text-foreground">
        {textParts.map((part, index) =>
          part.highlighted ? (
            <strong className="font-bold" key={index}>
              {part.text}
            </strong>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <div className="flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="line-clamp-1">{hit.title}</span>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onSelect}
            size="sm"
            type="button"
            variant={isSelected ? "default" : "outline"}
          >
            <Play />
            {isSelected ? "Loaded" : "Load clip"}
          </Button>
        </div>
      </div>
    </article>
  );
}

function getCorpusStatusState(
  query: UseQueryResult<CorpusStaticStatus>,
): CorpusLoadState {
  if (query.isError) {
    return {
      status: "error",
      message:
        query.error instanceof Error
          ? query.error.message
          : "Unknown corpus load error",
    };
  }

  if (query.data) {
    return {
      status: "ready",
      result: query.data,
    };
  }

  return { status: "loading" };
}

function validateRouteSearch(search: Record<string, unknown>): RouteSearch {
  return cleanRouteSearch({
    q: parseSearchText(search.q),
    mode: search.mode === "exact" ? "exact" : undefined,
    clip: parsePositiveInteger(search.clip),
    episodes: parseEpisodeRangeParam(search.episodes),
  });
}

function cleanRouteSearch(search: Partial<RouteSearch>): RouteSearch {
  const nextSearch: RouteSearch = {};

  const q = parseSearchText(search.q);
  if (q) {
    nextSearch.q = q;
  }

  if (search.mode === "exact") {
    nextSearch.mode = "exact";
  }

  const clip = parsePositiveInteger(search.clip);
  if (clip !== undefined) {
    nextSearch.clip = clip;
  }

  const episodes = parseEpisodeRangeParam(search.episodes);
  if (episodes) {
    nextSearch.episodes = episodes;
  }

  return nextSearch;
}

function parseSearchText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown) {
  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return undefined;
  }

  return parsedValue;
}

function parseEpisodeRangeParam(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return undefined;
  }

  const firstEpisode = Number(match[1]);
  const secondEpisode = Number(match[2]);
  if (!Number.isInteger(firstEpisode) || !Number.isInteger(secondEpisode)) {
    return undefined;
  }

  const minEpisode = Math.min(firstEpisode, secondEpisode);
  const maxEpisode = Math.max(firstEpisode, secondEpisode);
  return `${minEpisode}-${maxEpisode}`;
}

function modeToSearchParam(mode: SearchMode) {
  return mode === "exact" ? "exact" : undefined;
}

function serializeEpisodeRange(range: EpisodeRange, bounds: EpisodeRange) {
  const minEpisode = clampEpisode(range.min, bounds);
  const maxEpisode = clampEpisode(range.max, bounds);

  if (minEpisode === bounds.min && maxEpisode === bounds.max) {
    return undefined;
  }

  return `${minEpisode}-${maxEpisode}`;
}

function getEpisodeRangeFromSearch(
  value: string | undefined,
  bounds: EpisodeRange,
): EpisodeRange {
  if (!value) {
    return bounds;
  }

  const [minValue, maxValue] = value.split("-").map(Number);
  return {
    min: clampEpisode(Math.min(minValue, maxValue), bounds),
    max: clampEpisode(Math.max(minValue, maxValue), bounds),
  };
}

function getSearchState({
  hydratedHitsInput,
  hydratedHitsQuery,
  isRangePending,
  searchQuery,
  submittedSearch,
}: Readonly<{
  hydratedHitsInput: HydratedHitsInput | null;
  hydratedHitsQuery: UseQueryResult<HydratedSearchHits>;
  isRangePending: boolean;
  searchQuery: UseQueryResult<SearchCorpusResult>;
  submittedSearch: SubmittedSearch | null;
}>): SearchLoadState {
  if (!submittedSearch) {
    return { status: "idle" };
  }

  if (searchQuery.isError && !searchQuery.data) {
    return {
      status: "error",
      message:
        searchQuery.error instanceof Error
          ? searchQuery.error.message
          : "Unknown search error",
    };
  }

  if (!searchQuery.data) {
    return { status: "loading" };
  }

  if (hydratedHitsQuery.isError && !hydratedHitsQuery.data) {
    return {
      status: "error",
      message:
        hydratedHitsQuery.error instanceof Error
          ? hydratedHitsQuery.error.message
          : "Unknown hydration error",
    };
  }

  return {
    status: "ready",
    result: searchQuery.data,
    filteredTotal:
      hydratedHitsQuery.data?.filteredTotal ??
      hydratedHitsInput?.filteredTotal ??
      0,
    hits: hydratedHitsQuery.data?.hits ?? [],
    isFiltering:
      isRangePending || searchQuery.isFetching || hydratedHitsQuery.isFetching,
  };
}

function getVisibleSearchHitInput(
  result: SearchCorpusResult,
  range: EpisodeRange,
): HydratedHitsInput {
  const filteredSegmentIds = result.allSegmentIds.filter((segmentId) => {
    const { episode } = parseSegmentId(segmentId);
    return episode >= range.min && episode <= range.max;
  });
  const visibleSegmentIds = filteredSegmentIds.slice(0, MAX_RENDERED_RESULTS);

  return {
    filteredTotal: filteredSegmentIds.length,
    visibleSegmentIds,
  };
}

function clampEpisode(value: number, bounds: EpisodeRange) {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function rangeSliderValueToEpisodeRange(value: RangeSliderValue): EpisodeRange {
  return {
    min: Math.min(value[0], value[1]),
    max: Math.max(value[0], value[1]),
  };
}
