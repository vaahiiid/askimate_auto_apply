/**
 * @askimate/aas-migrate — forward-only, checksum-verified schema migrations.
 *
 * ADR-0003. Extracted from `packages/case-store` when the conversation and
 * secure services each acquired a schema of their own: three copies of a
 * hundred-line runner would have been three places for the checksum rule to
 * drift, and a service depending on the case store merely to migrate its own
 * database would have been a dependency describing nothing real.
 */

export type { Migration } from "./runner.js";
export { MigrationChangedError, loadMigrations, migrate } from "./runner.js";
