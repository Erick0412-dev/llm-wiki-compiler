/**
 * Opt-in source maintenance inside the existing read-only viewer. Everything
 * from disk is textContent; no browser mutation or approval path is introduced.
 */
import { el, heading, technicalDetails } from "./viewer-dom.js";
import { reviewMessage } from "./viewer-review-warning.js";
import { commandCard } from "./viewer-source-command.js";

/** A detached route cannot repaint another page after a slow source scan finishes. */
export async function loadSourceChanges(main) {
  const frame = el("section", "list-pane");
  main.replaceChildren(frame);
  main.className = "main-pane list-pane";
  frame.append(el("p", undefined, "Reading current sources and proposals…"));
  try {
    const report = await fetchObservation();
    if (isCurrent(frame)) renderSourceChanges(frame, report);
  } catch {
    if (isCurrent(frame)) frame.replaceChildren(el("p", undefined,
      "Source comparison is unavailable or not enabled. No previous comparison is retained. Reload to retry."));
  }
}

/** Navigation may change before the destination route replaces its old DOM. */
function isCurrent(frame) { return frame.isConnected && location.hash === "#/source-changes"; }

/** Bound this slower live read without changing the existing viewer fetch defaults. */
async function fetchObservation() {
  const response = await fetch("/api/source-changes", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("unavailable");
  return response.json();
}

/** Render one fresh bounded observation, including its limits and next CLI action. */
function renderSourceChanges(main, report) {
  main.replaceChildren();
  main.className = "source-cockpit";
  const style = el("link");
  style.rel = "stylesheet";
  style.href = "/assets/viewer-source-cockpit.css";
  const header = el("header", "sc-header");
  header.append(el("span", "sc-eyebrow", "KNOWLEDGE MAINTENANCE · READ-ONLY PREVIEW"),
    heading("h1", "Source review cockpit"), el("p", undefined,
      "Choose a page. Compare its evidence. Decide what needs attention before CLI review."));
  const refresh = el("button", undefined, "Check files again");
  refresh.addEventListener("click", () => location.reload());
  header.append(refresh);
  const action = el("div", "sc-action-slot");
  action.setAttribute("aria-live", "polite");
  main.append(style, header, action, el("p", "sc-notice",
    "Inspection only — proposals are not approved. Content origin is not authenticated by this view; local data may include authored examples."));
  main.append(metrics(report));
  if (report.stateStatus !== "ok") main.append(el("p", "placeholder", "Compilation state is unavailable. No freshness conclusion can be drawn."));
  main.append(workspace(report, action));
  if (!report.pages.length) main.append(el("p", undefined, "No supported affected pages or proposals found in this bounded observation."));
  main.append(technicalDetails(`Observed ${report.observedAt}. State: ${report.stateStatus}. Showing ${report.pages.length} of ${report.totalPages} pages; ${report.candidateShown} supported proposals from ${report.candidateTotal} pending records.`));
}

/** Counts describe this bounded observation, never global completion. */
function metrics(report) {
  const row = el("div", "sc-metrics");
  const values = [[`${report.pages.length} of ${report.totalPages}`, "Pages shown"], [`${report.candidateShown} of ${report.candidateTotal}`, "Proposals / pending records"],
    [report.pages.filter(page => !page.candidates.length).length, "Without a proposal"], ["CLI only", "Approval & apply"]];
  for (const [value, label] of values) {
    const card = el("div", "sc-metric");
    card.append(el("strong", undefined, String(value)), el("span", undefined, label));
    row.append(card);
  }
  return row;
}

/** One selection at a time keeps the queue and comparison in a stable workspace. */
function workspace(report, action) {
  const layout = el("div", "sc-workspace");
  const queue = el("nav", "sc-queue");
  queue.setAttribute("aria-label", "Pages needing review");
  queue.append(heading("h2", "Review queue"));
  const detail = el("section", "sc-detail");
  const buttons = [];
  for (const page of report.pages) {
    const button = el("button", "sc-queue-item");
    button.append(el("strong", undefined, page.title), el("span", undefined, page.impact),
      el("small", undefined, `${page.candidates.length} proposal(s) · ${page.owners.length} source(s)`));
    button.addEventListener("click", () => {
      for (const item of buttons) item.setAttribute("aria-pressed", String(item === button));
      const choose = candidate => action.replaceChildren(nextAction(page, report.projectRoot, candidate));
      choose(page.candidates[0]);
      detail.replaceChildren(pageComparison(page, choose));
    });
    buttons.push(button);
    queue.append(button);
  }
  layout.append(queue, detail);
  buttons[0]?.click();
  return layout;
}

/** Commands are instructions, not disguised browser mutation controls. */
function nextAction(page, root, candidate) {
  const card = el("aside", "sc-next");
  card.append(heading("h2", page.candidates.length ? "Next: review the proposed changes" : "Next: generate a proposed update"),
    el("p", "sc-caption", `Selected page: ${page.title}`));
  if (page.candidates.length) {
    card.append(el("p", undefined, "Compare the panels below, then copy and run this command in your terminal to inspect the selected proposal. This does not approve or apply it."));
  } else {
    card.append(el("p", undefined, "No update targets this page. Generate proposals in your project terminal, then check files again. Generation uses your configured provider and can update compiler bookkeeping; it does not approve changes."));
  }
  card.append(commandCard(root, candidate?.id));
  return card;
}

/** Keep provenance and sources ahead of generated text in the reading order. */
function pageComparison(page, choose) {
  const section = el("section", "sc-comparison");
  section.append(heading("h2", page.title), el("p", undefined, page.impact));
  if (page.reconciliationPending) section.append(el("p", undefined, "Compiler reconciliation marker present; this is not a human edit lock."));
  const panels = el("div", "sc-panels");
  const sources = el("section", "sc-panel sc-evidence");
  sources.append(heading("h3", "01 · Source evidence"), el("p", "sc-caption", "Current excerpts · not a historical diff"));
  for (const excerpt of page.excerpts) sources.append(sourceExcerpt(excerpt, ownerStatus(excerpt, page.owners)));
  if (page.excerpts.length < page.owners.length) sources.append(el("p", undefined, "Only the first 20 contributor previews are shown."));
  const current = el("section", "sc-panel");
  appendCurrentPage(current, page);
  const proposed = el("section", "sc-panel sc-proposed");
  proposed.append(heading("h3", "03 · Proposed update"));
  appendProposals(proposed, page.candidates, { text: page.current, panel: current, choose });
  panels.append(sources, current, proposed);
  section.append(panels);
  return section;
}

/** Truncated or unavailable current text must not look like the complete wiki. */
function appendCurrentPage(section, page) {
  section.append(heading("h3", "02 · Current wiki"), el("p", "sc-caption", "Saved page · unchanged by this screen"), documentText(page.current ?? page.readStatus));
  if (page.truncated) section.append(el("p", undefined, "Wiki text shortened; inspect the full file before review."));
}

/** An absent proposal is not an empty generated page. */
function appendProposals(section, candidates, current) {
  if (candidates.length) {
    const select = el("select", "sc-proposal-select");
    select.setAttribute("aria-label", "Proposal to inspect");
    for (const candidate of candidates) {
      const option = el("option", undefined, candidate.id);
      option.value = candidate.id;
      select.append(option);
    }
    const body = el("div");
    const show = () => {
      const candidate = candidates[select.selectedIndex];
      current.choose(candidate);
      const changed = metadataBlock(current.text) !== metadataBlock(candidate.body);
      const currentMetadata = current.panel.querySelector("details");
      if (currentMetadata) currentMetadata.open = changed;
      body.replaceChildren(proposal(candidate, changed));
    };
    select.addEventListener("change", show);
    show();
    section.append(select, body);
  }
  if (!candidates.length) section.append(el("p", undefined, "No proposed update. Generation is a separate, explicit compiler action."));
}

/** Ownership is metadata, never inferred from excerpt text. */
function ownerStatus(excerpt, owners) {
  return owners.find(owner => owner.file === excerpt.file)?.status ?? "unverified";
}

/** Show the changed sources first-class while leaving stable text collapsible. */
function sourceExcerpt(excerpt, status) {
  const details = el("details");
  details.open = status === "changed";
  details.append(el("summary", undefined, `${excerpt.file} · ${status}`),
    el("pre", "source-preview", excerpt.text ?? `Preview unavailable: ${excerpt.status}`));
  if (excerpt.truncated) details.append(el("p", undefined, "Excerpt shortened. Inspect the full source before deciding."));
  return details;
}

/** Shared warning policy prevents UI-specific interpretations of missing evidence. */
function proposal(candidate, metadataChanged) {
  const details = el("details");
  details.open = true;
  details.append(el("summary", undefined, `Proposed wiki text · ${candidate.id} · not applied`),
    el("p", undefined, reviewMessage(candidate)),
    technicalDetails(`Target: ${candidate.checks.target}; sources: ${candidate.checks.sources}`),
    documentText(candidate.body, metadataChanged));
  if (metadataChanged) details.prepend(el("p", "sc-notice", "This proposal changes page metadata. Review the expanded metadata in both panels."));
  if (candidate.truncated) details.append(el("p", undefined, "Proposal shortened. Inspect its full body before review."));
  return details;
}

/** Move only the initial metadata block out of the reading pane; retain exact text. */
function documentText(text, expandMetadata = false) {
  const view = el("div");
  const metadata = metadataBlock(text);
  if (metadata) {
    const details = el("details");
    details.open = expandMetadata;
    details.append(el("summary", undefined, "Page metadata"), el("pre", "source-preview", metadata));
    view.append(details);
  }
  view.append(el("pre", "source-preview", metadata ? text.slice(metadata.length) : text));
  return view;
}

/** Exact initial metadata bytes, including delimiters; absence is significant. */
function metadataBlock(text) {
  return text?.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
}
