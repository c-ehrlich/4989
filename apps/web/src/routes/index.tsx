import { createFileRoute } from "@tanstack/react-router";
import { Clock3, Play, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
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
