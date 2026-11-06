import { commentIdInput, commentPayload, discussionListInput, editCommentInput, photoUrlsInput, removePhotoInput, setAnsweredInput, taskIdInput } from "@timepeace/shared";
import { db } from "../lib/db";
import { editComment, listTimeline, markRead, openQuestions, photoUrls, postComment, removeComment, removePhoto, setAnswered, unreadCounts } from "../services/discussion";
import { authedProcedure, managerProcedure, router } from "../trpc";

/** Task discussions. Role and task access are enforced in services/discussion.ts. */
export const discussionRouter = router({
  list: authedProcedure.input(discussionListInput).query(({ ctx, input }) => listTimeline(ctx.auth, input.taskId, input.before)),

  /** Web posting. The phone sends the same payload as a `comment.create` op through field.sync. */
  post: authedProcedure.input(commentPayload).mutation(async ({ ctx, input }) => {
    const commentId = await db().$transaction((tx) => postComment(tx, ctx.auth, input, new Date()));
    return { commentId };
  }),

  edit: authedProcedure.input(editCommentInput).mutation(({ ctx, input }) => editComment(ctx.auth, input.commentId, input.body)),
  remove: authedProcedure.input(commentIdInput).mutation(({ ctx, input }) => removeComment(ctx.auth, input.commentId)),
  removePhoto: authedProcedure.input(removePhotoInput).mutation(({ ctx, input }) => removePhoto(ctx.auth, input.attachmentId)),
  setAnswered: authedProcedure.input(setAnsweredInput).mutation(({ ctx, input }) => setAnswered(ctx.auth, input.commentId, input.answered)),
  markRead: authedProcedure.input(taskIdInput).mutation(({ ctx, input }) => markRead(ctx.auth, input.taskId)),

  /** `{ [taskId]: { unread, openQuestions, newlyAnswered } }` for My Day and the task table. */
  unread: authedProcedure.query(({ ctx }) => unreadCounts(ctx.auth)),
  /** The office's queue of unanswered questions. */
  openQuestions: managerProcedure.query(({ ctx }) => openQuestions(ctx.auth)),
  /** Full-size photo URLs, after an access check. */
  photoUrls: authedProcedure.input(photoUrlsInput).query(({ ctx, input }) => photoUrls(ctx.auth, input.fileIds)),
});
