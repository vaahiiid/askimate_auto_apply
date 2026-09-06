/**
 * Telling a person that a run stopped (ADR-0071).
 *
 * The whole package is one shape and one port. Everything interesting about it
 * is what the shape does NOT have a field for.
 */

export {
  MAX_NOTICE_AGE_MS,
  NoticeDeliveryError,
  noticeFor,
  type SpecialistNotice,
  type SpecialistNotifier,
} from "./notice.js";
export { WebhookNotifier, InsecureNotifierUrlError } from "./webhook.js";
