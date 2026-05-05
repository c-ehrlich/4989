import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildScriptDiscoveryReport,
  discoverScripts,
  extractRenderedPostText,
  parseScriptPageHtml,
  parseScriptSitemap
} from "./discoverScripts.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("parseScriptSitemap", () => {
  it("extracts sitemap URLs and sorts them by episode number", () => {
    const entries = parseScriptSitemap(`<?xml version="1.0" encoding="UTF-8"?>
      <urlset>
        <url>
          <loc>https://www.4989americanlife.com/post/ep-12--middle</loc>
          <lastmod>2024-01-12</lastmod>
        </url>
        <url>
          <loc>https://www.4989americanlife.com/post/p-108--typo</loc>
          <lastmod>2024-05-12</lastmod>
        </url>
        <url>
          <loc>https://www.4989americanlife.com/post/ep-2--old&amp;copy</loc>
          <lastmod>2024-01-02</lastmod>
        </url>
      </urlset>`);

    expect(entries).toEqual([
      {
        url: "https://www.4989americanlife.com/post/ep-2--old&copy",
        lastmod: "2024-01-02"
      },
      {
        url: "https://www.4989americanlife.com/post/ep-12--middle",
        lastmod: "2024-01-12"
      },
      {
        url: "https://www.4989americanlife.com/post/p-108--typo",
        lastmod: "2024-05-12"
      }
    ]);
  });
});

describe("parseScriptPageHtml", () => {
  it("extracts metadata and visible post body without footer content", () => {
    const html = `<!doctype html>
      <html>
        <head>
          <title>fallback title</title>
          <script type="application/ld+json">{
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": "ep.343/ アルバイトはじめました！",
            "datePublished": "2025-10-02T13:00:25.266Z",
            "dateModified": "2025-10-03T01:02:03.000Z"
          }</script>
        </head>
        <body>
          <div data-hook="post-description">
            <p><span>本文 &amp; 一行目。</span></p>
            <div><span>本文二行目。<br/>続き。</span></div>
            <script>ignored()</script>
          </div>
          <footer data-hook="post-footer">Share this post</footer>
        </body>
      </html>`;

    expect(parseScriptPageHtml(html, "https://www.4989americanlife.com/post/ep-343--sample")).toEqual(
      {
        episode: 343,
        titleEpisode: 343,
        urlEpisode: 343,
        title: "ep.343/ アルバイトはじめました！",
        url: "https://www.4989americanlife.com/post/ep-343--sample",
        publishedAt: "2025-10-02T13:00:25.266Z",
        modifiedAt: "2025-10-03T01:02:03.000Z",
        text: "本文 & 一行目。\n本文二行目。\n続き。"
      }
    );
  });

  it("returns undefined when the page body cannot be found", () => {
    expect(
      parseScriptPageHtml(
        "<title>ep.1/ missing body</title>",
        "https://www.4989americanlife.com/post/ep-1"
      )
    ).toBeUndefined();
  });

  it("handles the known p.108 title typo as an episode number", () => {
    const html = `<!doctype html>
      <title>p.108/ 止まない雨はない</title>
      <div data-hook="post-description"><p>本文です。</p></div>
      <footer data-hook="post-footer"></footer>`;

    expect(
      parseScriptPageHtml(
        html,
        "https://www.4989americanlife.com/post/p-108--止まない雨はない"
      )?.episode
    ).toBe(108);
  });
});

describe("extractRenderedPostText", () => {
  it("keeps paragraph boundaries while stripping rendered Wix markup", () => {
    const text = extractRenderedPostText(`
      <main>
        <div data-hook="post-description">
          <div data-breakout="normal"><p><span>こんにちは。</span></p></div>
          <div type="paragraph" data-hook="rcv-block1"></div>
          <div data-breakout="normal"><p><span>次の段落です。</span></p></div>
        </div>
        <footer data-hook="post-footer">Share</footer>
      </main>`);

    expect(text).toBe("こんにちは。\n次の段落です。");
  });

  it("strips repeated support CTA boilerplate from script text", () => {
    const text = extractRenderedPostText(`
      <main>
        <div data-hook="post-description">
          <p>本文です。</p>
          <p>◾️サポートお願いします！</p>
          <p>Buy Me a Coffee</p>
          <p>https://buymeacoffee.com/4989</p>
          <p>◾️サポートお願いします！ Buy Me a Coffee https://buymeacoffee.com/4989</p>
          <p>Buy Me a Coffeehttps://buymeacoffee.com/4989</p>
        </div>
        <footer data-hook="post-footer">Share</footer>
      </main>`);

    expect(text).toBe("本文です。");
  });
});

