import { describe, expect, it } from "vitest";

import { readDeletionRequest } from "./deletion-requests.js";

describe("a student asking for a document to be deleted, the way a person says it (ADR-0148 §10)", () => {
  // Vahid, 2026-09-27: *"'Delete my CV', 'remove that document', 'get rid of
  // everything you have on me' should all land."*
  it("reads a named kind of document under many verbs", () => {
    for (const said of [
      "Delete my CV",
      "delete my cv please",
      "Please remove my CV.",
      "Can you erase my resume?",
      "get rid of my résumé",
      "I want my curriculum vitae deleted",
      "wipe the CV you have",
      "Don't keep my CV",
      "do not hold my cv any longer",
      "Could you take down my CV",
      "throw away my CV",
      "forget my CV",
      "DELETE MY CV!!",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "type", documentType: "cv" });
    }
    expect(readDeletionRequest("remove my passport")).toEqual({ scope: "type", documentType: "passport" });
    expect(readDeletionRequest("delete the transcript I uploaded")).toEqual({ scope: "type", documentType: "academic_transcript" });
    expect(readDeletionRequest("please delete my personal statement")).toEqual({ scope: "type", documentType: "personal_statement" });
  });

  it("reads 'that document' as the one held, to be asked about where more are", () => {
    for (const said of [
      "remove that document",
      "Delete the file I just uploaded",
      "please get rid of what I sent you",
      "erase the last one",
      "delete it",
      "remove my upload",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "one" });
    }
  });

  it("reads 'everything' as every document held", () => {
    for (const said of [
      "get rid of everything you have on me",
      "Delete everything you hold for me",
      "delete all my documents",
      "remove all of my files",
      "erase everything",
      "wipe all my data",
      "please delete my documents",
      "I want you to delete what you've got on me",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "all" });
    }
  });

  it("does NOT read an answer, a question about the process, or a negated request as one", () => {
    for (const said of [
      "12 Valiasr Street",
      "yes",
      "My CV is attached",
      "How long do you keep my CV?",
      "Don't delete my CV",
      "please do not remove my passport",
      "never delete anything",
      "I removed the typo from my statement",
      "can I upload my CV?",
      "",
    ]) {
      expect(readDeletionRequest(said), said).toBeNull();
    }
  });
});
