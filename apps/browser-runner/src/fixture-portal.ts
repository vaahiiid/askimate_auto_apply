/**
 * A controlled portal that actually requires an account.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The first end-to-end product test needs a target, and the choice between a
 * real university portal and one we own is not close. A real portal would make
 * the first integration test depend on a third party's uptime, its generated
 * Salesforce ids and its shadow DOM. The test would then be measuring THEIR
 * reliability, and a red build would say nothing about our architecture.
 *
 * So: a portal we own, and one that is genuinely gated.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The gate is the point ─────────────────────────────────────────────────
 *
 * `/apply` redirects to `/register` without a session cookie. That single rule
 * is what makes the secure interaction REAL rather than decorative: the run
 * cannot reach the application form without an account, the account cannot be
 * created without a password, and the password can only come from the student
 * through the Secure Plane. A fixture that served the form to anyone would let
 * the whole credential path be skipped while every test still passed.
 *
 * ── Why there is a login page ─────────────────────────────────────────────
 *
 * Nothing here ever renders a password back, so a test cannot assert "the right
 * password arrived" by reading a page — which is exactly the property we want.
 * `POST /login` is how it is proved instead: register with a password, then
 * sign in with it. That is the portal using the credential the way a real one
 * does, and it fails if a single character was mistyped, truncated or swapped.
 *
 * ── Deliberately not a mock ───────────────────────────────────────────────
 *
 * Sessions are real cookies. Validation is real refusal — a short password, a
 * mismatched confirmation and a duplicate email are all rejected the way a
 * portal rejects them, because an automation that has never met a refusal has
 * not been tested against one. `submissions()` exists so a test can assert the
 * one thing this system must never do: submit.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * What the portal stored for one applicant. Never rendered back.
 *
 * No `createdAt`: nothing reads one, and the lint rule that forbids reading the
 * ambient clock is right to catch it — a field added because a real portal
 * would have one is a field that has to be injected, tested and kept true.
 */
interface Account {
  readonly email: string;
  readonly password: string;
}

/** A file the portal received on its documents page. Its hash, never its bytes, is what a test reads. */
export interface PortalUpload {
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** SHA-256 of the bytes received, lowercase hex. */
  readonly sha256: string;
}

/** What an applicant filled in. Rendered back on the review page. */
export interface PortalApplication {
  readonly givenName: string;
  readonly familyName: string;
  readonly dateOfBirth: string;
  readonly nationality: string;
  /** The passport's country, from the list the page fills after the nationality (P94). */
  readonly passportCountry: string;
  /** The level of study the course search takes (P102); "" until page two is saved. */
  readonly studyLevel: string;
  /** The course chosen from the study page's search (P95); "" until page two is saved. */
  readonly courseCode: string;
  /** The start date chosen from the list a press shows (ADR-0105); "" until page two is saved. */
  readonly startDate: string;
  /** The qualifications added on the education page (P96), in the order added. */
  readonly qualifications: readonly PortalQualification[];
  readonly personalStatement: string;
  /** The passport, once page three is saved (P74). */
  readonly passport: PortalUpload | null;
  /** The status the applicant set beside the passport (P93): "now" or "later". */
  readonly passportStatus: string | null;
}

export interface FixturePortal {
  readonly baseUrl: string;
  readonly host: string;
  /** Emails that successfully created an account. Never the passwords. */
  accounts(): readonly string[];
  /**
   * Whether these credentials work.
   *
   * The only way to check a password reached the portal intact, and it does not
   * reveal one: it answers a question that was already asked.
   */
  credentialsWork(email: string, password: string): boolean;
  /** What was filled in, for the account that signed in. */
  application(email: string): PortalApplication | null;
  /** Applications actually SUBMITTED. This must stay empty (ADR-0014). */
  submissions(): readonly string[];
  /** Every request the portal received, so a run can be checked afterwards. */
  readonly requests: readonly { readonly method: string; readonly path: string }[];
  stop(): Promise<void>;
}

const MINIMUM_PASSWORD_LENGTH = 8;
/** The code the fixture "emailed". A test that passes the second factor types this. */
export const SECOND_FACTOR_CODE = "246810";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Constant-time comparison, in a fixture.
 *
 * Not because a test can be timed, but because a fixture that compares
 * passwords with `===` is a fixture someone eventually copies.
 */
