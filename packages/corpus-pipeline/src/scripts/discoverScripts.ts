import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { ScriptsSchema, type Script } from "@4989/corpus-types";

import { findRepoRoot } from "../cli/paths.js";
import { parseEpisodeNumberFromTitle } from "../youtube/parseEpisode.js";

export const DEFAULT_SCRIPT_SITEMAP_URL =
  "https://www.4989americanlife.com/blog-posts-sitemap.xml";

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_FETCH_ATTEMPTS = 3;
const INITIAL_FETCH_RETRY_DELAY_MS = 500;

type SitemapEntry = {
  url: string;
  lastmod?: string;
};

type CachedHtml = {
  path: string;
  lastmod?: string;
};

type ParsedScriptPage = {
  episode: number;
  titleEpisode?: number;
  urlEpisode?: number;
  title: string;
  url: string;
  publishedAt?: string;
  modifiedAt?: string;
  text: string;
};

export type ScriptReference = {
  url: string;
  title: string;
};

export type DuplicateScriptEpisodeReport = {
  episode: number;
  scripts: ScriptReference[];
};

export type UrlEpisodeScriptReference = ScriptReference & {
  canonicalEpisode: number;
};

export type DuplicateUrlEpisodeReport = {
  episode: number;
  scripts: UrlEpisodeScriptReference[];
};

export type UnparsedScriptPageReport = {
  url: string;
  reason: string;
};

export type FailedScriptPageReport = {
  url: string;
  reason: string;
};

export type ScriptEpisodeMismatchReport = {
  url: string;
  title: string;
  canonicalEpisode: number;
  titleEpisode?: number;
  urlEpisode?: number;
  reason: string;
};

export type ScriptDiscoveryReport = {
  generatedAt: string;
  sitemapUrl: string;
  totalSitemapUrls: number;
  discoveredScripts: number;
  duplicateEpisodes: DuplicateScriptEpisodeReport[];
  duplicateUrlEpisodes: DuplicateUrlEpisodeReport[];
  episodeMismatches: ScriptEpisodeMismatchReport[];
  unparsedPages: UnparsedScriptPageReport[];
  failedPages: FailedScriptPageReport[];
  episodeRange?: {
    min: number;
    max: number;
  };
  missingEpisodesInRange: number[];
  missingUrlEpisodesInRange: number[];
};

export type DiscoverScriptsOptions = {
  sitemapUrl?: string;
  dataDirectory: string;
  workDirectory: string;
  force?: boolean;
  limit?: number;
  concurrency?: number;
  sampleOutput?: boolean;
};

export type DiscoverScriptsResult = {
  scripts: Script[];
  report: ScriptDiscoveryReport;
  scriptsPath: string;
  reportPath: string;
};

