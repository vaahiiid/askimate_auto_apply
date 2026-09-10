# ADR-0095 — The student's page makes the PUT, and the CORS rule is exercised by the PUT it makes

**Status:** **Accepted** — 2026-09-10
**Continues:** [ADR-0094](./0094-document-metadata-is-durable-and-the-transport-starts.md), which
named the client surface as the first thing it left unbuilt, and
[ADR-0092](./0092-the-document-never-enters-a-process-we-run.md), whose diagram had a `browser ──PUT──▶ S3`
line that nothing in the repository drew until now.

## Context

Since ADR-0090 the document transport has been three routes and a bucket, exercised by tests that
played the browser's part with `fetch` and an in-memory `put`. The student's page had no upload
control. ADR-0090 said what landing one would look like: *"moving `content_hash_mismatch` and
`intake_not_open` into `REFUSALS` is the visible act that says the upload surface has landed."*
ADR-0094 said what it would prove: *"That is the phase in which the CORS rule is exercised."*

Four questions had to be answered to build it, and each is a boundary rather than a widget:

1. **Who computes the hash?** The page's header has said since ADR-0060 that it *"does not compute
   a content hash — the server sends them"*. Under ADR-0092 the server never sees the bytes, so for
   an upload nobody else can.
2. **Who states the purpose?** The declaration route required a `purpose`, which keys a lawful-basis
   determination (ADR-0087). A page that offered *financial evidence* as a menu item would be
   handing a controller's decision to the person choosing a file.
3. **What does the page show afterwards?** ADR-0060's rule is that nothing the page shows is
   remembered by the page. There was no read from which a held document could be drawn.
4. **How is the CORS rule proven?** `docs/provisioning-request-document-vault.md` tells Vahid what
   to put on the bucket. A rule written in a document and a PUT written in a page can drift apart
   silently, and the first place they would meet was his bucket.

## Decision

### The upload's hash is the one hash the page computes, and it is stated as the exception

`journey.ts` now says so beside the rule it excepts. What the page computes is trusted by nothing:
the bucket refuses a body that does not hash to the signed checksum header (ADR-0093, E2), and the
confirm reads the bucket's own checksum back (ADR-0092). A wrong hash is a refused upload, never a
recorded one. The rule the page keeps — never hash what it *displays* — is untouched: the
authorisation and handoff hashes are still the server's.

### The purpose is derived by the server, and the page never sends one

`purpose` is optional in `DocumentUploadDeclaration`. When omitted, the route takes the one policy
row the governing schedule holds for the type; a type with none or several answers `400` on
`/purpose` and the caller must state one. A stated purpose is judged by the gates exactly as before,
so an API caller loses nothing. The page sends `documentType`, `contentType`, `contentHash` and
`sizeBytes`, and has no vocabulary of purposes to send.

### A held document is drawn from a read, not from the confirm's answer

`GET /v1/conversations/{conversationId}/documents` answers what this **student** holds — per
student, because documents are held for reuse across applications (B5, ADR-0078) — and the document
types the governing schedule has a row for. The page reads it on every draw, beside the events and
the run, and hides the panel when the read fails (a deployment without a vault is a configuration,
not a notice). After a confirm the page re-reads; it does not append what it just sent. A reload
shows the same list with nothing in browser storage, and the browser test asserts both.

`documentTypes` is what the student can be *given*, not a promise the gates pass it: `other` is
listed and refused at declaration, because its determination was decided against (ADR-0088). The
page offers the list and has no opinion about it.

### The CORS rule is read from the provisioning request and enforced by the test's own bucket

`student-client.test.ts` stands an HTTPS listener on a second loopback origin in front of the same
`InMemoryObjectStore` the route tests use. Its preflight handler admits **exactly** the JSON rule
parsed out of `docs/provisioning-request-document-vault.md` — the origin, the one method, the four
headers — and answers a request outside it the way S3 does, with no CORS headers, so the browser
refuses the PUT. The page's PUT is then a real cross-origin request from a real Chromium, with a
real preflight, against the rule as written. A header the page starts sending that the document does
not list fails here, not on Vahid's bucket.

HTTPS, with a certificate minted for the run, because `assertBoundUploadUrl` refuses any other scheme
and a test that loosened that for its own convenience would be proving a URL nothing may mint.
`InMemoryObjectStore` gained an `origin` parameter for this and nothing else.

### The three codes move

`content_hash_mismatch`, `intake_not_open` and `upload_not_received` leave `CANNOT_REACH_THIS_PAGE`
and enter `REFUSALS`, each worded as something the student can do: choose the file and send it
again. The entry that replaces them in the first list records that they were there and why they
left. `refusal-wording.test.ts` holds the two lists to the closed set as before.

### The form is built once

Every other panel on the page is replaced whole on every read, which is right for text the server
owns. A file input holds the student's file, and an SSE frame from their own message would have
emptied one rebuilt with the rest. So the document form is created once and kept; the held list and
the type choice are redrawn from the read. A test sends a message with a file chosen and finds it
still chosen.

## What was found, and left for Vahid

**The gate's words do not reach the page, and the contract says they must not.** The storage gates
write a `detail` for a person (ADR-0075) and the declaration route puts it on the wire. The contract
package's `Problem` has no `detail` member by decision — Vahid, 2026-08-28: *"Define all error
responses as closed, explicit contracts"*, and `problems.ts`: *"there is nowhere on the wire for a
sentence to be assembled"* — and `parseProblem` drops it. So the route sends a sentence the contract
says cannot exist, the route tests read it off the raw body, and the page words the refusal per code
(*"That is not something you can do here."*) with no way to say which gate. This ADR does not resolve
that: the two rules are both his, they were written five weeks apart, and the honest options — a
structured `gate` member on a new problem shape, or removing `detail` from the route — are a decision
for him. It is recorded in the state document as a blocker, in his words on both sides.

## What was built

- `journey.ts` — the document panel, `sendDocument` (hash, declare, PUT, confirm, re-read), the
  three wordings, the stated exception in the header
- `transport.ts` — `readDocuments`, `declareDocument`, `putDocument` (the one cross-origin call),
  `confirmDocument`; the header amended for it
- `build-client.ts` — the `#documents` section
- `routes.ts` — `purposeFor`, the listing route, `renderDocument` shared with the confirm
- `conversation.v1.yaml` — `GET …/documents`, `HeldDocuments`, `purpose` optional, `StoredDocument`
  widened with the declared content type, the size and when
- `InMemoryObjectStore(bucket, origin?)`; `InMemoryDocumentIntakePort` takes a vault
- Tests: four route cases (`document-routes.test.ts`), three browser cases against the documented
  CORS rule (`student-client.test.ts`)

## What was not built

- **The gate's reason on the page.** See above.
- **The retention sweep** that calls `purgeContents`, and **the runner's fetch** of a retrieval URL —
  `attach_document` needs the intent identity ADR-0069 names and a `WorkKind` that can carry it
  (state-of-the-system blocker 9). Both are in the reachability register with their reasons.
- **A document the interview asks for.** `request_document` is still unreachable through the run
  driver (ADR-0064 §4); the page offers the upload at any time rather than when asked, and a run
  does not yet notice what the student has sent.

**Declared-but-unreachable surface: six, unchanged.**
