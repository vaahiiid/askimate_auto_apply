/**
 * What a source file says as CODE, read by the TypeScript parser (P276, row 131).
 *
 * The repository's source checks used to strip comments and strings with
 * regular expressions, and a regular expression cannot tell a backtick inside
 * a regex literal from the start of a template, or a `/*` inside a string from
 * the start of a comment. One stray character shifted the pairing and erased
 * code up to the next match — found in P275, when a backtick in a new regex
 * made the boundary check report that the Run Driver no longer calls
 * `nextStep`. The same erasure hides a forbidden call as readily, and then the
 * check passes. Vahid: *"A check that can pass while hiding a forbidden call is
 * worse than no check."*
 *
 * So the parser decides what is a comment, a string, a template's text and a
 * regex — the same parser that compiles the file. Comments and JSDoc are never
 * emitted; newlines in them are kept, so a line-anchored pattern still sees
 * lines. Code inside a template's `${…}` is code, and is kept.
 */

import ts from "typescript";

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".js") || fileName.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
}

function isJsDoc(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** Every token of the file in order — never a comment, never JSDoc. */
function tokensOf(file: ts.SourceFile): ts.Node[] {
  const tokens: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (isJsDoc(node)) return;
    const children = node.getChildren(file);
    if (children.length === 0) {
      tokens.push(node);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(file);
  return tokens;
}

/** What lies between two tokens — whitespace and comments — as its newlines and one space. */
function gap(text: string): string {
  const newlines = text.replace(/[^\n]/g, "");
  return newlines.length > 0 ? newlines : text.length > 0 ? " " : "";
}

function render(source: string, fileName: string, literal: (token: ts.Node, text: string) => string): string {
  const file = parse(source, fileName);
  let out = "";
  let at = 0;
  for (const token of tokensOf(file)) {
    const start = token.getStart(file);
    out += gap(source.slice(at, start));
    out += literal(token, source.slice(start, token.end));
    at = token.end;
  }
  return out + gap(source.slice(at));
}

/** The source with every comment removed and every string kept: for checks that read import paths and string arguments. */
export function withoutComments(source: string, fileName = "source.ts"): string {
  return render(source, fileName, (_token, text) => text);
}

/** What a literal's text becomes when only code is wanted. Anything not named here is code, kept. */
const EMPTIED: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.StringLiteral, '""'],
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral, "``"],
  [ts.SyntaxKind.TemplateHead, "`${"],
  [ts.SyntaxKind.TemplateMiddle, "}${"],
  [ts.SyntaxKind.TemplateTail, "}`"],
  [ts.SyntaxKind.RegularExpressionLiteral, "/(?:)/"],
  [ts.SyntaxKind.JsxText, " "],
]);

/**
 * The source as code alone: comments removed, and every string, template text
 * and regex literal emptied — `""`, `` `` ``, `/(?:)/` — so the prose and the
 * patterns that explain a rule cannot trip it, and nothing inside them can
 * hide the code after them.
 */
export function codeOnly(source: string, fileName = "source.ts"): string {
  return render(source, fileName, (token, text) => EMPTIED.get(token.kind) ?? text);
}