export async function discoverScripts(
  options: DiscoverScriptsOptions
): Promise<DiscoverScriptsResult> {
  const sitemapUrl = options.sitemapUrl ?? DEFAULT_SCRIPT_SITEMAP_URL;
  const dataDirectory = resolve(options.dataDirectory);
  const workDirectory = resolve(options.workDirectory);
  const scriptsWorkDirectory = resolve(workDirectory, "scripts");
  const repoRoot = await findRepoRoot();

  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    mkdir(scriptsWorkDirectory, { recursive: true })
  ]);

  const sitemapXml = await fetchText(sitemapUrl);
  const sitemapEntries = parseScriptSitemap(sitemapXml).slice(0, options.limit);
  const cachedHtmlByUrl = await readCachedHtmlByUrl(dataDirectory, repoRoot);

  const pageResults = await mapWithConcurrency(
    sitemapEntries,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (entry): Promise<
      | { status: "parsed"; entry: SitemapEntry; html: string; parsedPage: ParsedScriptPage }
      | { status: "unparsed"; page: UnparsedScriptPageReport }
      | { status: "failed"; page: FailedScriptPageReport }
    > => {
      try {
        const rawHtmlPath = resolve(scriptsWorkDirectory, `${rawHtmlCacheName(entry.url)}.html`);
        const html = await readOrFetchPage(
          entry.url,
          freshCachedHtmlPath(cachedHtmlByUrl.get(entry.url), entry),
          Boolean(options.force)
        );
        await writeStableText(rawHtmlPath, html);

        const parsedPage = parseScriptPageHtml(html, entry.url);
        if (!parsedPage) {
          return {
            status: "unparsed",
            page: {
              url: entry.url,
              reason: "could-not-extract-episode-title-or-script-text"
            }
          };
        }

        return {
          status: "parsed",
          entry,
          html,
          parsedPage
        };
      } catch (error: unknown) {
        return {
          status: "failed",
          page: {
            url: entry.url,
            reason: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  );

  const parsedResults = pageResults.flatMap((result) =>
    result.status === "parsed" ? [result] : []
  );
  const finalCacheNamesByUrl = buildCacheNamesForParsedPages(
    parsedResults.map((result) => result.parsedPage)
  );

  const rawScripts = await Promise.all(
    parsedResults.map(async (result): Promise<Script> => {
      const cacheName = finalCacheNamesByUrl.get(result.parsedPage.url) ?? fallbackCacheName(result.parsedPage.url);
      const htmlPath = resolve(scriptsWorkDirectory, `${cacheName}.html`);
      const textPath = resolve(scriptsWorkDirectory, `${cacheName}.txt`);

      await Promise.all([
        writeStableText(htmlPath, result.html),
        writeStableText(textPath, `${result.parsedPage.text}\n`)
      ]);

      const script: Script = {
        episode: result.parsedPage.episode,
        title: result.parsedPage.title,
        url: result.parsedPage.url,
        text: result.parsedPage.text,
        htmlPath: toRepoRelativePath(repoRoot, htmlPath),
        textPath: toRepoRelativePath(repoRoot, textPath)
      };

      if (result.parsedPage.publishedAt) {
        script.publishedAt = result.parsedPage.publishedAt;
      }

      if (result.parsedPage.modifiedAt) {
        script.modifiedAt = result.parsedPage.modifiedAt;
      }

      if (result.entry.lastmod) {
        script.lastmod = result.entry.lastmod;
      }

      return script;
    })
  );

  const scripts = ScriptsSchema.parse(
    rawScripts.sort(compareScripts)
  );

  const report = buildScriptDiscoveryReport({
    generatedAt: new Date().toISOString(),
    sitemapUrl,
    sitemapEntries,
    scripts,
    parsedPages: parsedResults.map((result) => result.parsedPage),
    unparsedPages: pageResults.flatMap((result) =>
      result.status === "unparsed" ? [result.page] : []
    ),
    failedPages: pageResults.flatMap((result) =>
      result.status === "failed" ? [result.page] : []
    )
  });

  const scriptsPath = resolve(dataDirectory, options.sampleOutput ? "scripts.sample.json" : "scripts.json");
  const reportPath = resolve(
    dataDirectory,
    options.sampleOutput ? "script-discovery-report.sample.json" : "script-discovery-report.json"
  );

  await writeStableJson(scriptsPath, scripts);
  await writeStableReportJson(reportPath, report);

  return {
    scripts,
    report,
    scriptsPath,
    reportPath
  };
}

export function parseScriptSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlPattern = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const rawUrl = readXmlTag(block, "loc");
    if (!rawUrl) {
      continue;
    }

    const entry: SitemapEntry = {
      url: decodeXmlEntities(rawUrl.trim())
    };

    const lastmod = readXmlTag(block, "lastmod");
    if (lastmod && /^\d{4}-\d{2}-\d{2}$/.test(lastmod.trim())) {
      entry.lastmod = lastmod.trim();
    }

    entries.push(entry);
  }

  return entries.sort((left, right) => {
    const leftEpisode = parseScriptEpisodeNumber(left.url) ?? Number.MAX_SAFE_INTEGER;
    const rightEpisode = parseScriptEpisodeNumber(right.url) ?? Number.MAX_SAFE_INTEGER;
    return leftEpisode - rightEpisode || left.url.localeCompare(right.url);
  });
}

export function parseScriptPageHtml(
  html: string,
  url: string
): ParsedScriptPage | undefined {
  const metadata = extractBlogPostingMetadata(html);
  const title = normalizeWhitespace(metadata?.headline ?? extractHtmlTitle(html));
  const titleEpisode = parseScriptEpisodeNumber(title);
  const urlEpisode = parseScriptEpisodeNumber(url);
  const episode = titleEpisode ?? urlEpisode;
  const text = extractRenderedPostText(html);

  if (!title || episode === undefined || !text) {
    return undefined;
  }

  const page: ParsedScriptPage = {
    episode,
    title,
    url,
    text
  };

  if (titleEpisode !== undefined) {
    page.titleEpisode = titleEpisode;
  }

  if (urlEpisode !== undefined) {
    page.urlEpisode = urlEpisode;
  }

  if (metadata?.datePublished && isIsoDateTime(metadata.datePublished)) {
    page.publishedAt = metadata.datePublished;
  }

  if (metadata?.dateModified && isIsoDateTime(metadata.dateModified)) {
    page.modifiedAt = metadata.dateModified;
  }

  return page;
}

export function parseScriptEpisodeNumber(value: string): number | undefined {
  return parseEpisodeNumberFromTitle(value) ?? parsePodcastTypoEpisodeNumber(value);
}

export function extractRenderedPostText(html: string): string {
  const startHook = 'data-hook="post-description"';
  const startHookIndex = html.indexOf(startHook);
  if (startHookIndex < 0) {
    return "";
  }

  const start = html.indexOf(">", startHookIndex);
  if (start < 0) {
    return "";
  }

  const footerIndex = html.indexOf('data-hook="post-footer"', start);
  const end =
    footerIndex >= 0
      ? Math.max(html.lastIndexOf("<footer", footerIndex), start + 1)
      : html.indexOf('data-hook="recent-posts"', start);

  const contentHtml = html.slice(start + 1, end >= 0 ? end : undefined);
  return stripKnownBoilerplate(htmlToVisibleText(contentHtml));
}

export function buildScriptDiscoveryReport(input: {
  generatedAt: string;
  sitemapUrl: string;
  sitemapEntries: SitemapEntry[];
  scripts: Script[];
  parsedPages?: ParsedScriptPage[];
  unparsedPages: UnparsedScriptPageReport[];
  failedPages: FailedScriptPageReport[];
}): ScriptDiscoveryReport {
  const episodeNumbers = input.scripts.map((script) => script.episode).sort((a, b) => a - b);
  const parsedPages = input.parsedPages ?? input.scripts.map(toParsedScriptPage);
  const urlEpisodeNumbers = parsedPages
    .flatMap((page) => (page.urlEpisode === undefined ? [] : [page.urlEpisode]))
    .sort((a, b) => a - b);
  const episodeRange =
    episodeNumbers.length > 0
      ? {
          min: episodeNumbers[0] as number,
          max: episodeNumbers[episodeNumbers.length - 1] as number
        }
      : undefined;
  const urlEpisodeRange =
    urlEpisodeNumbers.length > 0
      ? {
          min: urlEpisodeNumbers[0] as number,
          max: urlEpisodeNumbers[urlEpisodeNumbers.length - 1] as number
        }
      : undefined;

  const report: ScriptDiscoveryReport = {
    generatedAt: input.generatedAt,
    sitemapUrl: input.sitemapUrl,
    totalSitemapUrls: input.sitemapEntries.length,
    discoveredScripts: input.scripts.length,
    duplicateEpisodes: collectDuplicateScriptEpisodes(input.scripts),
    duplicateUrlEpisodes: collectDuplicateUrlEpisodes(parsedPages),
    episodeMismatches: collectEpisodeMismatches(parsedPages),
    unparsedPages: [...input.unparsedPages].sort((left, right) => left.url.localeCompare(right.url)),
    failedPages: [...input.failedPages].sort((left, right) => left.url.localeCompare(right.url)),
    missingEpisodesInRange:
      episodeRange === undefined
        ? []
        : collectMissingEpisodesInRange(
            new Set(episodeNumbers),
            episodeRange.min,
            episodeRange.max
          ),
    missingUrlEpisodesInRange:
      urlEpisodeRange === undefined
        ? []
        : collectMissingEpisodesInRange(
            new Set(urlEpisodeNumbers),
            urlEpisodeRange.min,
            urlEpisodeRange.max
          )
  };

  if (episodeRange) {
    report.episodeRange = episodeRange;
  }

  return report;
}

function extractBlogPostingMetadata(html: string):
  | {
      headline?: string;
      datePublished?: string;
      dateModified?: string;
    }
  | undefined {
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const rawJson = decodeHtmlEntities(match[1] ?? "").trim();
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const blogPosting = entries.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { "@type"?: unknown })["@type"] === "BlogPosting"
      ) as
        | {
            headline?: unknown;
            datePublished?: unknown;
            dateModified?: unknown;
          }
        | undefined;

      if (blogPosting) {
        return {
          headline: typeof blogPosting.headline === "string" ? blogPosting.headline : undefined,
          datePublished:
            typeof blogPosting.datePublished === "string" ? blogPosting.datePublished : undefined,
          dateModified:
            typeof blogPosting.dateModified === "string" ? blogPosting.dateModified : undefined
        };
      }
    } catch {
      // Ignore malformed structured data and fall back to visible HTML.
    }
  }

  return undefined;
}

