import { Prisma, type FileKind, type ProjectStatus } from "@timepeace/db";
import { COMMENT_EDIT_WINDOW_MINUTES, COMMENT_RATE_LIMIT, type CommentPayload, type Role } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import type { AuthInfo } from "../context";
import { audit } from "../lib/audit";
import { db, type Tx } from "../lib/db";
import { storage } from "../lib/storage";
import { assertTaskAccess, isManager } from "./access";

/**
 * Task discussions: notes and questions with photos, from the crew and the office.
 * See docs/plans/task-discussions.md.
 *
 * - The crew and managers take part; HR and accountants have no access.
 * - Workers see threads on tasks assigned to them; managers and owners on every task.
 * - Threads are read-only once the project is complete or cancelled. Removing stays possible.
 * - A manager/owner note answers the task's open questions from others.
 */
export const DISCUSSION_ROLES: Role[] = ["OWNER", "MANAGER", "WORKER"];
const CLOSED: ProjectStatus[] = ["COMPLETE", "CANCELLED"];
const PAGE = 50;
const URL_TTL_SECONDS = 60 * 60;

export function canDiscuss(auth: AuthInfo) {
  return DISCUSSION_ROLES.includes(auth.role);
}

function assertDiscussionRole(auth: AuthInfo) {
  if (!canDiscuss(auth)) throw new TRPCError({ code: "FORBIDDEN", message: "Task discussions are for the crew and managers" });
}

/** The task, if the caller may read its discussion (and write to it, when `write`). */
async function discussionTask(tx: Tx, auth: AuthInfo, taskId: string, write: boolean) {
  assertDiscussionRole(auth);
  const task = await assertTaskAccess(auth, taskId, tx);
  const project = await tx.project.findUniqueOrThrow({ where: { id: task.projectId }, select: { status: true } });
  const open = !CLOSED.includes(project.status);
  if (write && !open) throw new TRPCError({ code: "CONFLICT", message: "This project is closed, so its discussion is read-only" });
  return { task, open };
}

async function loadComment(tx: Tx, auth: AuthInfo, commentId: string, write: boolean) {
  assertDiscussionRole(auth);
  const c = await tx.taskComment.findFirst({ where: { id: commentId, orgId: auth.orgId } });
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  await discussionTask(tx, auth, c.taskId, write); // NOT_FOUND for tasks the caller can't see
  return c;
}

/* ---------------------------------- Posting ---------------------------------- */

/**
 * Create a message. Shared by the web (`discussion.post`) and the phone (`comment.create` op), so
 * both paths apply the same rules. Idempotent on `commentId`.
 */
export async function postComment(tx: Tx, auth: AuthInfo, p: CommentPayload, writtenAt: Date): Promise<string> {
  const now = new Date();
  await discussionTask(tx, auth, p.taskId, true);

  const existing = await tx.taskComment.findUnique({ where: { id: p.commentId } });
  if (existing) {
    if (existing.authorId !== auth.userId || existing.taskId !== p.taskId) throw new TRPCError({ code: "CONFLICT", message: "Message id already used" });
    return existing.id; // a retry of the same post
  }

  const since = new Date(now.getTime() - COMMENT_RATE_LIMIT.windowMinutes * 60_000);
  if ((await tx.taskComment.count({ where: { authorId: auth.userId, receivedAt: { gt: since } } })) >= COMMENT_RATE_LIMIT.messages) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many messages in a few minutes. Wait a little, then post it again." });
  }
  await assertAttachable(tx, auth, p.attachments);

  await tx.taskComment.create({
    data: {
      id: p.commentId,
      orgId: auth.orgId,
      taskId: p.taskId,
      authorId: auth.userId,
      kind: p.kind,
      body: p.body,
      // Device clocks can run ahead; a message is never dated in the future.
      createdAt: writtenAt > now ? now : writtenAt,
      receivedAt: now,
      attachments: {
        create: p.attachments.map((a, i) => ({ id: a.id, fileId: a.fileId, thumbFileId: a.thumbFileId, width: a.width, height: a.height, position: i })),
      },
    },
  });

  // The office replying answers the crew's open questions on this task.
  if (isManager(auth) && p.kind === "NOTE") {
    await tx.taskComment.updateMany({
      where: { taskId: p.taskId, kind: "QUESTION", answeredAt: null, deletedAt: null, authorId: { not: auth.userId } },
      data: { answeredAt: now, answeredById: auth.userId },
    });
  }
  return p.commentId;
}

