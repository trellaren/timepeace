import { existsSync } from "node:fs";
import path from "node:path";
import type { commentPayload } from "@timepeace/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { buildApp, sniffImage } from "../src/app";
import { env } from "../src/env";
import { db } from "../src/lib/db";
import { loginAs, uuid } from "./helpers";

type Session = Awaited<ReturnType<typeof loginAs>>;
type App = Awaited<ReturnType<typeof buildApp>>;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake jpeg body")]);

function multipart(filename: string, type: string, data: Buffer) {
  const boundary = `----tp${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

let app: App;
let jake: Session, manager: Session, outsider: Session, hr: Session, accountant: Session;
let taskId: string;

async function upload(who: Session, kind: string, data = JPEG, type = "image/jpeg") {
  const m = multipart("p.jpg", type, data);
  return app.inject({ method: "POST", url: `/files?kind=${kind}`, payload: m.payload, headers: { ...m.headers, authorization: `Bearer ${who.token}` } });
}

/** A photo + thumbnail pair uploaded by `who`, ready to attach. */
async function photo(who: Session) {
  const file = await upload(who, "photo");
  const thumb = await upload(who, "thumbnail");
  expect(file.statusCode).toBe(200);
  expect(thumb.statusCode).toBe(200);
  return { id: uuid(), fileId: file.json().id as string, thumbFileId: thumb.json().id as string, width: 1600, height: 1200 };
}

const getFile = (who: Session, id: string) => app.inject({ method: "GET", url: `/files/${id}`, headers: { authorization: `Bearer ${who.token}` } });
const commentOp = (payload: z.input<typeof commentPayload>, at = new Date()) => ({ opId: uuid(), type: "comment.create" as const, at: at.toISOString(), payload });

beforeAll(async () => {
  app = await buildApp();
  [jake, manager, hr, accountant] = await Promise.all([loginAs("jake@acme.test"), loginAs("manager@acme.test"), loginAs("hr@acme.test"), loginAs("accountant@acme.test")]);
  taskId = (await jake.caller.field.myDay()).tasks[0]!.id;
  // A field worker who isn't on Jake's task.
  const assigned = new Set((await db().taskAssignment.findMany({ where: { taskId } })).map((a) => a.userId));
  for (const email of ["tyler@acme.test", "dana@acme.test", "sam@acme.test", "luis@acme.test"]) {
    const s = await loginAs(email);
    if (!assigned.has(s.auth.userId)) {
      outsider = s;
      break;
    }
  }
  expect(outsider).toBeDefined();
});

afterAll(async () => {
  await app.close();
});

describe("who can take part", () => {
  it("assigned workers and managers; unassigned workers see nothing; HR and accountants are refused", async () => {
    await expect(jake.caller.discussion.list({ taskId })).resolves.toMatchObject({ canPost: true });
    await expect(manager.caller.discussion.list({ taskId })).resolves.toMatchObject({ canPost: true });
    await expect(outsider.caller.discussion.list({ taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(outsider.caller.discussion.post({ commentId: uuid(), taskId, body: "hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const s of [hr, accountant]) {
      await expect(s.caller.discussion.list({ taskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.discussion.unread()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await upload(s, "photo")).statusCode).toBe(403);
    }
    await expect(jake.caller.discussion.openQuestions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs text or a photo", async () => {
    await expect(jake.caller.discussion.post({ commentId: uuid(), taskId, body: "   " })).rejects.toThrow(/Write a message or add a photo/);
  });
});

describe("questions from the field", () => {
  it("a worker asks from the phone with photos; it waits in the office queue until a manager answers", async () => {
    const att = await photo(jake);
    const commentId = uuid();
    const op = commentOp({ commentId, taskId, kind: "QUESTION", body: "Joist is notched here, OK to sister it?", attachments: [att] });
    expect(await jake.caller.field.sync({ ops: [op] })).toEqual([{ opId: op.opId, status: "applied" }]);
    expect((await jake.caller.field.sync({ ops: [op] }))[0]!.status).toBe("duplicate");
    // The same message id from a new op (a re-queued post) is still one message.
    expect((await jake.caller.field.sync({ ops: [{ ...op, opId: uuid() }] }))[0]!.status).toBe("applied");
    expect(await db().taskComment.count({ where: { id: commentId } })).toBe(1);

    const queue = await manager.caller.discussion.openQuestions();
    expect(queue.find((q) => q.id === commentId)).toMatchObject({ photos: 1, author: { name: "Jake Turner" }, task: { id: taskId } });
    expect((await manager.caller.discussion.unread())[taskId]).toMatchObject({ openQuestions: 1 });
    expect((await manager.caller.discussion.unread())[taskId]!.unread).toBeGreaterThanOrEqual(1);

    // A worker's own follow-up doesn't answer it.
    await jake.caller.discussion.post({ commentId: uuid(), taskId, body: "It's the one by the stairs" });
    expect((await manager.caller.discussion.openQuestions()).some((q) => q.id === commentId)).toBe(true);

    // The office replying does.
    await manager.caller.discussion.post({ commentId: uuid(), taskId, body: "Yes, sister it with a 2x10." });
    expect((await manager.caller.discussion.openQuestions()).some((q) => q.id === commentId)).toBe(false);
    expect((await jake.caller.discussion.unread())[taskId]).toMatchObject({ newlyAnswered: 1 });

    const { items } = await jake.caller.discussion.list({ taskId });
    const q = items.find((i) => i.id === commentId)!;
    expect(q).toMatchObject({ type: "comment", kind: "QUESTION", answered: { byName: "Marco Reyes" }, canEdit: true, canDelete: true });
    expect(q.type === "comment" && q.photos).toEqual([expect.objectContaining({ fileId: att.fileId, thumbFileId: att.thumbFileId, width: 1600, height: 1200 })]);

    await jake.caller.discussion.markRead({ taskId });
    expect((await jake.caller.discussion.unread())[taskId]).toBeUndefined();

    // "Still need help": the asker reopens; only managers can close it again.
    await jake.caller.discussion.setAnswered({ commentId, answered: false });
    expect((await manager.caller.discussion.openQuestions()).some((x) => x.id === commentId)).toBe(true);
    await expect(jake.caller.discussion.setAnswered({ commentId, answered: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await manager.caller.discussion.setAnswered({ commentId, answered: true });
    expect((await manager.caller.discussion.openQuestions()).some((x) => x.id === commentId)).toBe(false);
  });

  it("shows status changes in the same timeline, and never dates a message in the future", async () => {
    // Other suites move this task with future-dated ops; status sync ignores updates older than the last one.
    await db().task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS", statusChangedAt: null } });
    const [status] = await jake.caller.field.sync({ ops: [{ opId: uuid(), type: "task.status", at: new Date().toISOString(), payload: { taskId, status: "BLOCKED", note: "Waiting on inspection" } }] });
    expect(status!.status).toBe("applied");
    const commentId = uuid();
    await jake.caller.field.sync({ ops: [commentOp({ commentId, taskId, body: "Inspector comes Thursday" }, new Date(Date.now() + 3_600_000))] });
    const c = await db().taskComment.findUniqueOrThrow({ where: { id: commentId } });
    expect(c.createdAt.getTime()).toBeLessThanOrEqual(Date.now());

    const { items } = await manager.caller.discussion.list({ taskId });
    expect(items.some((i) => i.type === "status" && i.to === "BLOCKED" && i.note === "Waiting on inspection" && i.byName === "Jake Turner")).toBe(true);
    const times = items.map((i) => i.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("photos", () => {
  it("only real JPEG/PNG/WebP images are accepted as photos", async () => {
    expect((await upload(jake, "photo", Buffer.from("<html>not an image</html>"))).statusCode).toBe(415);
    expect((await upload(jake, "photo", Buffer.from("%PDF-1.7"), "application/pdf")).statusCode).toBe(415);
    expect((await upload(jake, "selfie")).statusCode).toBe(400);
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
  });

  it("can't attach someone else's upload, a receipt, or the same photo twice", async () => {
    const theirs = await photo(manager);
    await expect(jake.caller.discussion.post({ commentId: uuid(), taskId, attachments: [theirs] })).rejects.toThrow(/Photo not found/);

    const receipt = await upload(jake, "receipt");
    const thumb = await upload(jake, "thumbnail");
    await expect(
      jake.caller.discussion.post({ commentId: uuid(), taskId, attachments: [{ id: uuid(), fileId: receipt.json().id, thumbFileId: thumb.json().id, width: 10, height: 10 }] }),
    ).rejects.toThrow(/Photo not found/);

    const mine = await photo(jake);
    await jake.caller.discussion.post({ commentId: uuid(), taskId, attachments: [mine] });
    await expect(jake.caller.discussion.post({ commentId: uuid(), taskId, attachments: [{ ...mine, id: uuid() }] })).rejects.toThrow(/already attached/);
  });

  it("are visible to people on the task, not to other workers, HR or accountants; removal purges them", async () => {
    const att = await photo(jake);
    const commentId = uuid();
    await jake.caller.discussion.post({ commentId, taskId, body: "Done, see photo", attachments: [att] });

    expect((await getFile(jake, att.fileId)).statusCode).toBe(200);
    const asManager = await getFile(manager, att.thumbFileId);
    expect(asManager.statusCode).toBe(200);
    expect(asManager.headers["x-content-type-options"]).toBe("nosniff");
    for (const s of [outsider, hr, accountant]) expect((await getFile(s, att.fileId)).statusCode).toBe(404);
    expect(await manager.caller.discussion.photoUrls({ fileIds: [att.fileId] })).toEqual([{ fileId: att.fileId, url: null }]); // local driver can't sign
    expect(await outsider.caller.discussion.photoUrls({ fileIds: [att.fileId] })).toEqual([]);

    const stored = await db().fileObject.findUniqueOrThrow({ where: { id: att.fileId } });
    expect(existsSync(path.join(env.uploadDir, stored.storageKey))).toBe(true);

    await jake.caller.discussion.removePhoto({ attachmentId: att.id });
    expect((await getFile(jake, att.fileId)).statusCode).toBe(404);
    expect(existsSync(path.join(env.uploadDir, stored.storageKey))).toBe(false);
    expect((await db().fileObject.findUniqueOrThrow({ where: { id: att.fileId } })).deletedAt).not.toBeNull();
    // The text stays.
    const { items } = await manager.caller.discussion.list({ taskId });
    expect(items.find((i) => i.id === commentId)).toMatchObject({ deleted: false, body: "Done, see photo", photos: [] });
  });
});

describe("editing and removing", () => {
  it("authors can edit for 15 minutes; edits are audited", async () => {
    const commentId = uuid();
    await jake.caller.discussion.post({ commentId, taskId, body: "Need 40 stds" });
    await expect(manager.caller.discussion.edit({ commentId, body: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await jake.caller.discussion.edit({ commentId, body: "Need 40 studs" });
    const log = await db().auditLog.findFirst({ where: { entityId: commentId, action: "edit" } });
    expect(log).toMatchObject({ before: { body: "Need 40 stds" }, after: { body: "Need 40 studs" } });

    await db().taskComment.update({ where: { id: commentId }, data: { receivedAt: new Date(Date.now() - 16 * 60_000) } });
    await expect(jake.caller.discussion.edit({ commentId, body: "later" })).rejects.toThrow(/15 minutes/);
  });

  it("the author or a manager can remove a message at any time; the text is kept only in the audit log", async () => {
    const att = await photo(jake);
    const commentId = uuid();
    await jake.caller.discussion.post({ commentId, taskId, kind: "QUESTION", body: "Wrong task, sorry", attachments: [att] });
    await db().taskComment.update({ where: { id: commentId }, data: { receivedAt: new Date(Date.now() - 24 * 3_600_000) } });

    await manager.caller.discussion.remove({ commentId });
    await manager.caller.discussion.remove({ commentId }); // idempotent
    const { items } = await jake.caller.discussion.list({ taskId });
    expect(items.find((i) => i.id === commentId)).toMatchObject({ deleted: true, body: "", photos: [], canDelete: false, canEdit: false });
    expect((await db().taskComment.findUniqueOrThrow({ where: { id: commentId } })).body).toBe("");
    expect(await db().auditLog.findFirst({ where: { entityId: commentId, action: "remove" } })).toMatchObject({ before: { body: "Wrong task, sorry", photos: 1 } });
    expect((await getFile(jake, att.thumbFileId)).statusCode).toBe(404);
    // A removed question leaves the queue.
    expect((await manager.caller.discussion.openQuestions()).some((q) => q.id === commentId)).toBe(false);
  });

  it("workers can't remove the office's messages", async () => {
    const commentId = uuid();
    await manager.caller.discussion.post({ commentId, taskId, body: "Use the 3-inch screws" });
    await expect(jake.caller.discussion.remove({ commentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("limits", () => {
  it("threads are read-only once the project is complete, including posts arriving from offline phones", async () => {
    const task = await db().task.findUniqueOrThrow({ where: { id: taskId }, include: { project: true } });
    await db().project.update({ where: { id: task.projectId }, data: { status: "COMPLETE" } });
    try {
      await expect(jake.caller.discussion.post({ commentId: uuid(), taskId, body: "late" })).rejects.toThrow(/read-only/);
      const res = await jake.caller.field.sync({ ops: [commentOp({ commentId: uuid(), taskId, body: "from the basement" })] });
      expect(res[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/read-only/) });
      await expect(jake.caller.discussion.list({ taskId })).resolves.toMatchObject({ canPost: false });
    } finally {
      await db().project.update({ where: { id: task.projectId }, data: { status: task.project.status } });
    }
  });

  it("caps messages per person: 60 in 10 minutes", async () => {
    const now = new Date();
    await db().taskComment.createMany({
      data: Array.from({ length: 60 }, () => ({ id: uuid(), orgId: outsider.auth.orgId, taskId, authorId: outsider.auth.userId, body: "spam", createdAt: now, receivedAt: now })),
    });
    try {
      // The outsider can't see Jake's task, so give them their own.
      const own = (await outsider.caller.field.myDay()).tasks[0]!;
      await expect(outsider.caller.discussion.post({ commentId: uuid(), taskId: own.id, body: "one more" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    } finally {
      await db().taskComment.deleteMany({ where: { authorId: outsider.auth.userId, body: "spam" } });
    }
  });
});
