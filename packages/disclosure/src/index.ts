/**
 * @askimate/aas-disclosure — may this document be sent, to whom, and why?
 *
 * A document being in the vault is not a reason to send it anywhere. The
 * upload path takes a `DisclosureAuthorisation`, which cannot be constructed
 * without the document, the destination, the purpose and the authority.
 */

export type {
  Article6Basis,
  Article9Condition,
  DeterminationCheck,
  DeterminationRefusal,
  LawfulBasisDetermination,
  LawfulBasisDeterminationRecord,
  ProcessingActivity,
} from "./lawful-basis.js";
export {
  LawfulBasisRegister,
  NoLawfulBasisError,
  determinationOf,
  determineLawfulBasis,
  requireLawfulBasis,
} from "./lawful-basis.js";

export type {
  DisclosureAuthorisation,
  DisclosureCheck,
  DisclosureDestination,
  DisclosureRefusal,
  DisclosureRequestRecord,
  DisclosureSubject,
  MinorConditionCheck,
  StudentDisclosureAuthorisation,
  TransmissionRecord,
  TransmissionRefusal,
  WithdrawalRecord,
} from "./disclosure.js";
export type { DecidedRefusal, DecidedRefusalRegister } from "./b2-determinations.js";
export {
  B2_DETERMINATIONS,
  B2_DETERMINED_AT,
  B2_REVIEW_BY,
  DECIDED_NOT_TO_DETERMINE,
  DISCLOSE_DOCUMENT,
  DeterminationDecidedAgainstError,
  MINOR_ROUTE,
  STORE_ACADEMIC_DOCUMENT,
  STORE_IDENTITY_DOCUMENT,
  assertNotDecidedAgainst,
  b2Register,
} from "./b2-determinations.js";
export {
  DISCLOSURE_ACTIVITY,
  authoriseDisclosure,
  disclosureOf,
  mayTransmit,
  recordTransmission,
  renderDisclosureRequest,
} from "./disclosure.js";
