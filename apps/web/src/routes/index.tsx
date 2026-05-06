import { createFileRoute } from "@tanstack/react-router";
import { Clock3, ExternalLink, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  const [corpusStatus, setCorpusStatus] = useState<CorpusLoadState>({ status: "loading" });
  const [query, setQuery] = useState("食べる");
  const [searchMode, setSearchMode] = useState<SearchMode>("loose");
  const [searchState, setSearchState] = useState<SearchLoadState>({ status: "idle" });

  useEffect(() => {
    let isCurrent = true;

    void loadCorpusStaticStatus()
      .then((result) => {
        if (isCurrent) {
          setCorpusStatus({ status: "ready", result });
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

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchState({ status: "loading" });

    try {
      const result = await searchCorpus({
        query,
        mode: searchMode,
        limit: 25
      });
      const hits =
        result.segmentIds.length > 0
          ? await hydrateSegmentIds({ segmentIds: result.segmentIds })
          : [];
      setSearchState({ status: "ready", result, hits });
    } catch (error: unknown) {
      setSearchState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown search error"
      });
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
            onValueChange={(value) => setSearchMode(value as SearchMode)}
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
            <CorpusStatusPanel state={corpusStatus} />
            <Tabs defaultValue="results">
              <TabsList aria-label="Preview sections">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="player">Player</TabsTrigger>
              </TabsList>
              <TabsContent value="results">
                <SearchResults state={searchState} />
              </TabsContent>
              <TabsContent value="player">
                <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border bg-muted/50 text-sm text-muted-foreground">
                  YouTube player slot
                </div>
              </TabsContent>
            </Tabs>
          </PanelBody>
        </Panel>
      </section>
    </main>
  );
}

type SearchLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SearchCorpusResult; hits: HydratedSegment[] }
  | { status: "error"; message: string };

type CorpusLoadState =
  | { status: "loading" }
  | { status: "ready"; result: CorpusStaticStatus }
  | { status: "error"; message: string };

function CorpusStatusPanel({ state }: Readonly<{ state: CorpusLoadState }>) {
  if (state.status === "loading") {
    return (
      <div className="mb-5 rounded-md border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
        Loading corpus assets...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mb-5 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
        Corpus assets failed to load: {state.message}
      </div>
    );
  }

  return (
    <div className="mb-5 grid gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm md:grid-cols-[1.25fr_1fr_1fr]">
      <StatusMetric label="Episodes" value={state.result.episodeCount.toLocaleString()} />
      <StatusMetric
        label={`ep${state.result.sampleEpisodeNumber} segments`}
        value={state.result.sampleSegmentCount.toLocaleString()}
      />
      <StatusMetric
        label={`Lemma bucket ${state.result.sampleLemmaBucketName}`}
        value={`${state.result.sampleLemmaHitCount.toLocaleString()} hits`}
      />
      <div className="md:col-span-2">
        <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">
          {state.result.sampleEpisodeTitle}
        </p>
        <p className="m-0 mt-1 line-clamp-2 leading-6">
          {state.result.sampleFirstSegmentKey}: {state.result.sampleFirstSegmentText}
        </p>
      </div>
      <StatusMetric
        label={`Surface ${state.result.sampleSurface}`}
        value={`${state.result.sampleSurfaceLemmaCount.toLocaleString()} lemmas`}
      />
    </div>
  );
}

function StatusMetric({
  label,
  value
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div>
      <p className="m-0 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="m-0 mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SearchResults({ state }: Readonly<{ state: SearchLoadState }>) {
  if (state.status === "idle") {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
        Run a search to see matching segment IDs.
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
        No segment IDs found for {state.result.query}.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm">
        <span className="font-semibold">{state.result.total.toLocaleString()} matches</span>
        <span className="text-muted-foreground">
          {state.result.mode} search for {state.result.query}
        </span>
        {state.result.matchedTerms.length > 0 ? (
          <span className="text-muted-foreground">
            terms: {state.result.matchedTerms.join(", ")}
          </span>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.hits.map((hit) => (
          <ResultRow hit={hit} key={hit.segmentId} />
        ))}
      </div>
    </div>
  );
}

function ResultRow({ hit }: Readonly<{ hit: HydratedSegment }>) {
  return (
    <article className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm shadow-sm sm:col-span-2 lg:col-span-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-muted-foreground">
        <span>ep{hit.episode}</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" />
          {hit.timestamp}-{hit.endTimestamp}
        </span>
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
      </div>
    </article>
  );
}