/** Photos must be the caller's own, unattached uploads of the right kind. */
async function assertAttachable(tx: Tx, auth: AuthInfo, atts: CommentPayload["attachments"]) {
  if (atts.length === 0) return;
  const fileIds = atts.flatMap((a) => [a.fileId, a.thumbFileId]);
  if (new Set(fileIds).size !== fileIds.length || new Set(atts.map((a) => a.id)).size !== atts.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Each photo can only be attached once" });
  }
  const files = await tx.fileObject.findMany({
    where: { id: { in: fileIds }, orgId: auth.orgId, uploadedById: auth.userId, deletedAt: null },
    select: { id: true, kind: true, attachment: { select: { id: true } }, attachmentThumb: { select: { id: true } } },
  });
  const byId = new Map(files.map((f) => [f.id, f]));
  for (const a of atts) {
    const photo = byId.get(a.fileId);
    const thumb = byId.get(a.thumbFileId);
    if (photo?.kind !== "PHOTO" || thumb?.kind !== "THUMBNAIL") throw new TRPCError({ code: "BAD_REQUEST", message: "Photo not found. Try adding it again." });
    if (photo.attachment || photo.attachmentThumb || thumb.attachment || thumb.attachmentThumb) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That photo is already attached to a message" });
    }
  }
  if (await tx.commentAttachment.findFirst({ where: { id: { in: atts.map((a) => a.id) } }, select: { id: true } })) {
    throw new TRPCError({ code: "CONFLICT", message: "Photo id already used" });
  }
}

/* --------------------------- Editing, answering, removing --------------------------- */

