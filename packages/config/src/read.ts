/**
 * Reading configuration from the environment, and refusing to start without it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Until P18 this repository read no environment variables at all outside test
 * helpers. Every database URL, session secret, service certificate and origin
 * was a constructor argument supplied by a test — which is why five deployables
 * existed and none of them could be started by a person.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Two properties, and both are about the operator ───────────────────────
 *
 * **Every problem is reported at once.** A reader that threw on the first
 * missing variable would make configuring a service a sequence of deploys, each
 * revealing one more thing. `readConfig` collects them and raises a single
 * error listing all of them.
 *
 * **A value is never echoed.** The variables here include a session-signing
 * secret and two database URLs with credentials in them. An error message
 * saying *"AAS_SESSION_SECRET is too short: hunter2"* would put it in every log
 * that catches a startup failure. So a problem names the VARIABLE and the RULE,
 * never the value — the same discipline `@askimate/aas-secure-logging` applies
 * to request bodies.
 */

/** One thing wrong with the environment. Names the variable, never the value. */
export interface ConfigProblem {
  readonly variable: string;
  /** What was required, phrased so an operator can act on it. */
  readonly rule: string;
}

/**
 * Raised when the environment cannot produce a valid configuration.
 *
 * Carries every problem rather than the first, and its message is safe to log.
 */
export class ConfigError extends Error {
  public readonly problems: readonly ConfigProblem[];

