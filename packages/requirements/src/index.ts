/**
 * @askimate/aas-requirements — the Requirements Service.
 *
 * Two evidence channels feeding the gate that already existed: AskiMate's own
 * kb_pending_entries → human review → kb_entries workflow, and the
 * university's own page, read and hashed. It adds no way round the gate.
 */

export type {
  ApprovalRefusal,
  ApprovalResult,
  ApprovedKbEntry,
  KbEntryRecord,
  KnowledgeBase,
  PendingStatus,
} from "./knowledge-base.js";
export {
  InMemoryKnowledgeBase,
  approve,
  curatedEvidenceFrom,
  entryOf,
  reject,
} from "./knowledge-base.js";

export type {
  Extractor,
  OfficialReadResult,
  OfficialSourceReader,
  ReadRefusal,
  SourcePage,
} from "./official-source.js";
export { RecordedSourceReader, excerptChanged, hashExcerpt, readOfficialSource } from "./official-source.js";

export type { RequirementOutcome, RequirementQuery } from "./service.js";
export { establishRequirement, outstandingWork } from "./service.js";