function samePassword(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

/**
 * What a portal may put in the way that only a person can pass (ADR-0101 §6).
 *
 *   captcha        a reCAPTCHA-shaped widget on the registration and sign-in
 *                  forms, and a POST without its response is refused — the
 *                  shape of the real thing, with no third party behind it.
 *   second_factor  registration and sign-in are ACCEPTED, and the portal then
 *                  asks for a code it "emailed" before it will sign in. The
 *                  account exists by then, which is the case a runner has to
 *                  report honestly.
 */
export type FixtureChallenge = "captcha" | "second_factor";

export interface FixturePortalOptions {
  readonly challenge?: FixtureChallenge;
}

/** The widget as the real one renders: a marked div and the response field it writes to. */
const CAPTCHA_WIDGET = `
  <div class="g-recaptcha" id="captcha" data-sitekey="fixture-site-key">I am not a robot</div>
  <textarea name="g-recaptcha-response" id="captchaResponse" hidden></textarea>`;

const REGISTER_PAGE = (error: string | null, challenge?: FixtureChallenge): string =>
  page(
    "Create your account",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/register" id="registerForm">
  <label for="email">Email address</label>
  <input type="email" id="email" name="email" required autocomplete="username">

  <label for="password">Password</label>
  <input type="password" id="password" name="password" required minlength="8"
         autocomplete="new-password">

  <label for="passwordConfirm">Confirm password</label>
  <input type="password" id="passwordConfirm" name="password_confirm" required minlength="8"
         autocomplete="new-password">

  <p>Your password must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.</p>
${challenge === "captcha" ? CAPTCHA_WIDGET : ""}
  <button type="submit" id="createAccount">Create account</button>
</form>
<p>Already registered? <a href="/login">Sign in</a></p>
<p><a href="/private/staff-only">Staff area</a></p>`,
  );

const LOGIN_PAGE = (error: string | null, challenge?: FixtureChallenge): string =>
  page(
    "Sign in",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/login" id="loginForm">
  <label for="email">Email address</label>
  <input type="email" id="email" name="email" required autocomplete="username">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">
${challenge === "captcha" ? CAPTCHA_WIDGET : ""}
  <button type="submit" id="signIn">Sign in</button>
</form>`,
  );

/** The second factor, as portals put it: a code the applicant was emailed. */
const VERIFY_PAGE = (error: string | null): string =>
  page(
    "Check your email",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<p>We have emailed you a 6-digit verification code.</p>
<form method="post" action="/verify" id="verifyForm">
  <label for="code">Enter the verification code</label>
  <input type="text" id="code" name="verification_code" inputmode="numeric" autocomplete="one-time-code"
         required maxlength="6">
  <button type="submit" id="verify">Continue</button>
</form>`,
  );

/** `selected` when the held value is this option's (ADR-0106: a saved page shows what it holds). */
const selectedIf = (held: string | undefined, value: string): string => (held === value ? " selected" : "");
const valueAttr = (held: string | undefined): string => (held === undefined || held.length === 0 ? "" : ` value="${escapeHtml(held)}"`);

// ADR-0106: reopened after a save, the page shows what the portal holds — as
// a server-rendered form does — so a runner can read its values back. Before
// a save it is empty, as it always was.
const APPLY_PAGE = (error: string | null, held?: PortalApplication): string =>
  page(
    "Your application",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/apply" id="applicationForm">
  <label for="givenName">First name</label>
  <input type="text" id="givenName" name="given_name" required maxlength="50"${valueAttr(held?.givenName)}>

  <label for="familyName">Last name</label>
  <input type="text" id="familyName" name="family_name" required maxlength="50"${valueAttr(held?.familyName)}>

  <label for="dob">Date of birth</label>
  <input type="text" id="dob" name="date_of_birth" required pattern="\\d{2}/\\d{2}/\\d{4}"
         placeholder="DD/MM/YYYY"${valueAttr(held?.dateOfBirth)}>

  <label for="nationality">Nationality</label>
  <select id="nationality" name="nationality" required>
    <option value="">Please select</option>
    <option value="IR"${selectedIf(held?.nationality, "IR")}>Iran (Islamic Republic of)</option>
    <option value="IQ"${selectedIf(held?.nationality, "IQ")}>Iraq</option>
    <option value="GB"${selectedIf(held?.nationality, "GB")}>United Kingdom</option>
  </select>

  <label for="passportCountry">Country that issued your passport</label>
  <select id="passportCountry" name="passport_country" required>
${
  held === undefined || held.passportCountry.length === 0
    ? '    <option value="">Choose a nationality first</option>'
    : (PASSPORT_COUNTRIES[held.nationality] ?? [])
        .map((entry) => `    <option value="${escapeHtml(entry.value)}"${selectedIf(held.passportCountry, entry.value)}>${escapeHtml(entry.label)}</option>`)
        .join("\n")
}
  </select>

  <button type="submit" id="continueBtn">Save and continue</button>
</form>
<script>
  // P94 (ADR-0103, gap 1): a list the page fills from the server once another
  // field is set — the education chain's shape on the first real form. Nothing
  // is offered until the nationality is chosen, and then only after the answer.
  document.getElementById("nationality").addEventListener("change", function (event) {
    var list = document.getElementById("passportCountry");
    list.innerHTML = '<option value="">Loading…</option>';
    fetch("/passport-countries?nationality=" + encodeURIComponent(event.target.value))
      .then(function (response) { return response.json(); })
      .then(function (offered) {
        list.innerHTML = "";
        offered.forEach(function (entry) {
          var option = document.createElement("option");
          option.value = entry.value;
          option.textContent = entry.label;
          list.appendChild(option);
        });
      });
  });
</script>`,
  );

/** What the portal offers as a passport's country for a nationality — answered late, on purpose. */
const PASSPORT_COUNTRIES: Record<string, readonly { readonly value: string; readonly label: string }[]> = {
  IR: [
    { value: "IR", label: "Iran (Islamic Republic of)" },
    { value: "XX", label: "Another country" },
  ],
  IQ: [
    { value: "IQ", label: "Iraq" },
    { value: "XX", label: "Another country" },
  ],
  GB: [
    { value: "GB", label: "United Kingdom" },
    { value: "XX", label: "Another country" },
  ],
};

/**
 * The SECOND application page.
 *
 * Real applications are paginated, and page one being saved is what makes page
 * two reachable — which is why `/study` redirects back to `/apply` until the
 * personal details are in. A portal that let you skip to page two would not
 * exercise the thing this fixture exists to exercise.
 */
const STUDY_PAGE = (error: string | null, held?: PortalApplication): string =>
  page(
    "Your course",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/study" id="studyForm">
  <label for="studyLevel">Level of study</label>
  <select id="studyLevel" name="study_level" required>
    <option value="">Please select</option>
    <option value="pg"${selectedIf(held?.studyLevel, "pg")}>Postgraduate</option>
    <option value="ug"${selectedIf(held?.studyLevel, "ug")}>Undergraduate</option>
  </select>

  <label for="course">Course</label>
  <input type="text" id="course" name="course_name" autocomplete="off"${valueAttr(COURSES.find((course) => course.code === held?.courseCode)?.name)}>
  <ul id="courseOptions" role="listbox"></ul>
  <input type="hidden" id="courseCode" name="course_code" value="${escapeHtml(held?.courseCode ?? "")}">

  <label for="startDate">Start date</label>
  <button type="button" id="showStartDatesBtn">Show start dates</button>
  <select id="startDate" name="start_date" required>
${
  held === undefined || held.startDate.length === 0
    ? '    <option value="">Show the start dates first</option>'
    : (START_DATES[held.courseCode] ?? [])
        .map((entry) => `    <option value="${escapeHtml(entry.value)}"${selectedIf(held.startDate, entry.value)}>${escapeHtml(entry.label)}</option>`)
        .join("\n")
}
  </select>

  <label for="statement">Why do you want to study this course?</label>
  <textarea id="statement" name="personal_statement" maxlength="4000" required>${escapeHtml(held?.personalStatement ?? "")}</textarea>

  <button type="submit" id="studyContinueBtn">Save and continue</button>
</form>
<script>
  // ADR-0105: a search-then-select. The start dates are loaded for the chosen
  // course only when the control is pressed; the press loads options and
  // nothing else — no navigation, no save.
  document.getElementById("showStartDatesBtn").addEventListener("click", function () {
    var list = document.getElementById("startDate");
    fetch("/start-dates?course=" + encodeURIComponent(document.getElementById("courseCode").value))
      .then(function (response) { return response.json(); })
      .then(function (offered) {
        list.innerHTML = '<option value="">Please select</option>';
        offered.forEach(function (entry) {
          var option = document.createElement("option");
          option.value = entry.value;
          option.textContent = entry.label;
          list.appendChild(option);
        });
      });
  });

  // P95 (ADR-0103, gap 2): a course search. Entries come from the server for
  // what was typed, after a pause; choosing one names the course by its code.
  // Two entries share a prefix, so only exact text names one course.
  // P102: the request carries the chosen level, as the first real form's
  // institution search carries the chosen country; with no level chosen the
  // server offers nothing.
  (function () {
    var box = document.getElementById("course");
    var list = document.getElementById("courseOptions");
    var code = document.getElementById("courseCode");
    var level = document.getElementById("studyLevel");
    box.addEventListener("input", function () {
      code.value = "";
      fetch("/courses?q=" + encodeURIComponent(box.value) + "&level=" + encodeURIComponent(level.value))
        .then(function (response) { return response.json(); })
        .then(function (offered) {
          list.innerHTML = "";
          offered.forEach(function (course) {
            var entry = document.createElement("li");
            entry.setAttribute("role", "option");
            entry.textContent = course.name;
            entry.addEventListener("click", function () {
              box.value = course.name;
              code.value = course.code;
              list.innerHTML = "";
            });
            list.appendChild(entry);
          });
        });
    });
  })();
</script>`,
  );

/**
 * The education page (P96, ADR-0103 gap 3): the qualifications added so far,
 * an "Add a qualification" control that reveals an empty form, a save that
 * adds ONE and shows the list again, and a continue that leaves the page. The
 * shape of a real portal's repeatable block — one entry per qualification,
 * each through the same boxes.
 */
const EDUCATION_PAGE = (
  qualifications: readonly PortalQualification[],
  error: string | null,
): string =>
  page(
    "Your qualifications",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<ul id="qualifications">
${qualifications
  .map(
    (q) =>
      `  <li class="qualification">${escapeHtml(q.level)} — ${escapeHtml(q.subject)}, ${escapeHtml(q.institution)}, ${escapeHtml(q.year)}</li>`,
  )
  .join("\n")}
</ul>
<button type="button" id="addQualificationBtn">Add a qualification</button>
<form method="post" action="/education/add" id="qualificationForm" enctype="multipart/form-data" hidden>
  <label for="qualificationLevel">Qualification</label>
  <input type="text" id="qualificationLevel" name="level" maxlength="80">

  <label for="qualificationSubject">Subject</label>
  <input type="text" id="qualificationSubject" name="subject">

  <label for="qualificationInstitution">Institution</label>
  <input type="text" id="qualificationInstitution" name="institution">

  <label for="qualificationYear">Year completed</label>
  <input type="text" id="qualificationYear" name="year" pattern="\\d{4}">

  <div id="gradeNoteRow" hidden>
    <label for="qualificationGradeNote">Grade, as on the certificate</label>
    <input type="text" id="qualificationGradeNote" name="grade_note">
  </div>

  <label for="qualificationCertificate">Certificate</label>
  <input type="file" id="qualificationCertificate" name="certificate" accept=".pdf,.jpg,.png">
  <fieldset id="certificateStatus">
    <legend>Certificate status</legend>
    <label><input type="radio" name="certificate_status" value="now"> I am attaching it now</label>
    <label><input type="radio" name="certificate_status" value="later"> I will send it later</label>
    <label><input type="radio" name="certificate_status" value="english"> It is in English</label>
  </fieldset>

  <button type="submit" id="saveQualificationBtn">Save this qualification</button>
</form>
<form method="post" action="/education" id="educationForm">
  <button type="submit" id="educationContinueBtn">Save and continue</button>
</form>
<script>
  document.getElementById("addQualificationBtn").addEventListener("click", function () {
    document.getElementById("qualificationForm").hidden = false;
  });
  // The grade box is asked only of a school qualification (ADR-0104: a
  // condition inside a repeat, answered per entry).
  document.getElementById("qualificationLevel").addEventListener("input", function (event) {
    document.getElementById("gradeNoteRow").hidden = event.target.value !== "High school diploma";
  });
</script>`,
  );

/** One qualification as the education page holds it. */
export interface PortalQualification {
  readonly level: string;
  readonly subject: string;
  readonly institution: string;
  readonly year: string;
  /** The grade box, shown for a school qualification only; "" otherwise. */
  readonly gradeNote: string;
  /** The certificate's filename when the applicant attached one; null otherwise. */
  readonly certificate: string | null;
  /** The status the applicant set beside the certificate (ADR-0105): "now", "later", "english" or "". */
  readonly certificateStatus: string;
}

/** The start dates each course offers, shown on a press. */
const START_DATES: Record<string, readonly { readonly value: string; readonly label: string }[]> = {
  "PG-EX-2026": [
    { value: "2026-09", label: "September 2026" },
    { value: "2027-01", label: "January 2027" },
  ],
  "PG-EX-2026-PT": [{ value: "2026-09", label: "September 2026" }],
  "PG-OT-2026": [{ value: "2027-01", label: "January 2027" }],
};

/** The courses the study page's search offers. */
const COURSES: readonly { readonly code: string; readonly name: string; readonly level: string }[] = [
  { code: "PG-EX-2026", name: "MSc Example Studies", level: "pg" },
  { code: "PG-EX-2026-PT", name: "MSc Example Studies (part-time)", level: "pg" },
  { code: "PG-OT-2026", name: "MA Other Studies", level: "pg" },
  // P102: a course of another level, so the level in the request is seen to matter.
  { code: "UG-EX-2026", name: "BSc Example Studies", level: "ug" },
];

/**
 * The THIRD application page: a document (P74).
 *
 * One file input, labelled, inside a multipart form — the shape a real
 * documents page has, and the shape `setInputFiles` posts. Reachable only once
 * page two is saved, as page two is only once page one is.
 */
const DOCUMENTS_PAGE = (error: string | null, held?: PortalApplication): string =>
  page(
    "Your documents",
    `${error === null ? "" : `<p id="error" role="alert">${escapeHtml(error)}</p>`}
<form method="post" action="/documents" id="documentsForm" enctype="multipart/form-data">
  <label for="passport">Upload your passport</label>
  <input type="file" id="passport" name="passport" required accept=".pdf,.jpg,.png">
  ${
    // ADR-0106: a file input reads back empty by HTML's rule; what shows a
    // held file is the page saying so. The blueprint names this marker.
    held?.passport === null || held?.passport === undefined
      ? ""
      : `<p id="passportHeld">Held: ${escapeHtml(held.passport.filename)}</p>`
  }
  <!-- P93 (gap 4): the companion the real form has — a status the applicant
       must set beside the file. Sheffield ticks it from the file input's own
       script on sixteen slots and not on the seventeenth; this page is the
       seventeenth, so the runner's second act is what the save depends on. -->
  <fieldset>
    <legend>Passport status</legend>
    <input type="radio" id="passportNow" name="passportStatus" value="now"${held?.passportStatus === "now" ? " checked" : ""}><label for="passportNow">I am uploading it now</label>
    <input type="radio" id="passportLater" name="passportStatus" value="later"${held?.passportStatus === "later" ? " checked" : ""}><label for="passportLater">I will upload it later</label>
  </fieldset>

  <button type="submit" id="documentsContinueBtn">Save and continue</button>
</form>`,
  );

const REVIEW_PAGE = (application: PortalApplication): string =>
  page(
    "Review your application",
    `<dl id="review">
  <dt>First name</dt><dd id="reviewGivenName">${escapeHtml(application.givenName)}</dd>
  <dt>Last name</dt><dd id="reviewFamilyName">${escapeHtml(application.familyName)}</dd>
  <dt>Date of birth</dt><dd id="reviewDob">${escapeHtml(application.dateOfBirth)}</dd>
  <dt>Nationality</dt><dd id="reviewNationality">${escapeHtml(application.nationality)}</dd>
  <dt>Passport country</dt><dd id="reviewPassportCountry">${escapeHtml(application.passportCountry)}</dd>
  <dt>Qualifications</dt>
  <dd id="reviewQualifications">${application.qualifications.length === 0 ? "none" : application.qualifications.map((q) => escapeHtml(`${q.level} (${q.institution}, ${q.year})`)).join("; ")}</dd>
  <dt>Course</dt><dd id="reviewCourse">${escapeHtml(application.courseCode)}</dd>
  <dt>Start date</dt><dd id="reviewStartDate">${escapeHtml(application.startDate)}</dd>
  <dt>Personal statement</dt>
  <dd id="reviewStatement">${escapeHtml(application.personalStatement)}</dd>
  <dt>Passport</dt>
  <dd id="reviewPassport">${application.passport === null ? "not yet provided" : escapeHtml(application.passport.filename)}</dd>
</dl>
<form method="post" action="/submit" id="submitForm">
  <button type="submit" id="submitBtn">Submit application</button>
</form>`,
  );

/** The one field page two carries. Named so the handler reads as one line. */
function body2(body: URLSearchParams): string {
  return body.get("personal_statement") ?? "";
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * The one multipart form this portal has, read the way a browser posts it.
 *
 * Enough of RFC 7578 for a file input and nothing more: the boundary from the
 * content type, one part per field, a filename and a content type where the
 * part carries a file. Binary-safe — split on the boundary as bytes, never
 * as a string — because a PDF is not text.
 */
async function readMultipart(
  request: IncomingMessage,
): Promise<Map<string, { filename: string | null; contentType: string; bytes: Buffer }>> {
  const type = request.headers["content-type"] ?? "";
  const boundary = /boundary=("?)([^";]+)\1/.exec(type)?.[2];
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const parts = new Map<string, { filename: string | null; contentType: string; bytes: Buffer }>();
  if (boundary === undefined) return parts;

  const marker = Buffer.from(`--${boundary}`);
  let at = body.indexOf(marker);
  while (at !== -1) {
    const next = body.indexOf(marker, at + marker.length);
    if (next === -1) break;
    // Between this marker's line and the next marker: headers, a blank line,
    // then the value, then the CRLF that precedes the next marker.
    const part = body.subarray(at + marker.length, next);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const value = part.subarray(headerEnd + 4, part.length - 2);
      const name = /name="([^"]*)"/.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/.exec(headers)?.[1] ?? null;
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? "application/octet-stream";
      if (name !== undefined) parts.set(name, { filename, contentType, bytes: Buffer.from(value) });
    }
    at = next;
  }
  return parts;
}