  public constructor(problems: readonly ConfigProblem[]) {
    const lines = problems.map((p) => `  - ${p.variable}: ${p.rule}`).join("\n");
    super(
      `REFUSING TO START: ${String(problems.length)} configuration problem(s).\n${lines}\n\n` +
        "No value is shown above, deliberately: these variables carry secrets " +
        "and this message reaches the log.",
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/** The deployment's mode. `production` is the only one that tightens anything. */
export type Environment = string | undefined;

/**
 * Whether this process is running in production.
 *
 * One function so that "what counts as production" is decided once. It is
 * `NODE_ENV`, matching `assertVaultIsProductionGrade`, which has used that
 * signal since ADR-0034 and is the control this now finally calls.
 */
export function isProduction(environment: Environment): boolean {
  return environment === "production";
}

export interface Reader {
  /** Whether this is a production deployment. Drives every `productionOnly` rule. */
  readonly production: boolean;

  /** A non-empty string. */
  string(variable: string, options?: { readonly minLength?: number }): string;

  /**
   * A URL that parses, with an optional scheme requirement.
   *
   * `httpsInProduction` is the common case: an origin a browser will load, or a
   * service-to-service URL carrying a credential. Plain `http` is permitted
   * outside production because a developer has no certificate.
   */
  url(
    variable: string,
    options?: { readonly httpsInProduction?: boolean; readonly schemes?: readonly string[] },
  ): string;

  /** An integer, with optional bounds. */
  int(variable: string, options?: { readonly min?: number; readonly max?: number }): number;

  /** Present and `"1"` or `"true"`. Absent is `false`. */
  flag(variable: string): boolean;

  /** One of a closed set. */
  choice<T extends string>(variable: string, allowed: readonly T[]): T;

  /** The same as `string`, but absent yields the fallback instead of a problem. */
  optionalString(variable: string, fallback?: string): string | undefined;

  /** The same as `int`, but absent yields the fallback. */
  optionalInt(
    variable: string,
    fallback: number,
    options?: { readonly min?: number; readonly max?: number },
  ): number;

  /** The same as `url`, but absent yields `undefined`. */
  optionalUrl(
    variable: string,
    options?: { readonly httpsInProduction?: boolean; readonly schemes?: readonly string[] },
  ): string | undefined;

  /**
   * Records a problem that is not about one variable's SHAPE.
   *
   * For the rules that make a configuration unsafe rather than malformed — a
   * development control enabled in production, a required pairing where only
   * one half is present. They belong in the same report as the missing
   * variables, because to an operator they are the same kind of news.
   */
  refuse(variable: string, rule: string): void;
}

/**
 * Builds a configuration, or throws one error describing everything wrong.
 *
 * The environment is INJECTED rather than read from `process.env` here, for the
 * same reason every clock in this repository is injected: a function that
 * reaches for a global cannot be tested against the cases that matter, and the
 * cases that matter here are all about what happens when something is missing.
 */
export function readConfig<T>(
  env: Readonly<Record<string, string | undefined>>,
  build: (reader: Reader) => T,
): T {
  const problems: ConfigProblem[] = [];
  const production = isProduction(env["NODE_ENV"]);

  const raw = (variable: string): string | undefined => {
    const value = env[variable];
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  };

  const fail = (variable: string, rule: string): void => {
    problems.push({ variable, rule });
  };

  const readUrl = (
    variable: string,
    value: string,
    options?: { readonly httpsInProduction?: boolean; readonly schemes?: readonly string[] },
  ): string => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      fail(variable, "must be an absolute URL");
      return value;
    }
    if (options?.schemes !== undefined && !options.schemes.includes(parsed.protocol)) {
      fail(variable, `scheme must be one of ${options.schemes.join(", ")}`);
      return value;
    }
    if (options?.httpsInProduction === true && production && parsed.protocol !== "https:") {
      fail(variable, "must be https in production");
    }
    return value;
  };

  const reader: Reader = {
    production,

    string: (variable, options) => {
      const value = raw(variable);
      if (value === undefined) {
        fail(variable, "is required and must not be empty");
        return "";
      }
      const min = options?.minLength;
      if (min !== undefined && value.length < min) {
        fail(variable, `must be at least ${String(min)} characters`);
      }
      return value;
    },

    url: (variable, options) => {
      const value = raw(variable);
      if (value === undefined) {
        fail(variable, "is required and must be an absolute URL");
        return "";
      }
      return readUrl(variable, value, options);
    },

    int: (variable, options) => {
      const value = raw(variable);
      if (value === undefined) {
        fail(variable, "is required and must be an integer");
        return 0;
      }
      if (!/^-?\d+$/.test(value)) {
        fail(variable, "must be an integer");
        return 0;
      }
      const parsed = Number(value);
      if (options?.min !== undefined && parsed < options.min) {
        fail(variable, `must be at least ${String(options.min)}`);
      }
      if (options?.max !== undefined && parsed > options.max) {
        fail(variable, `must be at most ${String(options.max)}`);
      }
      return parsed;
    },

    flag: (variable) => {
      const value = raw(variable)?.toLowerCase();
      return value === "1" || value === "true";
    },

    choice: <T extends string>(variable: string, allowed: readonly T[]): T => {
      const value = raw(variable);
      if (value === undefined) {
        fail(variable, `is required and must be one of ${allowed.join(", ")}`);
        return allowed[0] as T;
      }
      if (!allowed.includes(value as T)) {
        // The VALUE is named here, and only here: a closed set has no secrets
        // in it, and "you wrote 'fixture', the choices are 'fixtures'" is the
        // single most useful thing this error can say.
        fail(variable, `must be one of ${allowed.join(", ")} (got "${value}")`);
        return allowed[0] as T;
      }
      return value as T;
    },

    optionalString: (variable, fallback) => raw(variable) ?? fallback,

    optionalInt: (variable, fallback, options) => {
      const value = raw(variable);
      if (value === undefined) return fallback;
      if (!/^-?\d+$/.test(value)) {
        fail(variable, "must be an integer");
        return fallback;
      }
      const parsed = Number(value);
      if (options?.min !== undefined && parsed < options.min) {
        fail(variable, `must be at least ${String(options.min)}`);
      }
      if (options?.max !== undefined && parsed > options.max) {
        fail(variable, `must be at most ${String(options.max)}`);
      }
      return parsed;
    },

    optionalUrl: (variable, options) => {
      const value = raw(variable);
      if (value === undefined) return undefined;
      return readUrl(variable, value, options);
    },

    refuse: fail,
  };

  const built = build(reader);
  if (problems.length > 0) throw new ConfigError(problems);
  return built;
}
