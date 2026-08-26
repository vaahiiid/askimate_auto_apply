/**
 * @askimate/aas-account — whose account is it, and how does it get handed back?
 *
 * The application belongs to the student. The account's email is theirs and
 * confirmed by them; any credential we hold is short-lived and cannot be
 * written down; and a case cannot finish while an account is outstanding.
 */

export type { CredentialUnavailable } from "./credential.js";
export { EphemeralCredential } from "./credential.js";

export type {
  AccountCreationAuthorisation,
  AccountCreationCheck,
  AccountCreationRefusal,
  AccountStage,
  CompletedHandover,
  HandoverCheck,
  HandoverChecklist,
  HandoverRecord,
  HandoverRefusal,
  PortalAccount,
} from "./ownership.js";
export {
  checkHandoverComplete,
  mayConcludeCase,
  prepareAccountCreation,
  renderAccountCreationRequest,
  renderHandover,
} from "./ownership.js";