function extractHtmlTitle(html: string): string {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return titleMatch ? htmlToVisibleText(titleMatch[1] ?? "") : "";
}

function htmlToVisibleText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\b[^>]*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|section|article)>/gi, "\n")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
  )
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function stripKnownBoilerplate(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isKnownBoilerplateLine(line))
    .join("\n")
    .trim();
}

function isKnownBoilerplateLine(line: string): boolean {
  const normalizedLine = normalizeWhitespace(line)
    .replace(/^[◾■□▪️\s]+/u, "")
    .replace(/[！!]+$/u, "");

  return (
    normalizedLine === "サポートお願いします" ||
    normalizedLine === "Buy Me a Coffee" ||
    /^https:\/\/buymeacoffee\.com\/4989\/?$/i.test(normalizedLine) ||
    /^サポートお願いします[！!]?\s+Buy Me a Coffee\s+https:\/\/buymeacoffee\.com\/4989\/?$/i.test(
      normalizedLine
    ) ||
    /^Buy Me a Coffee\s*https:\/\/buymeacoffee\.com\/4989\/?$/i.test(normalizedLine)
  );
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/[ \t\r\f\v]+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return decodeXmlEntities(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10))
    )
    .replace(/&#x([a-f0-9]+);/gi, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16))
    );
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&apos;/gi, "'");
}

