/**
 * How the reader talks to the Application Plane: a claim and a report.
 *
 * The runner's intake shape (`apps/browser-runner/src/work-intake.ts`),
 * with one message fewer: the retrieval comes WITH the claim, because the
 * gate a reading needs — the document is a CV, held under the CV-reading
 * purpose, not purged — is a fact about the document, not about a run, and
 * the plane can settle it before it answers. The reader holds the URL for a
 * minute and fetches it once.
 */

import type { ClaimedReading, ReadingReport } from "@askimate/aas-contracts";
import { SERVICE_CERTIFICATE_HEADER, parseClaimedReading } from "@askimate/aas-contracts";

export interface ReadingIntakeOptions {
  /** The Application Plane's internal base URL, on the private subnet. */
  readonly baseUrl: string;
  /** Which reader this is. For an operator reading the table; never a credential. */
  readonly holder: string;
  /** mTLS in production; a header here, exactly as the runner's client. */
  readonly serviceToken?: string;
  readonly leaseSeconds?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface ReadingIntake {
  /** One document to read, or `null` — the ordinary answer of a poll. */
  claim(): Promise<ClaimedReading | null>;
  /** `true` when the plane accepted the report; `false` when this lease is no longer held. */
  report(documentId: string, report: ReadingReport): Promise<boolean>;
}

export const DEFAULT_LEASE_SECONDS = 300;

export function httpReadingIntake(options: ReadingIntakeOptions): ReadingIntake {
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers = {
    "content-type": "application/json",
    ...(options.serviceToken === undefined ? {} : { [SERVICE_CERTIFICATE_HEADER]: options.serviceToken }),
  };
  return {
    claim: async (): Promise<ClaimedReading | null> => {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}/internal/v1/readings/claims`, {
          method: "POST",
          headers,
          body: JSON.stringify({ holder: options.holder, leaseSeconds: options.leaseSeconds ?? DEFAULT_LEASE_SECONDS }),
        });
      } catch {
        // An unreachable plane is an ordinary thing for a poll to find: no
        // work this time round, and the loop waits rather than dies.
        return null;
      }
      if (response.status !== 200) return null;
      const body: unknown = await response.json();
      // Field by field through the contract's parser, never a cast.
      return parseClaimedReading(body);
    },
    report: async (documentId: string, report: ReadingReport): Promise<boolean> => {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}/internal/v1/readings/${encodeURIComponent(documentId)}/report`, {
          method: "POST",
          headers,
          body: JSON.stringify(report),
        });
      } catch {
        return false;
      }
      return response.status === 204;
    },
  };
}
