/**
 * Where this package's migrations live.
 *
 * The runner itself moved to `@askimate/aas-migrate` when the conversation and
 * secure services acquired schemas of their own. What stays here is the one
 * thing that is genuinely this package's: the location of its own SQL.
 */

import { join } from "node:path";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
