import { describe, expect, it } from "vitest";
import { MAX_COMMENT_BODY, MAX_PHOTOS_PER_COMMENT, commentPayload, outboxOp } from "..";

const uuid = () => crypto.randomUUID();
const photo = () => ({ id: uuid(), fileId: "f1", thumbFileId: "t1", width: 1600, height: 1200 });

describe("discussion inputs", () => {
  it("defaults to a note, trims text, and needs text or a photo", () => {
    expect(commentPayload.parse({ commentId: uuid(), taskId: "t", body: "  hi  " })).toMatchObject({ kind: "NOTE", body: "hi", attachments: [] });
    expect(commentPayload.safeParse({ commentId: uuid(), taskId: "t", body: "   " }).success).toBe(false);
    expect(commentPayload.safeParse({ commentId: uuid(), taskId: "t", attachments: [photo()] }).success).toBe(true);
  });

  it(`limits text to ${MAX_COMMENT_BODY} characters and ${MAX_PHOTOS_PER_COMMENT} photos`, () => {
    expect(commentPayload.safeParse({ commentId: uuid(), taskId: "t", body: "x".repeat(MAX_COMMENT_BODY + 1) }).success).toBe(false);
    const many = Array.from({ length: MAX_PHOTOS_PER_COMMENT + 1 }, photo);
    expect(commentPayload.safeParse({ commentId: uuid(), taskId: "t", attachments: many }).success).toBe(false);
  });

  it("is a valid offline op from the phone", () => {
    const op = { opId: uuid(), type: "comment.create", at: new Date().toISOString(), payload: { commentId: uuid(), taskId: "t", kind: "QUESTION", body: "OK to sister?" } };
    expect(outboxOp.parse(op)).toMatchObject({ type: "comment.create", payload: { kind: "QUESTION" } });
    expect(outboxOp.safeParse({ ...op, payload: { ...op.payload, commentId: "not-a-uuid" } }).success).toBe(false);
  });
});
