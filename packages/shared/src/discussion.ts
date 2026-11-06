import { z } from "zod";

/** Task discussions: notes and questions with photos. See docs/plans/task-discussions.md. */

export const MAX_COMMENT_BODY = 4000;
export const MAX_PHOTOS_PER_COMMENT = 6;
/** Authors can fix a typo for this long after the server receives a message. */
export const COMMENT_EDIT_WINDOW_MINUTES = 15;
/** Per person, across web and phone. */
export const COMMENT_RATE_LIMIT = { messages: 60, windowMinutes: 10 } as const;

export const COMMENT_KINDS = ["NOTE", "QUESTION"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

const id = z.string().min(1);

export const commentAttachmentInput = z.object({
  id: z.uuid(),
  fileId: id,
  thumbFileId: id,
  width: z.int().min(1).max(20_000),
  height: z.int().min(1).max(20_000),
});

/** A new message. Used by the web (`discussion.post`) and the phone (`comment.create` op). */
export const commentPayload = z
  .object({
    commentId: z.uuid(),
    taskId: id,
    kind: z.enum(COMMENT_KINDS).default("NOTE"),
    body: z.string().trim().max(MAX_COMMENT_BODY).default(""),
    attachments: z.array(commentAttachmentInput).max(MAX_PHOTOS_PER_COMMENT).default([]),
  })
  .refine((c) => c.body.length > 0 || c.attachments.length > 0, { message: "Write a message or add a photo", path: ["body"] });
export type CommentPayload = z.infer<typeof commentPayload>;

export const editCommentInput = z.object({ commentId: id, body: z.string().trim().max(MAX_COMMENT_BODY) });
export const commentIdInput = z.object({ commentId: id });
export const removePhotoInput = z.object({ attachmentId: id });
export const setAnsweredInput = z.object({ commentId: id, answered: z.boolean() });
export const discussionListInput = z.object({ taskId: id, before: id.nullish() });
export const taskIdInput = z.object({ taskId: id });
export const photoUrlsInput = z.object({ fileIds: z.array(id).min(1).max(100) });
