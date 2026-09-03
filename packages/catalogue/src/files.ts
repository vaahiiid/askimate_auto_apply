/**
 * A catalogue on disk: reviewed entries in one directory, approvals beside them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *   <dir>/approvals.json        the registry — hashes, and who signed each
 *   <dir>/entries/*.json        the reviewed entries
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two files rather than one, because they are two different kinds of thing with
 * two different authors. An entry is produced by discovery and specialist
 * authoring; an approval is produced by a second person looking at it. Putting
 * the approval inside the entry would put the signature inside the document it
 * signs, which is the arrangement ADR-0057 exists to replace.
 *
 * A directory is the simplest store that can hold both, and it is deliberately
 * unremarkable: a database table would be a better operational answer and a
 * worse first one, because it would make the integrity model depend on a schema
 * migration before anybody had exercised it. `ApprovalRegistry` is a port, so
 * moving this to Postgres — or onto AskiMate's KB workflow — is an adapter.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { isLabelledHash } from "./canonical.js";
import type { Approval, ApprovalRegistry } from "./registry.js";
import { InMemoryApprovalRegistry } from "./registry.js";
import {
  loadReviewedEntry,
  ReviewedCatalogue,
  type DeployedCatalogueEntry,
  type LoadRefusal,
} from "./loader.js";

export const APPROVALS_FILE = "approvals.json";
export const ENTRIES_DIR = "entries";

/** Why a catalogue directory could not be turned into a catalogue. */
export interface CatalogueProblem {
  /** The file it came from, relative to the directory. */
  readonly source: string;
  readonly detail: string;
}

export type CatalogueLoad =
  | { readonly ok: true; readonly catalogue: ReviewedCatalogue }
  | { readonly ok: false; readonly problems: readonly CatalogueProblem[] };

function describe(refusal: LoadRefusal): string {
  switch (refusal.kind) {
    case "malformed":
      return `${refusal.path}: ${refusal.detail}`;
    case "not_approved":
    case "blueprint_not_executable":
    case "mapping_not_usable":
      return refusal.detail;
  }
}

/**
 * Reads `approvals.json` into a registry.
 *
 * Every field is checked, for the same reason the entries are: the approvals
 * file is bytes too, and a registry that accepted a malformed record would
 * hold an approval whose hash matched nothing or whose reviewer was blank.
 */
