/**
 * Web URL ingestion module.
 * Fetches a URL, extracts readable content using Mozilla Readability,
 * and converts the result to clean markdown via Turndown.
 *
 * Throws descriptive errors on network failures or when the page
 * cannot be parsed into readable content.
 */

// jsdom, Readability and Turndown are loaded only when a URL is ingested:
// this module is reachable from every CLI command, and jsdom alone adds about
// 100 ms to start-up for commands that never touch the web.

interface WebIngestResult {
  title: string;
  content: string;
}

/** Fetch a URL and return its readable content as markdown. */
async function fetchAndParse(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response;
}

/** Extract readable content from raw HTML using Readability. */
async function extractReadableContent(html: string, url: string): Promise<{ title: string; htmlContent: string }> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error(`Could not extract readable content from ${url}`);
  }

  return {
    title: article.title || "Untitled",
    htmlContent: article.content,
  };
}

/** Convert HTML to clean markdown using Turndown. */
async function convertToMarkdown(html: string): Promise<string> {
  const { default: TurndownService } = await import("turndown");
  const turndown = new TurndownService({ headingStyle: "atx" });
  return turndown.turndown(html);
}

/**
 * Ingest a web URL and return its content as markdown.
 * @param url - The URL to fetch and convert.
 * @returns An object with the extracted title and markdown content.
 * @throws On network failure or unparseable content.
 */
export default async function ingestWeb(url: string): Promise<WebIngestResult> {
  const response = await fetchAndParse(url);
  const html = await response.text();
  const { title, htmlContent } = await extractReadableContent(html, url);
  const content = await convertToMarkdown(htmlContent);

  return { title, content };
}
