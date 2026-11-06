-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('NOTE', 'QUESTION');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('RECEIPT', 'PHOTO', 'THUMBNAIL');

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "FileKind" NOT NULL DEFAULT 'RECEIPT';

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "kind" "CommentKind" NOT NULL DEFAULT 'NOTE',
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentAttachment" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "thumbFileId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CommentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCommentRead" (
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskCommentRead_pkey" PRIMARY KEY ("userId","taskId")
);

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_authorId_receivedAt_idx" ON "TaskComment"("authorId", "receivedAt");

-- CreateIndex
CREATE INDEX "TaskComment_orgId_kind_answeredAt_idx" ON "TaskComment"("orgId", "kind", "answeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommentAttachment_fileId_key" ON "CommentAttachment"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentAttachment_thumbFileId_key" ON "CommentAttachment"("thumbFileId");

-- CreateIndex
CREATE INDEX "CommentAttachment_commentId_idx" ON "CommentAttachment"("commentId");

-- CreateIndex
CREATE INDEX "TaskCommentRead_taskId_idx" ON "TaskCommentRead"("taskId");

-- CreateIndex
CREATE INDEX "FileObject_orgId_deletedAt_idx" ON "FileObject"("orgId", "deletedAt");

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentAttachment" ADD CONSTRAINT "CommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentAttachment" ADD CONSTRAINT "CommentAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentAttachment" ADD CONSTRAINT "CommentAttachment_thumbFileId_fkey" FOREIGN KEY ("thumbFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCommentRead" ADD CONSTRAINT "TaskCommentRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCommentRead" ADD CONSTRAINT "TaskCommentRead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep new tables closed to Supabase's Data API roles (see 20261106070000_supabase_lockdown).
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH t IN ARRAY ARRAY['TaskComment', 'CommentAttachment', 'TaskCommentRead'] LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END LOOP;
  END IF;
END
$$;