export async function editComment(auth: AuthInfo, commentId: string, body: string) {
  await db().$transaction(async (tx) => {
    const c = await loadComment(tx, auth, commentId, true);
    if (c.authorId !== auth.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit a message" });
    if (c.deletedAt) throw new TRPCError({ code: "CONFLICT", message: "That message was removed" });
    if (Date.now() - c.receivedAt.getTime() > COMMENT_EDIT_WINDOW_MINUTES * 60_000) {
      throw new TRPCError({ code: "CONFLICT", message: `Messages can only be edited for ${COMMENT_EDIT_WINDOW_MINUTES} minutes` });
    }
    if (!body && (await tx.commentAttachment.count({ where: { commentId } })) === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Write a message, or remove it instead" });
    }
    if (body === c.body) return;
    await tx.taskComment.update({ where: { id: commentId }, data: { body, editedAt: new Date() } });
    await audit(tx, { orgId: auth.orgId, actorId: auth.userId, entityType: "TaskComment", entityId: commentId, action: "edit", before: { body: c.body }, after: { body } });
  });
}

/** Managers mark answered or reopen; the asker can reopen ("Still need help"). */
export async function setAnswered(auth: AuthInfo, commentId: string, answered: boolean) {
  await db().$transaction(async (tx) => {
    const c = await loadComment(tx, auth, commentId, true);
    if (c.kind !== "QUESTION") throw new TRPCError({ code: "BAD_REQUEST", message: "Only questions can be answered" });
    if (c.deletedAt) throw new TRPCError({ code: "CONFLICT", message: "That message was removed" });
    if (answered) {
      if (!isManager(auth)) throw new TRPCError({ code: "FORBIDDEN", message: "Only managers can mark a question answered" });
      if (c.answeredAt) return;
      await tx.taskComment.update({ where: { id: commentId }, data: { answeredAt: new Date(), answeredById: auth.userId } });
    } else {
      if (!isManager(auth) && c.authorId !== auth.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the person who asked, or a manager, can reopen a question" });
      await tx.taskComment.update({ where: { id: commentId }, data: { answeredAt: null, answeredById: null } });
    }
  });
}

/** The author or a manager, at any time (also on closed projects). Audited; photos are purged from storage. */
export async function removeComment(auth: AuthInfo, commentId: string) {
  const keys = await db().$transaction(async (tx) => {
    const c = await loadComment(tx, auth, commentId, false);
    if (c.authorId !== auth.userId && !isManager(auth)) throw new TRPCError({ code: "FORBIDDEN", message: "You can only remove your own messages" });
    if (c.deletedAt) return [];
    const atts = await tx.commentAttachment.findMany({ where: { commentId }, include: { file: true, thumb: true } });
    const now = new Date();
    await tx.taskComment.update({ where: { id: commentId }, data: { deletedAt: now, deletedById: auth.userId, body: "" } });
    await tx.commentAttachment.deleteMany({ where: { commentId } });
    await tx.fileObject.updateMany({ where: { id: { in: atts.flatMap((a) => [a.fileId, a.thumbFileId]) } }, data: { deletedAt: now } });
    await audit(tx, {
      orgId: auth.orgId,
      actorId: auth.userId,
      entityType: "TaskComment",
      entityId: commentId,
      action: "remove",
      before: { kind: c.kind, body: c.body, authorId: c.authorId, photos: atts.length },
    });
    return atts.flatMap((a) => [a.file.storageKey, a.thumb.storageKey]);
  });
  await purge(keys);
}

/** One photo. A message left with no text and no photos is removed too. */
export async function removePhoto(auth: AuthInfo, attachmentId: string) {
  const keys = await db().$transaction(async (tx) => {
    const a = await tx.commentAttachment.findFirst({ where: { id: attachmentId, comment: { orgId: auth.orgId } }, include: { comment: true, file: true, thumb: true } });
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found" });
    await loadComment(tx, auth, a.commentId, false);
    if (a.comment.authorId !== auth.userId && !isManager(auth)) throw new TRPCError({ code: "FORBIDDEN", message: "You can only remove your own photos" });
    const now = new Date();
    await tx.commentAttachment.delete({ where: { id: a.id } });
    await tx.fileObject.updateMany({ where: { id: { in: [a.fileId, a.thumbFileId] } }, data: { deletedAt: now } });
    if (!a.comment.body && (await tx.commentAttachment.count({ where: { commentId: a.commentId } })) === 0) {
      await tx.taskComment.update({ where: { id: a.commentId }, data: { deletedAt: now, deletedById: auth.userId } });
    }
    await audit(tx, { orgId: auth.orgId, actorId: auth.userId, entityType: "TaskComment", entityId: a.commentId, action: "removePhoto", before: { attachmentId, authorId: a.comment.authorId } });
    return [a.file.storageKey, a.thumb.storageKey];
  });
  await purge(keys);
}

/** After the database commit: a failed purge leaves an orphaned object, never a broken message. */
async function purge(keys: string[]) {
  if (keys.length === 0) return;
  try {
    await storage.remove(keys);
  } catch (err) {
    console.error("Photo purge failed", { count: keys.length, err: err instanceof Error ? err.message : String(err) });
  }
}

/* ---------------------------------- Reading ---------------------------------- */

export async function markRead(auth: AuthInfo, taskId: string) {
  await discussionTask(db(), auth, taskId, false);
  const now = new Date();
  await db().taskCommentRead.upsert({
    where: { userId_taskId: { userId: auth.userId, taskId } },
    create: { userId: auth.userId, taskId, lastReadAt: now },
    update: { lastReadAt: now },
  });
}

export type TimelineItem =
  | {
      type: "comment";
      id: string;
      at: Date;
      kind: "NOTE" | "QUESTION";
      body: string;
      deleted: boolean;
      author: { id: string; name: string };
      editedAt: Date | null;
      answered: { at: Date; byName: string | null } | null;
      canEdit: boolean;
      canDelete: boolean;
      photos: { id: string; fileId: string; thumbFileId: string; width: number; height: number; thumbUrl: string | null }[];
    }
  | { type: "status"; id: string; at: Date; from: string; to: string; note: string | null; byName: string | null }
  | { type: "material"; id: string; at: Date; description: string; quantity: string | null; status: string; byName: string };

/**
 * A page of the task's timeline, oldest first: messages merged with status changes and material
 * requests from the same span. `before` is the oldest message id of the previous page.
 */
export async function listTimeline(auth: AuthInfo, taskId: string, before?: string | null) {
  const { open } = await discussionTask(db(), auth, taskId, false);
  const cursor = before ? await db().taskComment.findFirst({ where: { id: before, taskId }, select: { id: true, createdAt: true } }) : null;
  if (before && !cursor) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown page" });

  const rows = await db().taskComment.findMany({
    where: { taskId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    include: {
      author: { select: { id: true, name: true } },
      attachments: { orderBy: { position: "asc" }, include: { thumb: { select: { storageKey: true } } } },
    },
  });
  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  // Events in the same span: after the oldest message on this page (unless it's the first page of history).
  const span = { ...(hasMore ? { gte: page[page.length - 1]!.createdAt } : {}), ...(cursor ? { lt: cursor.createdAt } : {}) };

  const [events, materials, read] = await Promise.all([
    db().taskStatusEvent.findMany({ where: { taskId, at: span } }),
    db().materialRequest.findMany({ where: { taskId, createdAt: span }, include: { requestedBy: { select: { name: true } } } }),
    db().taskCommentRead.findUnique({ where: { userId_taskId: { userId: auth.userId, taskId } } }),
  ]);
  const names = await userNames([...page.map((c) => c.answeredById), ...events.map((e) => e.userId)]);

  const live = page.filter((c) => !c.deletedAt);
  const thumbKeys = live.flatMap((c) => c.attachments.map((a) => a.thumb.storageKey));
  const urls = storage.signedUrls ? await storage.signedUrls(thumbKeys, URL_TTL_SECONDS) : thumbKeys.map(() => null);
  const urlByKey = new Map(thumbKeys.map((k, i) => [k, urls[i] ?? null]));
  const editableSince = Date.now() - COMMENT_EDIT_WINDOW_MINUTES * 60_000;

  const items: TimelineItem[] = [
    ...page.map((c): TimelineItem => {
      const mine = c.authorId === auth.userId;
      const deleted = !!c.deletedAt;
      return {
        type: "comment",
        id: c.id,
        at: c.createdAt,
        kind: c.kind,
        body: deleted ? "" : c.body,
        deleted,
        author: c.author,
        editedAt: c.editedAt,
        answered: c.answeredAt ? { at: c.answeredAt, byName: c.answeredById ? (names.get(c.answeredById) ?? null) : null } : null,
        canEdit: open && mine && !deleted && c.receivedAt.getTime() >= editableSince,
        canDelete: !deleted && (mine || isManager(auth)),
        photos: deleted
          ? []
          : c.attachments.map((a) => ({ id: a.id, fileId: a.fileId, thumbFileId: a.thumbFileId, width: a.width, height: a.height, thumbUrl: urlByKey.get(a.thumb.storageKey) ?? null })),
      };
    }),
    ...events.map((e): TimelineItem => ({ type: "status", id: e.id, at: e.at, from: e.from, to: e.to, note: e.note, byName: e.userId ? (names.get(e.userId) ?? null) : null })),
    ...materials.map((m): TimelineItem => ({ type: "material", id: m.id, at: m.createdAt, description: m.description, quantity: m.quantity, status: m.status, byName: m.requestedBy.name })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : 1));

  return { items, nextBefore: hasMore ? page[page.length - 1]!.id : null, lastReadAt: read?.lastReadAt ?? null, canPost: open };
}

async function userNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, string>();
  const users = await db().user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/**
 * Per task the caller can see: messages from others since they last read it, open questions,
 * and their own questions answered since they last read it. Only tasks with something to show.
 */
export async function unreadCounts(auth: AuthInfo) {
  assertDiscussionRole(auth);
  const scope = isManager(auth)
    ? Prisma.empty
    : Prisma.sql`AND EXISTS (SELECT 1 FROM "TaskAssignment" a WHERE a."taskId" = c."taskId" AND a."userId" = ${auth.userId})`;
  // Column-to-column comparisons only: no database clock (timestamps are stored as UTC without a zone).
  const rows = await db().$queryRaw<{ taskId: string; unread: bigint; openQuestions: bigint; newlyAnswered: bigint }[]>`
    SELECT c."taskId",
      COUNT(*) FILTER (WHERE c."authorId" <> ${auth.userId} AND c."receivedAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)) AS "unread",
      COUNT(*) FILTER (WHERE c."kind" = 'QUESTION' AND c."answeredAt" IS NULL) AS "openQuestions",
      COUNT(*) FILTER (WHERE c."kind" = 'QUESTION' AND c."authorId" = ${auth.userId} AND c."answeredAt" > COALESCE(r."lastReadAt", 'epoch'::timestamp)) AS "newlyAnswered"
    FROM "TaskComment" c
    LEFT JOIN "TaskCommentRead" r ON r."taskId" = c."taskId" AND r."userId" = ${auth.userId}
    WHERE c."orgId" = ${auth.orgId} AND c."deletedAt" IS NULL ${scope}
    GROUP BY c."taskId"`;
  const out: Record<string, { unread: number; openQuestions: number; newlyAnswered: number }> = {};
  for (const r of rows) {
    const v = { unread: Number(r.unread), openQuestions: Number(r.openQuestions), newlyAnswered: Number(r.newlyAnswered) };
    if (v.unread || v.openQuestions || v.newlyAnswered) out[r.taskId] = v;
  }
  return out;
}

/** The office's queue: unanswered questions on open projects, oldest first. */
export async function openQuestions(auth: AuthInfo) {
  const rows = await db().taskComment.findMany({
    where: { orgId: auth.orgId, kind: "QUESTION", answeredAt: null, deletedAt: null, task: { project: { status: { notIn: CLOSED } } } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
      _count: { select: { attachments: true } },
    },
  });
  return rows.map((c) => ({ id: c.id, at: c.createdAt, body: c.body, photos: c._count.attachments, author: c.author, task: { id: c.task.id, title: c.task.title }, project: c.task.project }));
}

/* ---------------------------------- Photo access ---------------------------------- */

type FileRef = { id: string; kind: FileKind; uploadedById: string; deletedAt: Date | null };

/**
 * Which of these files the caller may download.
 * - Receipts: as before. Workers only their own; other roles across the org.
 * - Photos and thumbnails: the uploader, and anyone who can see the task the message is on.
 *   Never HR or accountants, and never once removed.
 */
export async function readableFiles(auth: AuthInfo, files: FileRef[]): Promise<Set<string>> {
  const ok = new Set<string>();
  const pending: FileRef[] = [];
  for (const f of files) {
    if (f.deletedAt) continue;
    if (f.kind === "RECEIPT") {
      if (auth.role !== "WORKER" || f.uploadedById === auth.userId) ok.add(f.id);
    } else if (canDiscuss(auth)) {
      if (f.uploadedById === auth.userId) ok.add(f.id);
      else pending.push(f);
    }
  }
  if (pending.length === 0) return ok;

  const ids = pending.map((f) => f.id);
  const atts = await db().commentAttachment.findMany({
    where: { OR: [{ fileId: { in: ids } }, { thumbFileId: { in: ids } }], comment: { orgId: auth.orgId, deletedAt: null } },
    select: { fileId: true, thumbFileId: true, comment: { select: { taskId: true } } },
  });
  let visibleTasks: Set<string> | null = null;
  if (!isManager(auth)) {
    const assigned = await db().taskAssignment.findMany({ where: { userId: auth.userId, taskId: { in: atts.map((a) => a.comment.taskId) } }, select: { taskId: true } });
    visibleTasks = new Set(assigned.map((a) => a.taskId));
  }
  for (const a of atts) {
    if (visibleTasks && !visibleTasks.has(a.comment.taskId)) continue;
    ok.add(a.fileId);
    ok.add(a.thumbFileId);
  }
  return new Set([...ok].filter((id) => files.some((f) => f.id === id)));
}

/** Short-lived download URLs for full-size photos (tap to view). `null` when the driver can't sign (local dev). */
export async function photoUrls(auth: AuthInfo, fileIds: string[]) {
  assertDiscussionRole(auth);
  const files = await db().fileObject.findMany({
    where: { id: { in: fileIds }, orgId: auth.orgId, kind: { in: ["PHOTO", "THUMBNAIL"] } },
    select: { id: true, kind: true, uploadedById: true, deletedAt: true, storageKey: true },
  });
  const allowed = await readableFiles(auth, files);
  const visible = files.filter((f) => allowed.has(f.id));
  const urls = storage.signedUrls ? await storage.signedUrls(visible.map((f) => f.storageKey), URL_TTL_SECONDS) : visible.map(() => null);
  return visible.map((f, i) => ({ fileId: f.id, url: urls[i] ?? null }));
}