export function parseApprovals(value: unknown, source: string): {
  readonly approvals: readonly Approval[];
  readonly problems: readonly CatalogueProblem[];
} {
  if (!Array.isArray(value)) {
    return { approvals: [], problems: [{ source, detail: "expected an array of approvals" }] };
  }

  const approvals: Approval[] = [];
  const problems: CatalogueProblem[] = [];

  value.forEach((raw, index) => {
    const at = `${source}[${String(index)}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      problems.push({ source: at, detail: "expected an object" });
      return;
    }
    const item = raw as Record<string, unknown>;
    const contentHash = item["contentHash"];
    const authoredBy = item["authoredBy"];
    const approvedBy = item["approvedBy"];
    const approvedAt = item["approvedAt"];
    const note = item["note"];

    if (!isLabelledHash(contentHash)) {
      problems.push({ source: at, detail: "contentHash must be sha256:<64 hex>" });
      return;
    }
    if (typeof authoredBy !== "string" || authoredBy.trim().length === 0) {
      problems.push({ source: at, detail: "authoredBy must name somebody" });
      return;
    }
    if (typeof approvedBy !== "string" || approvedBy.trim().length === 0) {
      problems.push({ source: at, detail: "approvedBy must name somebody" });
      return;
    }
    if (authoredBy.trim() === approvedBy.trim()) {
      problems.push({
        source: at,
        detail:
          `authored and approved by the same person ("${authoredBy}"). That is a draft with a ` +
          `signature on it (ADR-0017).`,
      });
      return;
    }
    if (typeof approvedAt !== "string" || Number.isNaN(new Date(approvedAt).getTime())) {
      problems.push({ source: at, detail: "approvedAt must be an ISO-8601 instant" });
      return;
    }
    if (note !== undefined && typeof note !== "string") {
      problems.push({ source: at, detail: "note must be a string when present" });
      return;
    }

    approvals.push({
      contentHash,
      authoredBy: authoredBy.trim(),
      approvedBy: approvedBy.trim(),
      approvedAt: new Date(approvedAt),
      ...(note === undefined ? {} : { note }),
    });
  });

  return { approvals, problems };
}

/** Reads the approvals file, or says why it could not. */
export async function readRegistry(directory: string): Promise<{
  readonly registry: ApprovalRegistry;
  readonly problems: readonly CatalogueProblem[];
}> {
  let text: string;
  try {
    text = await readFile(join(directory, APPROVALS_FILE), "utf8");
  } catch {
    return {
      registry: new InMemoryApprovalRegistry(),
      problems: [
        {
          source: APPROVALS_FILE,
          detail:
            `could not be read. Without it nothing is approved, and a catalogue with no ` +
            `approvals serves nothing.`,
        },
      ],
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return {
      registry: new InMemoryApprovalRegistry(),
      problems: [{ source: APPROVALS_FILE, detail: "is not valid JSON" }],
    };
  }

  const { approvals, problems } = parseApprovals(decoded, APPROVALS_FILE);
  return { registry: new InMemoryApprovalRegistry(approvals), problems };
}

/**
 * Builds a catalogue from a directory.
 *
 * EVERY problem is collected rather than the first one thrown, because this
 * runs at startup and an operator fixing a catalogue one refusal per restart is
 * an operator who will eventually reach for a way to turn the check off
 * (ADR-0055).
 */
export async function loadCatalogueDirectory(input: {
  readonly directory: string;
  /** Per-blueprint deployment origins, e.g. a university's UAT host. */
  readonly portalOrigins?: Readonly<Record<string, string>>;
}): Promise<CatalogueLoad> {
  const problems: CatalogueProblem[] = [];
  const { registry, problems: registryProblems } = await readRegistry(input.directory);
  problems.push(...registryProblems);

  const entriesDir = join(input.directory, ENTRIES_DIR);
  let names: readonly string[];
  try {
    names = (await readdir(entriesDir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return {
      ok: false,
      problems: [
        ...problems,
        { source: ENTRIES_DIR, detail: "could not be read. A catalogue needs an entries directory." },
      ],
    };
  }

  if (names.length === 0) {
    return {
      ok: false,
      problems: [...problems, { source: ENTRIES_DIR, detail: "holds no entries." }],
    };
  }

  const loaded: { entry: Awaited<ReturnType<typeof loadReviewedEntry>>; source: string }[] = [];
  for (const name of names) {
    const source = join(ENTRIES_DIR, name);
    let text: string;
    try {
      text = await readFile(join(entriesDir, name), "utf8");
    } catch {
      problems.push({ source, detail: "could not be read" });
      continue;
    }
    // Parsed first WITHOUT an origin, so the origin lookup can key off the
    // blueprint id the document actually carries rather than off its filename.
    const first = await loadReviewedEntry({ text, registry });
    if (!first.ok) {
      problems.push({ source, detail: describe(first.refusal) });
      continue;
    }
    const origin = input.portalOrigins?.[String(first.entry.blueprint.blueprintId)];
    loaded.push({
      entry:
        origin === undefined
          ? first
          : await loadReviewedEntry({ text, registry, portalOrigin: origin }),
      source,
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  const built: { entry: DeployedCatalogueEntry; contentHash: string }[] = [];
  for (const item of loaded) {
    if (!item.entry.ok) {
      problems.push({ source: item.source, detail: describe(item.entry.refusal) });
      continue;
    }
    built.push({ entry: item.entry.entry, contentHash: item.entry.contentHash });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, catalogue: new ReviewedCatalogue(built) };
}