function readXmlTag(block: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(block);
  return match?.[1];
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function parsePodcastTypoEpisodeNumber(value: string): number | undefined {
  const match = /(?:^|[^\p{L}\p{N}])p[\s._-]*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/iu.exec(
    value
  );
  if (!match?.[1]) {
    return undefined;
  }

  const episode = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(episode) && episode > 0 ? episode : undefined;
}

function buildCacheNamesForParsedPages(pages: ParsedScriptPage[]): Map<string, string> {
  const countsByEpisode = new Map<number, number>();

  for (const page of pages) {
    countsByEpisode.set(page.episode, (countsByEpisode.get(page.episode) ?? 0) + 1);
  }

  const seenByEpisode = new Map<number, number>();
  const namesByUrl = new Map<string, string>();

  for (const page of [...pages].sort((left, right) => {
    return left.episode - right.episode || left.url.localeCompare(right.url);
  })) {
    const count = countsByEpisode.get(page.episode) ?? 0;
    const seen = (seenByEpisode.get(page.episode) ?? 0) + 1;
    seenByEpisode.set(page.episode, seen);

    namesByUrl.set(page.url, count > 1 ? `ep${page.episode}.${seen}` : `ep${page.episode}`);
  }

  return namesByUrl;
}

function fallbackCacheName(url: string): string {
  return `page-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function rawHtmlCacheName(url: string): string {
  return `raw-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

async function readCachedHtmlByUrl(
  dataDirectory: string,
  repoRoot: string
): Promise<Map<string, CachedHtml>> {
  const scriptsPath = resolve(dataDirectory, "scripts.json");
  const cachedHtmlByUrl = new Map<string, CachedHtml>();

  try {
    const scripts = JSON.parse(await readFile(scriptsPath, "utf8")) as unknown;
    if (!Array.isArray(scripts)) {
      return cachedHtmlByUrl;
    }

    for (const script of scripts) {
      if (!isRecord(script)) {
        continue;
      }

      const url = script.url;
      const htmlPath = script.htmlPath;
      if (typeof url === "string" && typeof htmlPath === "string") {
        const cachedHtml: CachedHtml = {
          path: resolve(repoRoot, htmlPath)
        };

        if (typeof script.lastmod === "string") {
          cachedHtml.lastmod = script.lastmod;
        }

        cachedHtmlByUrl.set(url, cachedHtml);
      }
    }
  } catch {
    // No previous script metadata exists on a clean run.
  }

  return cachedHtmlByUrl;
}

function freshCachedHtmlPath(cachedHtml: CachedHtml | undefined, entry: SitemapEntry): string | undefined {
  if (!cachedHtml) {
    return undefined;
  }

  if (entry.lastmod === undefined) {
    return cachedHtml.path;
  }

  return cachedHtml.lastmod === entry.lastmod ? cachedHtml.path : undefined;
}

async function readOrFetchPage(
  url: string,
  cachedHtmlPath: string | undefined,
  force: boolean
): Promise<string> {
  if (!force && cachedHtmlPath) {
    try {
      return await readFile(cachedHtmlPath, "utf8");
    } catch {
      // Missing cache is fetched below.
    }
  }

  return await fetchText(url);
}

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DEFAULT_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchTextOnce(url);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < DEFAULT_FETCH_ATTEMPTS) {
        await delay(INITIAL_FETCH_RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchTextOnce(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "@4989/corpus-pipeline script discovery"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as T);
    }
  });

  await Promise.all(workers);
  return results;
}

