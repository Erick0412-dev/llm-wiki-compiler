/** Copyable terminal instructions. Clipboard only; never executes commands. */
import { el } from "./viewer-dom.js";

/** POSIX shell quoting prevents paths/IDs from becoming shell syntax or options. */
export function reviewCommand(root, id) {
  if (typeof root !== "string" || !root || /[\x00-\x1f\x7f]/.test(root)
    || (id !== undefined && (typeof id !== "string" || !id || /[\x00-\x1f\x7f]/.test(id)))) return null;
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const action = id === undefined ? "llmwiki compile --review" : `llmwiki review show -- ${quote(id)}`;
  return `cd -- ${quote(root)} &&\n${action}`;
}

/** Show the selected identity, explicit working directory, and honest copy result. */
export function commandCard(root, id) {
  const card = el("div", "sc-command");
  card.append(el("p", "sc-caption", `Project directory: ${root ?? "unavailable"}`));
  if (id !== undefined) card.append(el("p", "sc-caption", `Proposal ID: ${id}`));
  const command = reviewCommand(root, id);
  if (!command) {
    card.append(el("p", undefined, "A safe copyable command is unavailable. Reload the viewer or inspect this project manually."));
    return card;
  }
  const button = el("button", undefined, "Copy terminal command");
  const status = el("span", "sc-caption");
  status.setAttribute("role", "status");
  button.addEventListener("click", async () => {
    status.textContent = " Copying…";
    let timeout;
    try {
      await Promise.race([navigator.clipboard.writeText(command), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Clipboard confirmation timed out")), 2000);
      })]);
      status.textContent = " Copied — paste into your terminal. Nothing has run yet.";
    }
    catch { status.textContent = " Clipboard unavailable. Select and copy the command above manually."; }
    finally { clearTimeout(timeout); }
  });
  card.append(el("pre", undefined, command), el("p", "sc-caption", "For macOS / Linux shells. Requires llmwiki on your PATH."), button, status);
  return card;
}
