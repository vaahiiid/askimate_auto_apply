/**
 * The published contract, checked against the code — and against itself.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Ensure no API contract can carry a secret value outside
 * the Secure Interaction Service. Ensure the Conversation Service never
 * receives or stores secret values."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two jobs, and the second is the one that matters.
 *
 *   1. DRIFT. The `.yaml` documents repeat every closed set, because YAML
 *      cannot import from TypeScript. These tests compare them in BOTH
 *      directions, so a value added to either without the other fails the build
 *      instead of shipping as a silent divergence between what we published and
 *      what we implement.
 *
 *   2. STRUCTURE. These walk every schema reachable from every operation in
 *      both documents and assert the security properties as facts about the
 *      contract rather than as claims in a comment. "Only one endpoint accepts
 *      a secret" is checked by counting them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { load } from "js-yaml";

import {
  ACTORS,
  EVENT_KINDS,
  PROBLEM_CODES,
  REJECTION_REASONS,
  SECRET_LIFECYCLES,
} from "./vocabulary.js";

type Json = Record<string, unknown>;

const OPENAPI_DIR = join(import.meta.dirname, "..", "openapi");

function loadSpec(name: string): Json {
  return load(readFileSync(join(OPENAPI_DIR, name), "utf8")) as Json;
}

const CONVERSATION = loadSpec("conversation.v1.yaml");
const SECURE = loadSpec("secure.v1.yaml");
const SPECS = [
  ["conversation.v1.yaml", CONVERSATION],
  ["secure.v1.yaml", SECURE],
] as const;

/** Follows a local `$ref`. Anything else is a mistake we want to hear about. */
function resolve(spec: Json, node: unknown, seen = new Set<string>()): unknown {
  if (typeof node !== "object" || node === null) return node;
  const record = node as Json;
  const ref = record["$ref"];
  if (typeof ref !== "string") return node;
  if (!ref.startsWith("#/")) throw new Error(`external $ref not allowed: ${ref}`);
  if (seen.has(ref)) return {};
  seen.add(ref);
  let cursor: unknown = spec;
  for (const segment of ref.slice(2).split("/")) {
    cursor = (cursor as Json)[segment];
    if (cursor === undefined) throw new Error(`dangling $ref: ${ref}`);
  }
  return resolve(spec, cursor, seen);
}

/** Every property name declared anywhere under a schema, refs followed. */
function propertyNames(spec: Json, node: unknown, seen = new Set<unknown>()): string[] {
  const resolved = resolve(spec, node);
  if (typeof resolved !== "object" || resolved === null) return [];
  if (seen.has(resolved)) return [];
  seen.add(resolved);

  const found: string[] = [];
  const record = resolved as Json;

  const properties = record["properties"];
  if (typeof properties === "object" && properties !== null) {
    for (const [name, child] of Object.entries(properties as Json)) {
      found.push(name);
      found.push(...propertyNames(spec, child, seen));
    }
  }
  for (const key of ["items", "additionalProperties", "not"]) {
    if (record[key] !== undefined) found.push(...propertyNames(spec, record[key], seen));
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const branch = record[key];
    if (Array.isArray(branch)) {
      for (const child of branch) found.push(...propertyNames(spec, child, seen));
    }
  }
  return found;
}

interface Operation {
  readonly spec: Json;
  readonly specName: string;
  readonly path: string;
  readonly method: string;
  readonly operation: Json;
}

function operations(): Operation[] {
  const found: Operation[] = [];
  for (const [specName, spec] of SPECS) {
    for (const [path, item] of Object.entries(spec["paths"] as Json)) {
      for (const [method, operation] of Object.entries(item as Json)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        found.push({ spec, specName, path, method, operation: operation as Json });
      }
    }
  }
  return found;
}

/** Schemas of every media type of a request or response body. */
function bodySchemas(spec: Json, container: unknown): unknown[] {
  const resolved = resolve(spec, container);
  if (typeof resolved !== "object" || resolved === null) return [];
  const content = (resolved as Json)["content"];
  if (typeof content !== "object" || content === null) return [];
  return Object.values(content as Json)
    .map((media) => (media as Json)["schema"])
    .filter((schema) => schema !== undefined);
}

/** Names that would mean a field holds, or describes, a secret value. */
const SECRET_BEARING = /^(secret|password|passphrase|plaintext|credential|pwd|confirmation)$/i;

// ───────────────────────────────────────────────────────────────────────────
// 1. Drift
// ───────────────────────────────────────────────────────────────────────────

function enumOf(spec: Json, schemaName: string): string[] {
  const schema = (spec["components"] as Json)["schemas"] as Json;
  const target = schema[schemaName] as Json | undefined;
  if (target === undefined) throw new Error(`no schema named ${schemaName}`);
  const members = target["enum"];
  if (!Array.isArray(members)) throw new Error(`${schemaName} has no enum`);
  return members as string[];
}

