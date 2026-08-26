/**
 * Runs the shared CaseStore contract against the in-memory implementation.
 *
 * The Postgres implementation in Phase 2 will run this identical suite, which
 * is how we know the durability guarantees actually transferred rather than
 * being quietly weakened in the port.
 */

import { runCaseStoreContract } from "./contract.js";
import { InMemoryCaseStore } from "./in-memory.js";

runCaseStoreContract("InMemoryCaseStore", () => new InMemoryCaseStore());
