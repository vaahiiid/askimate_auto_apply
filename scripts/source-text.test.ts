import { describe, expect, it } from "vitest";

import { codeOnly, withoutComments } from "./source-text.js";

// P276, row 131. Every case here is a character that used to shift the
// regular-expression stripping and erase the code after it — and each asserts
// both directions: the forbidden call after it is SEEN, and nothing inside a
// string, a comment or a regex is mistaken for code.
describe("what a source file says as code, read by the parser (row 131)", () => {
  const forbidden = 'if (step.kind === "fill") nextStep();';

  it("sees the code after a backtick inside a regex literal — the case P275 found", () => {
    const source = ['const a = text.replace(/[’‘`]/g, "x");', forbidden, "const b = `later ${value} template`;"].join("\n");
    const code = codeOnly(source);
    expect(code).toContain("step.kind ===");
    expect(code).toContain("nextStep(");
    expect(code, "code inside a template's ${} is code").toContain("value");
    expect(code).not.toContain("later");
  });

  it("sees the code after a lone double quote in a single-quoted string, and after '/*' and '//' inside strings", () => {
    for (const before of ["const q = 'say \"hi';", 'const glob = "apps/*";', 'const url = "https://example.test"; ' + forbidden]) {
      const source = `${before}\n${forbidden}\nconst end = "*/";`;
      expect(codeOnly(source), before).toContain("step.kind ===");
      expect(withoutComments(source), before).toContain("step.kind ===");
    }
  });

  it("does not take what is inside a comment, a JSDoc, a string or a regex for code", () => {
    const source = [
      "/** nextStep( is described here, not called */",
      "// step.kind === in a line comment",
      "/* tracing.start in a block comment */",
      'const s = "recordVideo";',
      "const t = `console.log(x)`;",
      "const r = /getSecret/;",
      "const keep = 1;",
    ].join("\n");
    const code = codeOnly(source);
    for (const hidden of ["nextStep(", "step.kind", "tracing.start", "recordVideo", "console.log", "getSecret"]) {
      expect(code, hidden).not.toContain(hidden);
    }
    expect(code).toContain("const keep = 1;");
  });

  it("keeps strings, and only strings, when asked for the source without comments", () => {
    const source = ['import { x } from "@askimate/aas-secrets"; // aas-account', "/* aas-llm */ const u = 'https://a.test';"].join("\n");
    const code = withoutComments(source);
    expect(code).toContain('"@askimate/aas-secrets"');
    expect(code).toContain("'https://a.test'");
    expect(code).not.toContain("aas-account");
    expect(code).not.toContain("aas-llm");
  });

  it("keeps the lines, so a line-anchored pattern still sees them", () => {
    const source = "const a = 1; /* one\ntwo\nthree */ const b = 2;\n// gone\nconst c = 3;";
    const code = codeOnly(source);
    expect(code.split("\n")).toHaveLength(source.split("\n").length);
    expect(code).toMatch(/^const c = 3;$/m);
  });
});