function compareScripts(left: Script, right: Script): number {
  return left.episode - right.episode || left.url.localeCompare(right.url);
}

function collectDuplicateScriptEpisodes(scripts: Script[]): DuplicateScriptEpisodeReport[] {
  const scriptsByEpisode = new Map<number, Script[]>();

  for (const script of scripts) {
    const episodeScripts = scriptsByEpisode.get(script.episode) ?? [];
    episodeScripts.push(script);
    scriptsByEpisode.set(script.episode, episodeScripts);
  }

  return [...scriptsByEpisode.entries()]
    .filter(([, episodeScripts]) => episodeScripts.length > 1)
    .sort(([leftEpisode], [rightEpisode]) => leftEpisode - rightEpisode)
    .map(([episode, episodeScripts]) => ({
      episode,
      scripts: episodeScripts.map((script) => ({
        url: script.url,
        title: script.title
      }))
    }));
}

function collectDuplicateUrlEpisodes(pages: ParsedScriptPage[]): DuplicateUrlEpisodeReport[] {
  const pagesByUrlEpisode = new Map<number, ParsedScriptPage[]>();

  for (const page of pages) {
    if (page.urlEpisode === undefined) {
      continue;
    }

    const episodePages = pagesByUrlEpisode.get(page.urlEpisode) ?? [];
    episodePages.push(page);
    pagesByUrlEpisode.set(page.urlEpisode, episodePages);
  }

  return [...pagesByUrlEpisode.entries()]
    .filter(([, episodePages]) => episodePages.length > 1)
    .sort(([leftEpisode], [rightEpisode]) => leftEpisode - rightEpisode)
    .map(([episode, episodePages]) => ({
      episode,
      scripts: episodePages
        .sort((left, right) => left.url.localeCompare(right.url))
        .map((page) => ({
          url: page.url,
          title: page.title,
          canonicalEpisode: page.episode
        }))
    }));
}

