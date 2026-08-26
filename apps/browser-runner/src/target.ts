/**
 * Discovery target definitions.
 *
 * A target is DATA — a JSON file under `targets/` — not code. Adding a
 * university means adding a file, which is what brief §3.2 requires of the
 * whole design.
 *
 * Parsing is deliberately strict and total: a malformed target fails loudly
 * before a browser opens, rather than half-running against a partly-understood
 * configuration.
 */

/** A target, as parsed and validated. */
export interface DiscoveryTarget {
  readonly targetId: string;
  readonly institutionName: string;
  readonly campus?: string;
  readonly courseName: string;
  readonly intake: string;
  readonly route: "direct_portal" | "partner_portal" | "assisted_manual";
  readonly platformHypothesis?: string;
  readonly routeNotes: readonly string[];
  /** Hosts the run may touch. Everything else is refused (ADR-0014). */
  readonly allowedHosts: readonly string[];
  /** Entry points. */
  readonly seedUrls: readonly string[];
  /** Regexes; a link must match one to be followed. */
  readonly linkPatterns: readonly string[];
  /** Hard cap on pages visited. */
  readonly maxPages: number;
  /** What this run is trying to confirm or refute. */
  readonly claimsToVerify: readonly string[];
}

export class InvalidTargetError extends Error {
  public override readonly name = "InvalidTargetError";
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidTargetError(`Target field "${key}" must be a non-empty string.`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new InvalidTargetError(`Target field "${key}" must be a string when present.`);
  }
  return value;
}

function requireStringArray(source: Record<string, unknown>, key: string, minLength: number): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new InvalidTargetError(`Target field "${key}" must be an array of strings.`);
  }
  if (value.length < minLength) {
    throw new InvalidTargetError(`Target field "${key}" must have at least ${String(minLength)} entr(y|ies).`);
  }
  return value as readonly string[];
}

/** Parses and validates a target. Throws rather than guessing at a bad one. */
export function parseTarget(raw: unknown): DiscoveryTarget {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidTargetError("A target must be a JSON object.");
  }
  const source = raw as Record<string, unknown>;

  const route = requireString(source, "route");
  if (route !== "direct_portal" && route !== "partner_portal" && route !== "assisted_manual") {
    throw new InvalidTargetError(`Unknown route "${route}".`);
  }

  const maxPages = source["maxPages"];
  if (typeof maxPages !== "number" || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) {
    throw new InvalidTargetError("Target field \"maxPages\" must be an integer between 1 and 200.");
  }

  const seedUrls = requireStringArray(source, "seedUrls", 1);
  const allowedHosts = requireStringArray(source, "allowedHosts", 1);

  // Every seed must be inside the allow-list. A seed the run is not permitted
  // to visit is a configuration mistake, and it should surface here rather than
  // as a confusing refusal mid-run.
  for (const url of seedUrls) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new InvalidTargetError(`Seed URL is not a valid URL: ${url}`);
    }
    const permitted = allowedHosts.some(
      (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
    );
    if (!permitted) {
      throw new InvalidTargetError(
        `Seed URL ${url} is not covered by allowedHosts (${allowedHosts.join(", ")}).`,
      );
    }
  }

  // Compile the patterns now, so a bad regex fails before a browser opens.
  const linkPatterns = requireStringArray(source, "linkPatterns", 0);
  for (const pattern of linkPatterns) {
    try {
      new RegExp(pattern, "i");
    } catch {
      throw new InvalidTargetError(`linkPatterns contains an invalid regular expression: ${pattern}`);
    }
  }

  const campus = optionalString(source, "campus");
  const platformHypothesis = optionalString(source, "platformHypothesis");

  return {
    targetId: requireString(source, "targetId"),
    institutionName: requireString(source, "institutionName"),
    courseName: requireString(source, "courseName"),
    intake: requireString(source, "intake"),
    route,
    routeNotes: requireStringArray(source, "routeNotes", 0),
    allowedHosts,
    seedUrls,
    linkPatterns,
    maxPages,
    claimsToVerify: requireStringArray(source, "claimsToVerify", 0),
    ...(campus !== undefined ? { campus } : {}),
    ...(platformHypothesis !== undefined ? { platformHypothesis } : {}),
  };
}

/** Whether a link is worth following for this target. */
export function shouldFollow(target: DiscoveryTarget, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  const host = parsed.hostname.toLowerCase();
  const inScope = target.allowedHosts.some(
    (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
  );
  if (!inScope) return false;

  // No patterns configured means seeds only — the conservative default.
  if (target.linkPatterns.length === 0) return false;

  const haystack = `${parsed.pathname}${parsed.search}`;
  return target.linkPatterns.some((pattern) => new RegExp(pattern, "i").test(haystack));
}
