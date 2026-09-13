/**
 * How one deployable tells another who it is (ADR-0037, ADR-0045).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * One header, named once. Until P121 the tree had two spellings for the same
 * idea: the Conversation Service, the Secure Service and the Runner read and
 * wrote `x-service-cert`, while the Fill Agent wrote `x-aas-service` towards
 * the Secure Service and read it from the Runner. Every in-process test that
 * put the agent and the Secure Service together added `x-service-cert` to the
 * agent's requests by hand, so the mismatch was invisible until the five
 * processes were started by the local-stack script and the Secure Service
 * answered the agent's every use with 403 — `not_authorised`, and no account.
 *
 * The value is a deployment's mesh certificate name, presented by the caller.
 * Which certificate each endpoint accepts is the receiving process's
 * configuration (`AAS_SERVICE_CERT_*`); the header is the same everywhere so
 * that a sender and a receiver built from this tree cannot disagree on where
 * to look.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const SERVICE_CERTIFICATE_HEADER = "x-service-cert";