function sessionOf(request: IncomingMessage): string | null {
  const cookie = request.headers.cookie ?? "";
  return /portal_session=([^;]+)/.exec(cookie)?.[1] ?? null;
}

function send(response: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  response
    .writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers })
    .end(html);
}

/** Starts the portal on an ephemeral port. */
export async function startFixturePortal(
  options: FixturePortalOptions = {},
): Promise<FixturePortal> {
  const challenge = options.challenge;
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, string>();
  /** Accounts that have signed in but not yet passed the second factor. */
  const awaitingCode = new Map<string, string>();
  const applications = new Map<string, PortalApplication>();
  const submissions: string[] = [];
  const requests: { method: string; path: string }[] = [];

  const server: Server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = request.method ?? "GET";
      requests.push({ method, path });

      const session = sessionOf(request);
      const signedInAs = session === null ? null : (sessions.get(session) ?? null);

      // ── A real robots.txt, so obedience is proved against a real server ──
      //
      // Not permissive. `/private/` is disallowed and linked from the pages
      // below, so a discovery run that ignored robots.txt would visit it and
      // `cli.test.ts` would see it in the visited list. A fixture that allowed
      // everything would prove only that the fetch happened.
      if (method === "GET" && path === "/robots.txt") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(
          ["User-agent: *", "Disallow: /private/", "Crawl-delay: 1", ""].join("\n"),
        );
        return;
      }

      if (method === "GET" && path === "/private/staff-only") {
        // Reachable only by ignoring robots.txt. If a run ever renders this,
        // the guard is not working.
        send(response, 200, "<html><body><h1>Staff only</h1></body></html>");
        return;
      }

      if (method === "GET" && (path === "/" || path === "/register")) {
        send(response, 200, REGISTER_PAGE(null, challenge));
        return;
      }

      // ── The second factor, before the gate: it is how one gets past it ──
      if (challenge === "second_factor" && method === "GET" && path === "/verify") {
        send(response, 200, VERIFY_PAGE(null));
        return;
      }
      if (challenge === "second_factor" && method === "POST" && path === "/verify") {
        const body = await readBody(request);
        const pending = sessionOf(request);
        const email = pending === null ? undefined : awaitingCode.get(pending);
        if (email === undefined) {
          send(response, 302, "", { location: "/login" });
          return;
        }
        if ((body.get("verification_code") ?? "") !== SECOND_FACTOR_CODE) {
          send(response, 400, VERIFY_PAGE("That code is not right."));
          return;
        }
        awaitingCode.delete(pending ?? "");
        const id = randomBytes(16).toString("hex");
        sessions.set(id, email);
        send(response, 302, "", {
          location: "/apply",
          "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
        });
        return;
      }

      if (method === "POST" && path === "/register") {
        const body = await readBody(request);
        const email = (body.get("email") ?? "").trim();
        const password = body.get("password") ?? "";
        const confirmation = body.get("password_confirm") ?? "";

        // Real refusals, in the order a portal makes them. An automation that
        // has never met a refusal has not been tested against one.
        if (email.length === 0 || !email.includes("@")) {
          send(response, 400, REGISTER_PAGE("Enter a valid email address."));
          return;
        }
        if (accounts.has(email.toLowerCase())) {
          send(response, 409, REGISTER_PAGE("An account already exists for that email."));
          return;
        }
        if (password.length < MINIMUM_PASSWORD_LENGTH) {
          send(
            response,
            400,
            REGISTER_PAGE(`Your password must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`),
          );
          return;
        }
        if (!samePassword(password, confirmation)) {
          // The message names neither value, because a fixture that echoed one
          // would be a fixture that taught the wrong habit.
          send(response, 400, REGISTER_PAGE("The two passwords do not match.", challenge));
          return;
        }
        if (challenge === "captcha" && (body.get("g-recaptcha-response") ?? "").length === 0) {
          send(response, 400, REGISTER_PAGE("Confirm you are not a robot.", challenge));
          return;
        }

        accounts.set(email.toLowerCase(), { email, password });
        const id = randomBytes(16).toString("hex");
        if (challenge === "second_factor") {
          // The account EXISTS from here. What it does not have is a session:
          // the portal wants the code first, and the cookie it sets names a
          // pending verification rather than a signed-in account.
          awaitingCode.set(id, email.toLowerCase());
          send(response, 302, "", {
            location: "/verify",
            "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
          });
          return;
        }
        sessions.set(id, email.toLowerCase());
        send(response, 302, "", {
          location: "/apply",
          "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
        });
        return;
      }

      if (method === "GET" && path === "/login") {
        send(response, 200, LOGIN_PAGE(null, challenge));
        return;
      }

      if (method === "POST" && path === "/login") {
        const body = await readBody(request);
        const email = (body.get("email") ?? "").trim().toLowerCase();
        const password = body.get("password") ?? "";
        const account = accounts.get(email);
        if (account === undefined || !samePassword(account.password, password)) {
          send(response, 401, LOGIN_PAGE("Those details do not match an account.", challenge));
          return;
        }
        if (challenge === "captcha" && (body.get("g-recaptcha-response") ?? "").length === 0) {
          send(response, 400, LOGIN_PAGE("Confirm you are not a robot.", challenge));
          return;
        }
        const id = randomBytes(16).toString("hex");
        if (challenge === "second_factor") {
          awaitingCode.set(id, email);
          send(response, 302, "", {
            location: "/verify",
            "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
          });
          return;
        }
        sessions.set(id, email);
        send(response, 302, "", {
          location: "/apply",
          "set-cookie": `portal_session=${id}; Path=/; HttpOnly`,
        });
        return;
      }

      // ── THE GATE ────────────────────────────────────────────────────────
      //
      // Everything below needs an account. This is what makes the secure
      // interaction real rather than decorative.
      if (signedInAs === null) {
        send(response, 302, "", { location: "/register" });
        return;
      }

      if (method === "GET" && path === "/apply") {
        send(response, 200, APPLY_PAGE(null, applications.get(signedInAs)));
        return;
      }

      if (method === "GET" && path === "/passport-countries") {
        // The list the apply page fetches after the nationality is chosen.
        // Answered after a pause, so a fill that did not wait meets an empty
        // list — the thing P94 exists to handle.
        const offered = PASSPORT_COUNTRIES[url.searchParams.get("nationality") ?? ""] ?? [];
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(offered));
        }, 400);
        return;
      }

      if (method === "POST" && path === "/apply") {
        const body = await readBody(request);
        const dateOfBirth = body.get("date_of_birth") ?? "";
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateOfBirth)) {
          send(response, 400, APPLY_PAGE("Enter your date of birth as DD/MM/YYYY."));
          return;
        }
        const passportCountry = body.get("passport_country") ?? "";
        const offeredFor = PASSPORT_COUNTRIES[body.get("nationality") ?? ""] ?? [];
        if (!offeredFor.some((entry) => entry.value === passportCountry)) {
          send(response, 400, APPLY_PAGE("Choose the country that issued your passport."));
          return;
        }
        // Page one is KEPT on save, and page two is a separate submission. That
        // is the whole point of a paginated portal: the student's work survives
        // between pages, and so must a runner's.
        applications.set(signedInAs, {
          givenName: body.get("given_name") ?? "",
          familyName: body.get("family_name") ?? "",
          dateOfBirth,
          nationality: body.get("nationality") ?? "",
          passportCountry,
          studyLevel: applications.get(signedInAs)?.studyLevel ?? "",
          courseCode: applications.get(signedInAs)?.courseCode ?? "",
          startDate: applications.get(signedInAs)?.startDate ?? "",
          qualifications: applications.get(signedInAs)?.qualifications ?? [],
          personalStatement: applications.get(signedInAs)?.personalStatement ?? "",
          passport: applications.get(signedInAs)?.passport ?? null,
          passportStatus: applications.get(signedInAs)?.passportStatus ?? null,
        });
        send(response, 302, "", { location: "/study" });
        return;
      }

      if (method === "GET" && path === "/education") {
        // Reachable once page one is saved, like the study page; unlike it,
        // not on the save chain — a block a student may fill zero times.
        const held = applications.get(signedInAs);
        if (held === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        send(response, 200, EDUCATION_PAGE(held.qualifications, null));
        return;
      }

      if (method === "POST" && path === "/education/add") {
        const held = applications.get(signedInAs);
        if (held === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        // Multipart, as the form is: a certificate may come with the entry.
        const parts = await readMultipart(request);
        const field = (name: string): string => parts.get(name)?.bytes.toString("utf8") ?? "";
        const level = field("level");
        if (level.trim().length === 0) {
          send(response, 400, EDUCATION_PAGE(held.qualifications, "Say what the qualification is."));
          return;
        }
        const certificate = parts.get("certificate");
        applications.set(signedInAs, {
          ...held,
          qualifications: [
            ...held.qualifications,
            {
              level,
              subject: field("subject"),
              institution: field("institution"),
              year: field("year"),
              gradeNote: field("grade_note"),
              certificateStatus: field("certificate_status"),
              certificate:
                certificate === undefined || certificate.filename === null || certificate.filename.length === 0
                  ? null
                  : certificate.filename,
            },
          ],
        });
        send(response, 302, "", { location: "/education" });
        return;
      }

      if (method === "POST" && path === "/education") {
        if (applications.get(signedInAs) === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        send(response, 302, "", { location: "/study" });
        return;
      }

      if (method === "GET" && path === "/start-dates") {
        const offered = START_DATES[url.searchParams.get("course") ?? ""] ?? [];
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(offered));
        }, 300);
        return;
      }

      if (method === "GET" && path === "/courses") {
        // The study page's search, answered after a pause for what was typed.
        const typed = (url.searchParams.get("q") ?? "").trim().toLowerCase();
        // P102: for the level chosen, and nothing for none.
        const level = url.searchParams.get("level") ?? "";
        const offered =
          typed.length === 0 || level.length === 0
            ? []
            : COURSES.filter((course) => course.level === level && course.name.toLowerCase().startsWith(typed)).map(
                ({ code, name }) => ({ code, name }),
              );
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(offered));
        }, 300);
        return;
      }

      if (method === "GET" && path === "/study") {
        // Page two is unreachable until page one is saved.
        if (applications.get(signedInAs) === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        send(response, 200, STUDY_PAGE(null, applications.get(signedInAs)));
        return;
      }

      if (method === "POST" && path === "/study") {
        const held = applications.get(signedInAs);
        if (held === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        const studyBody = await readBody(request);
        const statement = body2(studyBody);
        if (statement.length === 0) {
          send(response, 400, STUDY_PAGE("Tell us why you want to study this course."));
          return;
        }
        // P102: the level first; the search took it.
        const studyLevel = studyBody.get("study_level") ?? "";
        if (studyLevel !== "pg" && studyLevel !== "ug") {
          send(response, 400, STUDY_PAGE("Choose your level of study."));
          return;
        }
        // P95: the course must be one the search offers — chosen, not typed —
        // and (P102) of the level chosen.
        const courseCode = studyBody.get("course_code") ?? "";
        if (!COURSES.some((course) => course.code === courseCode && course.level === studyLevel)) {
          send(response, 400, STUDY_PAGE("Choose your course from the list."));
          return;
        }
        // ADR-0105: the start date must be one the course offers — shown on
        // a press, chosen, not typed.
        const startDate = studyBody.get("start_date") ?? "";
        if (!(START_DATES[courseCode] ?? []).some((entry) => entry.value === startDate)) {
          send(response, 400, STUDY_PAGE("Choose a start date the course offers."));
          return;
        }
        applications.set(signedInAs, { ...held, personalStatement: statement, studyLevel, courseCode, startDate });
        send(response, 302, "", { location: "/documents" });
        return;
      }

      if (method === "GET" && path === "/documents") {
        // Page three is unreachable until page two is saved.
        const held = applications.get(signedInAs);
        if (held === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        if (held.personalStatement.length === 0) {
          send(response, 302, "", { location: "/study" });
          return;
        }
        send(response, 200, DOCUMENTS_PAGE(null, held));
        return;
      }

      if (method === "POST" && path === "/documents") {
        const held = applications.get(signedInAs);
        if (held === undefined || held.personalStatement.length === 0) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        const parts = await readMultipart(request);
        const passport = parts.get("passport");
        if (passport === undefined || passport.bytes.length === 0) {
          send(response, 400, DOCUMENTS_PAGE("Choose the file to upload."));
          return;
        }
        // P93: a file with no status is refused, as the real form refuses it.
        const status = parts.get("passportStatus")?.bytes.toString("utf8") ?? "";
        if (status !== "now") {
          send(response, 400, DOCUMENTS_PAGE("Say whether you are uploading the passport now."));
          return;
        }
        applications.set(signedInAs, {
          ...held,
          passportStatus: status,
          passport: {
            filename: passport.filename ?? "",
            contentType: passport.contentType,
            sizeBytes: passport.bytes.length,
            sha256: createHash("sha256").update(passport.bytes).digest("hex"),
          },
        });
        send(response, 302, "", { location: "/review" });
        return;
      }

      if (method === "GET" && path === "/review") {
        const application = applications.get(signedInAs);
        if (application === undefined) {
          send(response, 302, "", { location: "/apply" });
          return;
        }
        // The review page is only complete once BOTH pages are saved.
        if (application.personalStatement.length === 0) {
          send(response, 302, "", { location: "/study" });
          return;
        }
        send(response, 200, REVIEW_PAGE(application));
        return;
      }

      if (method === "POST" && path === "/submit") {
        // Recorded so a test can assert this never happened. ADR-0014: the
        // system stops before submission, and "it did not submit" has to be
        // provable rather than assumed.
        submissions.push(signedInAs);
        send(response, 200, page("Submitted", "<p id='submitted'>Application submitted.</p>"));
        return;
      }

      send(response, 404, page("Not found", "<p>No such page.</p>"));
    })().catch(() => {
      if (!response.headersSent) send(response, 500, page("Error", "<p>Something went wrong.</p>"));
    });
  });

  const address = await new Promise<{ port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const listening = server.address();
      if (listening === null || typeof listening === "string") throw new Error("no port");
      resolve({ port: listening.port });
    });
  });

  const host = `127.0.0.1:${String(address.port)}`;
  return {
    baseUrl: `http://${host}`,
    host,
    accounts: () => [...accounts.values()].map((account) => account.email),
    credentialsWork: (email, password) => {
      const account = accounts.get(email.toLowerCase());
      return account !== undefined && samePassword(account.password, password);
    },
    application: (email) => applications.get(email.toLowerCase()) ?? null,
    submissions: () => [...submissions],
    requests,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