describe("the published contract and the code do not drift", () => {
  it("agrees on the rejection reasons, in both documents and both directions", () => {
    for (const [name, spec] of SPECS) {
      expect(enumOf(spec, "RejectionReason").sort(), name).toEqual([...REJECTION_REASONS].sort());
    }
  });

  it("agrees on the problem codes", () => {
    for (const [name, spec] of SPECS) {
      expect(enumOf(spec, "ProblemCode").sort(), name).toEqual([...PROBLEM_CODES].sort());
    }
  });

  it("agrees on the lifecycle words", () => {
    expect(enumOf(SECURE, "SecretLifecycle").sort()).toEqual([...SECRET_LIFECYCLES].sort());
  });

  it("agrees on the event kinds, via the discriminator mapping", () => {
    const event = ((CONVERSATION["components"] as Json)["schemas"] as Json)[
      "ConversationEvent"
    ] as Json;
    const mapping = (event["discriminator"] as Json)["mapping"] as Json;
    expect(Object.keys(mapping).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it("agrees on the actors", () => {
    const message = ((CONVERSATION["components"] as Json)["schemas"] as Json)[
      "MessageEvent"
    ] as Json;
    const actor = (message["properties"] as Json)["actor"] as Json;
    expect((actor["enum"] as string[]).sort()).toEqual([...ACTORS].sort());
  });

  it("resolves every $ref, and uses no external one", () => {
    // A dangling ref makes a generated client silently miss a field; an
    // external one makes the contract depend on a network fetch to be read.
    for (const { spec, specName, path, method, operation } of operations()) {
      const where = `${specName} ${method.toUpperCase()} ${path}`;
      expect(() => {
        for (const schema of bodySchemas(spec, operation["requestBody"])) {
          propertyNames(spec, schema);
        }
        for (const response of Object.values((operation["responses"] ?? {}) as Json)) {
          for (const schema of bodySchemas(spec, response)) propertyNames(spec, schema);
        }
      }, where).not.toThrow();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Structure — the security properties, as facts about the documents
// ───────────────────────────────────────────────────────────────────────────

describe("no contract can carry a secret outside the one endpoint that takes one", () => {
  it("has EXACTLY ONE operation whose request body accepts a secret value", () => {
    const accepting: string[] = [];
    for (const { spec, specName, path, method, operation } of operations()) {
      for (const schema of bodySchemas(spec, operation["requestBody"])) {
        if (propertyNames(spec, schema).some((name) => SECRET_BEARING.test(name))) {
          accepting.push(`${specName} ${method.toUpperCase()} ${path}`);
        }
      }
    }
    // Counted, not asserted in prose. A second endpoint added later fails here.
    expect(accepting).toEqual(["secure.v1.yaml POST /v1/secret-requests/{requestId}/secret"]);
  });

  it("has NO response, anywhere, that can carry a secret value back", () => {
    // The strongest single property of the design: there is no read path.
    const leaking: string[] = [];
    for (const { spec, specName, path, method, operation } of operations()) {
      for (const [status, response] of Object.entries((operation["responses"] ?? {}) as Json)) {
        for (const schema of bodySchemas(spec, response)) {
          for (const name of propertyNames(spec, schema)) {
            if (SECRET_BEARING.test(name)) {
              leaking.push(`${specName} ${method.toUpperCase()} ${path} → ${status} (${name})`);
            }
          }
        }
      }
    }
    expect(leaking).toEqual([]);
  });

  it("lets the Conversation Service receive NOTHING secret-bearing, on any endpoint", () => {
    for (const { spec, specName, path, method, operation } of operations()) {
      if (specName !== "conversation.v1.yaml") continue;
      for (const schema of bodySchemas(spec, operation["requestBody"])) {
        expect(
          propertyNames(spec, schema).filter((name) => SECRET_BEARING.test(name)),
          `${method.toUpperCase()} ${path}`,
        ).toEqual([]);
      }
    }
  });

  it("never mentions a secret value anywhere in the conversation document", () => {
    // A blunt instrument, deliberately. The conversation plane has no business
    // naming a password in a schema, an example, or a parameter — and a grep
    // catches shapes the walk above does not, such as an example payload.
    const source = readFileSync(join(OPENAPI_DIR, "conversation.v1.yaml"), "utf8");
    const schemas = (CONVERSATION["components"] as Json)["schemas"] as Json;
    for (const name of Object.keys(schemas)) {
      expect(SECRET_BEARING.test(name), `schema ${name}`).toBe(false);
    }
    // The word may appear in prose explaining why it is absent; it may not
    // appear as a YAML key.
    expect(source).not.toMatch(/^\s+(secret|password|plaintext|credential):/m);
  });

  it("marks every secret-bearing field writeOnly, so no generator emits it in a response", () => {
    const submit = ((SECURE["components"] as Json)["schemas"] as Json)[
      "SubmitSecretRequest"
    ] as Json;
    const properties = submit["properties"] as Json;
    for (const field of ["secret", "confirmation"]) {
      expect((properties[field] as Json)["writeOnly"], field).toBe(true);
    }
    // And the bootstrap token, which is a capability rather than a secret of
    // the student's but must never be echoed either.
    const opened = ((SECURE["components"] as Json)["schemas"] as Json)[
      "OpenedSecretRequest"
    ] as Json;
    expect(((opened["properties"] as Json)["frameToken"] as Json)["writeOnly"]).toBe(true);
  });
});

describe("the event model is structurally content-free outside a message", () => {
  it("gives ONLY MessageEvent a content property", () => {
    const schemas = (CONVERSATION["components"] as Json)["schemas"] as Json;
    const eventSchemas = Object.keys(schemas).filter((name) => name.endsWith("Event"));
    // Guard against the check going inert if the schemas are ever renamed.
    expect(eventSchemas.length).toBeGreaterThanOrEqual(5);

    for (const name of eventSchemas) {
      const properties = Object.keys((schemas[name] as Json)["properties"] ?? {});
      if (name === "MessageEvent") {
        expect(properties).toContain("content");
      } else {
        expect(properties, name).not.toContain("content");
      }
    }
  });

  it("closes every event MEMBER to additional properties", () => {
    // Without this, `additionalProperties` defaults to true and a `content`
    // field on a secure event would be legal against the published contract
    // even though no member declares one.
    //
    // The first version of this test also asserted it of `ConversationEvent`
    // itself and failed — correctly. That schema is a `oneOf` wrapper, not an
    // object, so `additionalProperties` has nothing to constrain there. The
    // property it needs is a different one, and it is the next test.
    const schemas = (CONVERSATION["components"] as Json)["schemas"] as Json;
    const members = Object.keys(schemas).filter(
      (key) => key.endsWith("Event") && (schemas[key] as Json)["type"] === "object",
    );
    expect(members.length).toBeGreaterThanOrEqual(5);
    for (const name of members) {
      expect((schemas[name] as Json)["additionalProperties"], name).toBe(false);
    }
  });

  it("makes the event union CLOSED — a discriminated oneOf, not an open object", () => {
    // `oneOf` rather than `anyOf`: exactly one member must match, so a payload
    // satisfying two shapes is invalid rather than ambiguously accepted. The
    // discriminator must name every member, and every mapping target must
    // resolve — a mapping to a schema that does not exist is a union with a
    // hole in it.
    const event = ((CONVERSATION["components"] as Json)["schemas"] as Json)[
      "ConversationEvent"
    ] as Json;
    expect(Array.isArray(event["oneOf"])).toBe(true);
    expect(event["anyOf"]).toBeUndefined();

    const discriminator = event["discriminator"] as Json;
    expect(discriminator["propertyName"]).toBe("kind");
    const mapping = discriminator["mapping"] as Json;
    const branches = new Set(
      (event["oneOf"] as Json[]).map((branch) => String(branch["$ref"])),
    );
    for (const [kind, target] of Object.entries(mapping)) {
      expect(branches, `mapping ${kind}`).toContain(String(target));
      expect(() => resolve(CONVERSATION, { $ref: target }), `mapping ${kind}`).not.toThrow();
    }
  });

  it("closes every request body in both documents to additional properties", () => {
    for (const { spec, specName, path, method, operation } of operations()) {
      for (const schema of bodySchemas(spec, operation["requestBody"])) {
        const resolved = resolve(spec, schema) as Json;
        if (resolved["type"] !== "object") continue;
        expect(
          resolved["additionalProperties"],
          `${specName} ${method.toUpperCase()} ${path}`,
        ).toBe(false);
      }
    }
  });
});

describe("authentication is declared on every endpoint that needs it", () => {
  it("leaves exactly the intended operations unauthenticated, and no others", () => {
    const open: string[] = [];
    for (const { specName, path, method, operation } of operations()) {
      const security = operation["security"];
      if (Array.isArray(security) && security.length === 0) {
        open.push(`${specName} ${method.toUpperCase()} ${path}`);
      }
    }
    // Health reveals nothing. The control document reveals nothing until the
    // bootstrap establishes who is asking. The bootstrap exchange is the thing
    // that CREATES a session, so it cannot require one — it is protected by a
    // single-use token plus an Origin and Sec-Fetch-Site check instead.
    expect(open.sort()).toEqual([
      "conversation.v1.yaml GET /health",
      "secure.v1.yaml GET /control/{requestId}",
      "secure.v1.yaml POST /v1/frame-sessions",
    ]);
  });

  it("puts every internal operation behind mutual TLS, and nothing else there", () => {
    const internal = operations().filter(({ path }) => path.startsWith("/internal/"));
    expect(internal.length).toBeGreaterThan(0);
    for (const { path, operation } of internal) {
      expect(JSON.stringify(operation["security"]), path).toContain("serviceMutualTls");
    }
  });

  it("authenticates every STUDENT-facing conversation endpoint with a __Host- cookie", () => {
    // The first version of this asserted the conversation service had exactly
    // one security scheme, and broke the moment the internal append endpoint
    // arrived — correctly. What matters is not how many schemes exist but that
    // each surface uses the right one: a cookie for the student, mutual TLS
    // for a service, and never the reverse.
    const schemes = (CONVERSATION["components"] as Json)["securitySchemes"] as Json;
    const scheme = schemes["conversationSession"] as Json;
    expect(scheme["type"]).toBe("apiKey");
    expect(scheme["in"]).toBe("cookie");
    expect(scheme["name"]).toMatch(/^__Host-/);

    const OPEN = new Set(["/health"]);
    for (const { specName, path, method, operation } of operations()) {
      if (specName !== "conversation.v1.yaml") continue;
      if (OPEN.has(path)) continue;
      const declared = JSON.stringify(operation["security"] ?? "inherits the document default");
      if (path.startsWith("/internal/")) {
        expect(declared, `${method} ${path}`).toContain("serviceMutualTls");
        expect(declared, `${method} ${path}`).not.toContain("conversationSession");
      } else {
        // No per-operation override means it inherits the document-level
        // `security: [{ conversationSession: [] }]`.
        expect(declared, `${method} ${path}`).toBe('"inherits the document default"');
      }
    }
  });

  it("never lets a student-facing endpoint be reachable by a service certificate", () => {
    // The reverse of the rule above, asserted separately so it cannot be
    // satisfied by the same evidence: mutual TLS appears only under /internal/.
    for (const { specName, path, operation } of operations()) {
      if (path.startsWith("/internal/")) continue;
      expect(
        JSON.stringify(operation["security"] ?? null),
        `${specName} ${path}`,
      ).not.toContain("serviceMutualTls");
    }
  });

  it("gives the secure plane its OWN cookie, which cannot be the same one", () => {
    // ADR-0033: a __Host- cookie carries no Domain, so it cannot be shared
    // across origins. Two planes, two sessions — by mechanism, not by policy.
    const schemes = (SECURE["components"] as Json)["securitySchemes"] as Json;
    const scheme = schemes["secureSession"] as Json;
    expect(scheme["name"]).toMatch(/^__Host-/);
    const conversationCookie = (
      ((CONVERSATION["components"] as Json)["securitySchemes"] as Json)[
        "conversationSession"
      ] as Json
    )["name"];
    expect(scheme["name"]).not.toBe(conversationCookie);
  });
});

describe("no capability travels in a URL", () => {
  it("declares no path or query parameter that is a credential", () => {
    const CAPABILITY = /token|secret|password|key|credential|bearer|auth/i;
    for (const { spec, specName, path, method, operation } of operations()) {
      const pathItem = (spec["paths"] as Json)[path] as Json;
      const declared = [
        ...((pathItem["parameters"] ?? []) as unknown[]),
        ...((operation["parameters"] ?? []) as unknown[]),
      ];
      for (const raw of declared) {
        const parameter = resolve(spec, raw) as Json;
        const where = `${specName} ${method.toUpperCase()} ${path} (${String(parameter["name"])})`;
        if (parameter["in"] === "path" || parameter["in"] === "query") {
          expect(CAPABILITY.test(String(parameter["name"])), where).toBe(false);
        }
      }
    }
  });

  it("keeps the frame token out of every URL, and in a request body only", () => {
    const source = readFileSync(join(OPENAPI_DIR, "secure.v1.yaml"), "utf8");
    // It appears in the bootstrap body and in the internal response. It must
    // never appear in a server URL template or a path.
    for (const line of source.split("\n")) {
      if (line.includes("{frameToken}")) {
        expect.unreachable(`frameToken appears in a URL template: ${line}`);
      }
    }
    const bootstrap = (
      (SECURE["paths"] as Json)["/v1/frame-sessions"] as Json
    )["post"] as Json;
    const [schema] = bodySchemas(SECURE, bootstrap["requestBody"]);
    expect(propertyNames(SECURE, schema)).toContain("frameToken");
  });
});
