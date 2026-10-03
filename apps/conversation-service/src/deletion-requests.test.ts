import { describe, expect, it } from "vitest";

import { readUseRequest, readDeletionRequest, readStudentMessage } from "./deletion-requests.js";

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

  it("reads every DOCUMENT, said as documents, as every document held", () => {
    for (const said of ["delete all my documents", "remove all of my files", "please delete my documents", "wipe all my uploads"]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "all" });
    }
  });

  // P275, row 130. Until then these read as every document. Since the stop
  // message (D6) invites "your data deleted", "everything" may mean the
  // confirmed details too — and which is asked, never guessed.
  it("reads 'everything' and 'my data' as EVERYTHING — to be asked whether the details are meant too", () => {
    for (const said of [
      "get rid of everything you have on me",
      "Delete everything you hold for me",
      "erase everything",
      "wipe all my data",
      "please delete my data",
      "I want my personal data deleted",
      "I want you to delete what you've got on me",
      "delete everything, my CV too",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "everything" });
    }
  });

  it("reads the confirmed details, in a person's words, as the DETAILS — and with a document beside them, as everything", () => {
    for (const said of [
      "delete my details",
      "please remove the details I confirmed",
      "erase my answers",
      "I want my profile deleted",
      "remove what I told you",
      "delete the confirmed details",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "details" });
    }
    for (const said of ["delete my CV and my details", "remove my documents and my answers", "delete everything, my details too"]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "everything" });
    }
  });

  // Found in P275: the kind named used to win, so the one document the
  // student spared was the one deleted.
  it("reads an exception inside a request as UNCLEAR, never as the document it spares", () => {
    for (const said of ["delete everything except my passport", "remove all my documents apart from the CV", "delete my files other than my transcript", "erase it all but not my passport"]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "unclear" });
    }
  });

  it("reads a sentence that mentions deletion of something it cannot name as UNCLEAR — asked about, never guessed (row 98)", () => {
    // Vahid, 2026-09-27: *"A student says 'get rid of that file' and the
    // system silently treats it as an answer to whatever question was open.
    // Worst case it lands in a field."*
    for (const said of [
      "can you get rid of the thing from yesterday",
      "delete",
      "please delete the wrong one",
      "remove the old version",
      "I want a deletion",
      "erase what I gave you last week",
      "scrap the second thing",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "unclear" });
    }
  });

  it("reads a negated request, and a person saying what they did, as NOT a request — still never an answer", () => {
    for (const said of [
      "Don't delete my CV",
      "please do not remove my passport",
      "never delete anything",
      "I removed the typo from my statement",
      "I've deleted the old file on my side",
    ]) {
      expect(readDeletionRequest(said), said).toEqual({ scope: "not_a_request" });
    }
  });

  it("does NOT read an answer or a question about the process as anything to do with deletion", () => {
    for (const said of ["12 Valiasr Street", "yes", "My CV is attached", "How long do you keep my CV?", "can I upload my CV?", "Software engineer", ""]) {
      expect(readDeletionRequest(said), said).toBeNull();
    }
  });

  it("reads every message as EITHER about deletion OR an answer, never both and never neither", () => {
    expect(readStudentMessage("get rid of that file")).toEqual({ kind: "deletion", reading: { scope: "one" } });
    expect(readStudentMessage("get rid of that thing")).toEqual({ kind: "deletion", reading: { scope: "unclear" } });
    expect(readStudentMessage("Delete my CV")).toEqual({ kind: "deletion", reading: { scope: "type", documentType: "cv" } });
    expect(readStudentMessage("don't delete my CV")).toEqual({ kind: "deletion", reading: { scope: "not_a_request" } });
    expect(readStudentMessage("Software engineer")).toEqual({ kind: "answer", answer: "Software engineer" });
  });
});

describe("a request to USE the CV, or not to (P251, ADR-0151)", () => {
  it("reads 'use my CV' in a person's words as a yes, a negated one as a no, and anything else as not about that", () => {
    for (const yes of ["actually, use my CV", "Use my cv please", "fill it in from my résumé", "read my CV", "take them from the document", "go from what I uploaded"]) {
      expect(readUseRequest(yes), yes).toBe(true);
    }
    for (const no of ["don't use my CV", "do not read my cv", "I'd rather not use the document"]) {
      expect(readUseRequest(no), no).toBe(false);
    }
    for (const other of ["yes", "no", "Data analyst", "delete my CV", "I used to work at a bank", ""]) {
      expect(readUseRequest(other), other).toBeNull();
    }
  });
});