describe("buildScriptDiscoveryReport", () => {
  it("reports duplicates, failed pages, unparsed pages, range, and gaps", () => {
    const report = buildScriptDiscoveryReport({
      generatedAt: "2026-05-05T00:00:00.000Z",
      sitemapUrl: "https://example.com/sitemap.xml",
      sitemapEntries: [
        { url: "https://example.com/post/ep-1" },
        { url: "https://example.com/post/ep-3" },
        { url: "https://example.com/post/ep-3--duplicate" },
        { url: "https://example.com/post/ep-5--stale-url" }
      ],
      scripts: [
        {
          episode: 1,
          title: "ep.1/ one",
          url: "https://example.com/post/ep-1",
          text: "one",
          htmlPath: ".work/4989/scripts/ep1.html",
          textPath: ".work/4989/scripts/ep1.txt"
        },
        {
          episode: 3,
          title: "ep.3/ three",
          url: "https://example.com/post/ep-3",
          text: "three",
          htmlPath: ".work/4989/scripts/ep3.1.html",
          textPath: ".work/4989/scripts/ep3.1.txt"
        },
        {
          episode: 4,
          title: "ep.4/ canonical title",
          url: "https://example.com/post/ep-5--stale-url",
          text: "mismatch",
          htmlPath: ".work/4989/scripts/ep4.html",
          textPath: ".work/4989/scripts/ep4.txt"
        },
        {
          episode: 3,
          title: "ep.3/ duplicate",
          url: "https://example.com/post/ep-3--duplicate",
          text: "duplicate",
          htmlPath: ".work/4989/scripts/ep3.2.html",
          textPath: ".work/4989/scripts/ep3.2.txt"
        }
      ],
      unparsedPages: [{ url: "https://example.com/post/no-episode", reason: "missing episode" }],
      failedPages: [{ url: "https://example.com/post/error", reason: "HTTP 500" }]
    });

    expect(report.discoveredScripts).toBe(4);
    expect(report.episodeRange).toEqual({ min: 1, max: 4 });
    expect(report.missingEpisodesInRange).toEqual([2]);
    expect(report.missingUrlEpisodesInRange).toEqual([2, 4]);
    expect(report.duplicateEpisodes).toEqual([
      {
        episode: 3,
        scripts: [
          { url: "https://example.com/post/ep-3", title: "ep.3/ three" },
          { url: "https://example.com/post/ep-3--duplicate", title: "ep.3/ duplicate" }
        ]
      }
    ]);
    expect(report.duplicateUrlEpisodes).toEqual([
      {
        episode: 3,
        scripts: [
          {
            url: "https://example.com/post/ep-3",
            title: "ep.3/ three",
            canonicalEpisode: 3
          },
          {
            url: "https://example.com/post/ep-3--duplicate",
            title: "ep.3/ duplicate",
            canonicalEpisode: 3
          }
        ]
      }
    ]);
    expect(report.episodeMismatches).toEqual([
      {
        url: "https://example.com/post/ep-5--stale-url",
        title: "ep.4/ canonical title",
        canonicalEpisode: 4,
        titleEpisode: 4,
        urlEpisode: 5,
        reason: "title-url-episode-mismatch"
      }
    ]);
    expect(report.unparsedPages).toHaveLength(1);
    expect(report.failedPages).toHaveLength(1);
  });
});

