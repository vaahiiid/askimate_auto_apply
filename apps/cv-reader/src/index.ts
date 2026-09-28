/**
 * @askimate/aas-cv-reader — the process whose only job is reading a CV.
 *
 * ADR-0148 §9, in Vahid's words: *"A separate process whose only job is
 * reading a CV. It fetches the document, produces text, and forgets it."*
 * The second process ADR-0092 names beside the runner: it holds a URL for a
 * minute, never a key; no database, no vault, no browser.
 */

export type { ReaderConfig } from "./config.js";
export { readerConfigFrom } from "./config.js";
export type { ReadingIntake, ReadingIntakeOptions } from "./intake.js";
export { httpReadingIntake } from "./intake.js";
export type { ReadDocumentOptions } from "./read.js";
export { readDocument, readingOf } from "./read.js";
export type { ReaderSupervisorOptions, RunningReaderSupervisor, TurnResult } from "./supervisor.js";
export { runOneTurn, startReaderSupervisor } from "./supervisor.js";
export type { RunningReader, StartOptions } from "./main.js";
export { start } from "./main.js";
