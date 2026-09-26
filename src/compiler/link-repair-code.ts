/**
 * Locate literal Markdown code without rendering or reserializing a page.
 * Block maps come from the existing Markdown parser so nested list/blockquote
 * fences and indented code follow its grammar. Inline backtick runs require an
 * equally sized closing run; protected offsets always refer to original bytes.
 */
import MarkdownIt from "markdown-it";

type Span = { start: number; end: number };
const markdown = new MarkdownIt();
// Parsing only (nothing is rendered): `html` makes raw HTML blocks such as
// <pre> and <script> visible as html_block tokens so their bytes stay literal.
const markdownWithHtml = new MarkdownIt({ html: true });

/** Which literal regions a caller must leave untouched. */
export interface LiteralMarkdownOptions {
  /**
   * Also treat raw HTML blocks as literal. Off by default so link repair keeps
   * matching the viewer and answer-publication rules, which read wikilinks in
   * HTML blocks as live links; the resolver turns it on because it must never
   * insert a new link into code.
   */
  htmlBlocks?: boolean;
}

/** Locate literal blocks by their original line ranges. */
function blockSpans(body: string, parser: MarkdownIt): Span[] {
  const offsets = [0];
  for (const match of body.matchAll(/\n/g)) offsets.push(match.index + 1);
  offsets.push(body.length);
  return parser.parse(body, {})
    .filter(token => ["fence", "code_block", "html_block"].includes(token.type) && token.map)
    .map(token => ({ start: offsets[token.map![0]], end: offsets[token.map![1]] }));
}

/** Locate matched code spans; an unmatched backtick remains ordinary prose. */
function inlineSpans(body: string): Span[] {
  const runs = [...body.matchAll(/`+/g)];
  const spans: Span[] = [];
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    const backslashes = body.slice(0, opener.index).match(/\\+$/)?.[0].length ?? 0;
    if (backslashes % 2 === 1) continue;
    const close = runs.findIndex((run, j) => j > i && run[0].length === opener[0].length);
    if (close < 0) continue;
    const closer = runs[close];
    spans.push({ start: opener.index, end: closer.index + closer[0].length });
    i = close;
  }
  return spans;
}

/** Return a predicate identifying matches inside literal Markdown regions. */
export function isLiteralMarkdown(body: string, options: LiteralMarkdownOptions = {}): (offset: number) => boolean {
  const spans = blockSpans(body, options.htmlBlocks ? markdownWithHtml : markdown);
  // Inline scanning must not pair a prose backtick with a fenced block's run.
  let start = 0;
  for (const block of [...spans, { start: body.length, end: body.length }]) {
    spans.push(...inlineSpans(body.slice(start, block.start))
      .map(span => ({ start: span.start + start, end: span.end + start })));
    start = block.end;
  }
  return offset => spans.some(span => offset >= span.start && offset < span.end);
}
