import { createFileRoute } from "@tanstack/react-router";
import { Clock3, Play, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  loadCorpusStaticStatus,
  type CorpusStaticStatus
} from "@/corpus/smoke";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  const [corpusStatus, setCorpusStatus] = useState<CorpusLoadState>({ status: "loading" });

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
          <Tabs defaultValue="lemma">
            <TabsList aria-label="Search mode">
              <TabsTrigger value="lemma">Lemma</TabsTrigger>
              <TabsTrigger value="surface">Surface</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Panel>
          <PanelHeader>
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="食べる" aria-label="Search query" />
              </div>
              <Button>
                <Search />
                Search
              </Button>
            </div>
          </PanelHeader>
          <PanelBody>
            <CorpusStatusPanel state={corpusStatus} />
            <Tabs defaultValue="results">
              <TabsList aria-label="Preview sections">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="player">Player</TabsTrigger>
              </TabsList>
              <TabsContent value="results">
                <div className="grid gap-3">
                  <ResultPreview
                    episode="ep178"
                    timestamp="10:20"
                    text="やっぱりそういう季節の定番があるっていいですよね。"
                  />
                  <ResultPreview
                    episode="ep300"
                    timestamp="7:56"
                    text="そのままアメリカの boarding school、寮のある学校に入学をして..."
                  />
                </div>
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

function ResultPreview({
  episode,
  timestamp,
  text
}: Readonly<{
  episode: string;
  timestamp: string;
  text: string;
}>) {
  return (
    <article className="grid gap-3 rounded-md border border-border bg-background p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-muted-foreground">
          <span>{episode}</span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {timestamp}
          </span>
        </div>
        <p className="m-0 text-sm leading-7">{text}</p>
      </div>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          type="button"
        >
          <Play className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Preview seek control</TooltipContent>
      </Tooltip>
    </article>
  );
}
