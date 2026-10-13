/**
 * @askimate/aas-account — whose account is it, and how does it get handed back?
 *
 * The application belongs to the student. The account's email is theirs and
 * confirmed by them; any credential we hold is short-lived and cannot be
 * written down; and a case cannot finish while an account is outstanding.
 */

export type { CredentialUnavailable, PasswordPolicy } from "./credential.js";
export { EphemeralCredential } from "./credential.js";

export type {
  AuthenticationApproach,
  AuthenticationChoice,
  AuthenticationPlan,
  AuthenticationRefusal,
  CredentialMint,
  CredentialRefusal,
  ObservedPortalAuthentication,
  PasswordDelivery,
  PasswordResetSends,
  PortalAuthFact,
  PortalAuthFactKey,
  PortalAuthFactSource,
  PortalAuthFactSources,
} from "./authentication.js";
export {
  AUTHENTICATION_APPROACHES,
  PASSWORD_RESET_SENDS,
  authenticationQuestions,
  chooseApproach,
  describePlan,
  describeSecureChannel,
  describeSignInResume,
  describeSignInStart,
  holdsASecret,
  mintCredentialUnder,
} from "./authentication.js";

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
  outstandingHandoverItems,
  outstandingHandoverKeys,
  owesRegistrationEmail,
  studentHandoverItems,
  prepareAccountCreation,
  renderAccountCreationRequest,
  renderHandover,
  renderRegistrationEmailNotReceived,
  renderRegistrationEmailQuestion,
  resetWordsFor,
} from "./ownership.js";
