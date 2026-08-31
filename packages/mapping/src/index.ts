/**
 * @askimate/aas-mapping — canonical profile field → this portal's field.
 *
 * Reviewed data, pinned to a blueprint version. Produces a fill plan entirely
 * before a browser is opened, so what the system is about to type can be
 * previewed and authorised rather than discovered as it happens.
 */

export type {
  FieldLocator,
  FieldMapping,
  MappingCheck,
  MappingRefusal,
  MappingSet,
  MappingSetStatus,
  ReviewedConstant,
  UsableMappingSet,
  ValueSource,
} from "./mapping.js";
export {
  checkUsable,
  constantAttribution,
  constantText,
  constantsIn,
  isMappingRefused,
  isRequired,
  mappingFor,
  reviewedConstant,
  unmappedRequiredFields,
} from "./mapping.js";

export type {
  FillBlocker,
  FillInstruction,
  FillPlan,
  FillValue,
  HandoffRequirement,
  UploadInstruction,
} from "./plan.js";
export { fieldsToCollect, isComplete, planFill, textOf } from "./plan.js";

// ── ADR-0043: a credential field is mapped to the Secure Plane, not to data ─
export type {
  CredentialPurpose,
  NO_CREDENTIAL_SOURCE_FIELD_CAN_HOLD_A_VALUE,
} from "./mapping.js";
export { CREDENTIAL_PURPOSES } from "./mapping.js";
export type { CredentialRequirement } from "./plan.js";