function collectEpisodeMismatches(pages: ParsedScriptPage[]): ScriptEpisodeMismatchReport[] {
  return pages
    .flatMap((page): ScriptEpisodeMismatchReport[] => {
      const titleEpisode = page.titleEpisode ?? parseScriptEpisodeNumber(page.title);
      const urlEpisode = page.urlEpisode ?? parseScriptEpisodeNumber(page.url);
      const mismatchedEpisodes = new Set(
        [titleEpisode, urlEpisode].filter(
          (episode): episode is number => episode !== undefined && episode !== page.episode
        )
      );

      if (mismatchedEpisodes.size === 0) {
        return [];
      }

      const report: ScriptEpisodeMismatchReport = {
        url: page.url,
        title: page.title,
        canonicalEpisode: page.episode,
        reason: "title-url-episode-mismatch"
      };

      if (titleEpisode !== undefined) {
        report.titleEpisode = titleEpisode;
      }

      if (urlEpisode !== undefined) {
        report.urlEpisode = urlEpisode;
      }

      return [report];
    })
    .sort((left, right) => left.canonicalEpisode - right.canonicalEpisode || left.url.localeCompare(right.url));
}

function toParsedScriptPage(script: Script): ParsedScriptPage {
  const titleEpisode = parseScriptEpisodeNumber(script.title);
  const urlEpisode = parseScriptEpisodeNumber(script.url);
  const page: ParsedScriptPage = {
    episode: script.episode,
    title: script.title,
    url: script.url,
    text: script.text
  };

  if (titleEpisode !== undefined) {
    page.titleEpisode = titleEpisode;
  }

  if (urlEpisode !== undefined) {
    page.urlEpisode = urlEpisode;
  }

  if (script.publishedAt) {
    page.publishedAt = script.publishedAt;
  }

  if (script.modifiedAt) {
    page.modifiedAt = script.modifiedAt;
  }

  return page;
}

function collectMissingEpisodesInRange(
  episodes: Set<number>,
  minEpisode: number,
  maxEpisode: number
): number[] {
  const missingEpisodes: number[] = [];

  for (let episode = minEpisode; episode <= maxEpisode; episode += 1) {
    if (!episodes.has(episode)) {
      missingEpisodes.push(episode);
    }
  }

  return missingEpisodes;
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await writeStableText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeStableReportJson(
  path: string,
  report: ScriptDiscoveryReport
): Promise<void> {
  try {
    const previousReport = JSON.parse(await readFile(path, "utf8")) as ScriptDiscoveryReport;
    if (
      JSON.stringify(stripGeneratedAt(previousReport)) === JSON.stringify(stripGeneratedAt(report))
    ) {
      return;
    }
  } catch {
    // Missing or malformed reports are overwritten below.
  }

  await writeStableJson(path, report);
}

async function writeStableText(path: string, value: string): Promise<void> {
  try {
    const previousValue = await readFile(path, "utf8");
    if (previousValue === value) {
      return;
    }
  } catch {
    // Missing files are written below.
  }

  await writeFile(path, value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripGeneratedAt(report: ScriptDiscoveryReport): Omit<ScriptDiscoveryReport, "generatedAt"> {
  const { generatedAt: _generatedAt, ...stableReport } = report;
  return stableReport;
}

function toRepoRelativePath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split(sep).join("/");
}