describe("discoverScripts", () => {
  it("reuses cached canonical HTML only when sitemap lastmod is unchanged", async () => {
    const { dataDirectory, workDirectory } = await makeTempDiscoveryDirectories();
    let lastmod = "2026-01-01";
    let pageText = "first body";
    let pageFetches = 0;
    const sitemapUrl = "https://example.com/blog-posts-sitemap.xml";
    const pageUrl = "https://example.com/post/ep-1--cached";

    mockFetch(async (url) => {
      if (url === sitemapUrl) {
        return sitemapXml([{ url: pageUrl, lastmod }]);
      }

      if (url === pageUrl) {
        pageFetches += 1;
        return scriptHtml({ episode: 1, title: "cached", text: pageText });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await discoverScripts({ sitemapUrl, dataDirectory, workDirectory, concurrency: 1 });
    pageText = "second body";
    await discoverScripts({ sitemapUrl, dataDirectory, workDirectory, concurrency: 1 });

    expect(pageFetches).toBe(1);
    expect(JSON.parse(await readFile(join(dataDirectory, "scripts.json"), "utf8"))[0].text).toBe(
      "first body"
    );

    lastmod = "2026-01-02";
    await discoverScripts({ sitemapUrl, dataDirectory, workDirectory, concurrency: 1 });

    expect(pageFetches).toBe(2);
    expect(JSON.parse(await readFile(join(dataDirectory, "scripts.json"), "utf8"))[0].text).toBe(
      "second body"
    );
  });

  it("keeps raw URL-hash HTML for unparsed pages", async () => {
    const { dataDirectory, workDirectory } = await makeTempDiscoveryDirectories();
    const sitemapUrl = "https://example.com/blog-posts-sitemap.xml";
    const pageUrl = "https://example.com/post/no-script";

    mockFetch(async (url) => {
      if (url === sitemapUrl) {
        return sitemapXml([{ url: pageUrl, lastmod: "2026-01-01" }]);
      }

      if (url === pageUrl) {
        return "<!doctype html><title>No script here</title><main>missing post hook</main>";
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverScripts({ sitemapUrl, dataDirectory, workDirectory, concurrency: 1 });
    const cachedFiles = await readdir(join(workDirectory, "scripts"));

    expect(result.scripts).toEqual([]);
    expect(result.report.unparsedPages).toEqual([
      {
        url: pageUrl,
        reason: "could-not-extract-episode-title-or-script-text"
      }
    ]);
    expect(cachedFiles.filter((file) => /^raw-[a-f0-9]{16}\.html$/.test(file))).toHaveLength(1);
  });

  it("writes sample output files when requested", async () => {
    const { dataDirectory, workDirectory } = await makeTempDiscoveryDirectories();
    const sitemapUrl = "https://example.com/blog-posts-sitemap.xml";

    mockFetch(async (url) => {
      if (url === sitemapUrl) {
        return sitemapXml([
          { url: "https://example.com/post/ep-1", lastmod: "2026-01-01" },
          { url: "https://example.com/post/ep-2", lastmod: "2026-01-02" }
        ]);
      }

      if (url.endsWith("/ep-1")) {
        return scriptHtml({ episode: 1, title: "one", text: "one body" });
      }

      if (url.endsWith("/ep-2")) {
        return scriptHtml({ episode: 2, title: "two", text: "two body" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await discoverScripts({
      sitemapUrl,
      dataDirectory,
      workDirectory,
      limit: 1,
      concurrency: 1,
      sampleOutput: true
    });
    const dataFiles = await readdir(dataDirectory);

    expect(result.scripts).toHaveLength(1);
    expect(dataFiles).toContain("scripts.sample.json");
    expect(dataFiles).toContain("script-discovery-report.sample.json");
    expect(dataFiles).not.toContain("scripts.json");
    expect(dataFiles).not.toContain("script-discovery-report.json");
  });
});

async function makeTempDiscoveryDirectories(): Promise<{
  dataDirectory: string;
  workDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "4989-script-discovery-test-"));
  tempDirectories.push(root);
  return {
    dataDirectory: join(root, "data"),
    workDirectory: join(root, "work")
  };
}

function mockFetch(handler: (url: string) => Promise<string> | string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const body = await handler(String(url));
      return new Response(body);
    })
  );
}

function sitemapXml(entries: { url: string; lastmod: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset>
      ${entries
        .map(
          (entry) => `<url>
            <loc>${entry.url}</loc>
            <lastmod>${entry.lastmod}</lastmod>
          </url>`
        )
        .join("\n")}
    </urlset>`;
}

function scriptHtml(input: { episode: number; title: string; text: string }): string {
  return `<!doctype html>
    <title>ep.${input.episode}/ ${input.title}</title>
    <main>
      <div data-hook="post-description"><p>${input.text}</p></div>
      <footer data-hook="post-footer">Share</footer>
    </main>`;
}
