# Plan: discussions on tasks (notes and photos)

Status: **approved; steps 1 (database and API) and 2 (web) built**. Written 2026-11-06; the owner's decisions are recorded in [Decisions](#decisions).

## Goal

Give every task a conversation thread where the crew and the office can post **notes** and **photos**. The main use is **the crew asking questions and the office answering them**, like a ticket and its responses:
- a worker asks a question about the task, with photos; it stays **Open** until the office answers
- a worker shows a problem or the finished work
- the task's history (status changes, blocked reasons, material requests) reads as one timeline

It has to work offline on the phone, like clocking in does, and stay inside the **free tiers** of Supabase and Vercel.

"Ticket" in this plan means a **task**, including punch-list tasks created from failed walkthrough items. Timepeace has no separate ticket object, and adding one would split the work in two. Material requests, walkthrough items and daily logs can get threads later through the same model (see [Later phases](#later-phases)).

## What people can do

| Who | Can |
|---|---|
| **Worker** on the task | Read the thread, ask questions and post notes and photos (also offline), see which questions were answered, see unread markers on My Day. Delete their own messages and photos. |
| **Manager / Owner** | Same, on every task in the org. Answer questions and see every open question in one list. Remove any message or photo (audited). |
| **HR, Accountant** | No access. Threads are field work, not payroll or finance (least privilege). |

Examples:
- *Worker, no signal in a basement:* asks "Joist is notched here, OK to sister it?" with 2 photos. The question shows "Waiting to send" and uploads when the phone reconnects. It then appears in the office's **Open questions** list.
- *Manager on the web:* replies "Yes, sister with a 2x10, I'll add it as a change order." The question becomes **Answered**, and the worker sees the answer, plus an "Answered" marker on My Day, next time the app syncs. If the answer doesn't settle it, the worker taps **Still need help** to reopen it.
- *Punch list:* the manager opens the punch task from a failed walkthrough item and posts the original photo; the worker posts the fix.
- *Blocked task:* the "Blocked: waiting on inspection" status change already has a note; it appears in the thread as an event, so nobody has to retype it.

## Scope

**Phase 1 (this plan):**
- notes and photos on tasks, web and mobile
- **questions with an Open / Answered state**, and an Open questions list for the office
- offline posting from the phone
- a timeline that merges status changes
- unread markers
- a storage meter that keeps photos within the free tier

**Not in phase 1** (see [Later phases](#later-phases)):
- @mentions and push notifications
- photos attached to status changes
- threads on other records
- video

## Screens

### Mobile: task screen

A **Discussion** section below the task actions:
- **Thread layout:** messages run oldest to newest, with the composer pinned to the bottom. Each message shows the author, time and text, plus a grid of up to 6 photo thumbnails. Tapping a thumbnail opens the photo full-screen with pinch-to-zoom.
- **Status changes** appear inline in small type, e.g. "Jake marked this Blocked: waiting on inspection · 9:14".
- **Composer:** a text field, a **Camera** button and a **Library** button. Selected photos show as removable chips before sending.
  - Two send buttons: **Ask the office** (a question) and **Post note**. For workers, Ask is the larger default; for managers, Post is.
- **Questions** show an **Open** or **Answered** badge.
  - The asker can tap **Still need help** on an answered question to reopen it.
- **Messages you haven't sent yet** show their state:
  - "Waiting to send": queued in the outbox.
  - "Not sent: *reason*": the server rejected it, for example because you were taken off the task. You can copy the text or delete it.
- **Deleting:** press and hold your own message to delete it, or one of its photos.
- **My Day** marks task cards:
  - a dot for unread messages
  - "✓ Answered" when one of your questions got an answer you haven't read yet

### Web: task panel

Today, tasks are only rows in the project's task table. Phase 1 adds:
- **Task side panel:** clicking a task opens a side panel with the task's details and the same Discussion thread. The panel has its own link, `/projects/[id]?task=[taskId]`, so a manager can send it to someone.
- **Composer:** a text box, an **Add photos** button, drag-and-drop and paste. Photos are resized in the browser before upload.
- **Task table:** a "💬 3" column with unread counts, and a "? 1" badge for open questions.
- **Dashboard:** an **Open questions** card, oldest first, showing the asker, task, project and how long each has waited. Each opens the task panel. This is the office's queue. Below it, a "Recent discussion" list shows the latest 10 messages.
- **Answering:** replying to an open question marks it Answered. A manager can also **Mark answered** without replying (e.g. sorted out by phone) or **Reopen**.

## Data model

New tables (Prisma sketch):

```prisma
model TaskComment {
  id          String    @id               // client-generated UUID, so offline posts are idempotent
  orgId       String
  taskId      String
  authorId    String
  body        String    @default("")      // plain text, ≤ 4,000 chars; may be empty if it has photos
  kind        CommentKind @default(NOTE)   // NOTE | QUESTION
  answeredAt  DateTime?                    // questions: set by the first manager/owner reply or "Mark answered"; cleared on reopen
  answeredById String?
  createdAt   DateTime                     // when it was written (device time for offline posts)
  receivedAt  DateTime  @default(now())    // when the server got it
  editedAt    DateTime?
  deletedAt   DateTime?                    // soft delete: the thread shows "Message removed"
  deletedById String?
  task        Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author      User      @relation(fields: [authorId], references: [id])
  attachments CommentAttachment[]

  @@index([taskId, createdAt])
  @@index([orgId, receivedAt])
  @@index([orgId, kind, answeredAt])        // the Open questions queue
}

model CommentAttachment {
  id          String  @id                  // client UUID
  commentId   String
  fileId      String  @unique              // full-size JPEG
  thumbFileId String  @unique              // 320 px thumbnail
  width       Int
  height      Int
  position    Int                          // order within the message
  comment     TaskComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  file        FileObject  @relation("AttachmentFile", fields: [fileId], references: [id])
  thumb       FileObject  @relation("AttachmentThumb", fields: [thumbFileId], references: [id])
}

/** One row per person per task: the newest message they've seen. Drives unread markers. */
model TaskCommentRead {
  userId     String
  taskId     String
  lastReadAt DateTime
  @@id([userId, taskId])
}
```

Changes to `FileObject`:
- `kind` (`RECEIPT | PHOTO | THUMBNAIL`)
- `deletedAt`, so removed photos stop counting against storage and can be purged

**Timeline:** the timeline is assembled when it's read. It merges `TaskComment` rows with the existing `TaskStatusEvent` rows (which already store blocked and needs-materials notes) and `MaterialRequest` rows, sorted by time. Nothing is copied, so there's one source of truth for each.

**Security:** the migration repeats the lockdown DO block from the earlier migrations: revoke `anon`/`authenticated` and enable RLS on all three tables.

## API

All new procedures are in a `discussion` router. Access goes through `assertTaskAccess`, plus a role check that rejects HR and Accountant.

| Procedure | What it does |
|---|---|
| `discussion.list({ taskId, cursor? })` | Timeline items, newest 50 first. Includes short-lived signed thumbnail URLs and the caller's `lastReadAt`. |
| `discussion.post({ id, taskId, kind, body, attachments })` | Web (online) posting. Idempotent on `id`. A manager/owner post on a task with open questions marks them answered. |
| `discussion.edit({ id, body })` | Author only, within 15 minutes of posting. Sets `editedAt`. |
| `discussion.remove({ id })` | The author or a manager, any time. Soft delete with an AuditLog entry. The thread shows "Message removed". Its photos are marked deleted and purged from storage. |
| `discussion.removePhoto({ attachmentId })` | Same rule as `remove`, for one photo. Purged from storage; audited. |
| `discussion.setAnswered({ id, answered })` | Managers: Mark answered / Reopen. The asker can reopen ("Still need help"). |
| `discussion.openQuestions()` | Managers: the org's open questions, oldest first, for the dashboard queue. |
| `discussion.markRead({ taskId, at })` | Upserts `TaskCommentRead`. |
| `discussion.unread()` | `{ taskId: { unread, openQuestions, newlyAnswered } }` for the caller's visible tasks (My Day markers, task table columns). |
| `discussion.photoUrls({ fileIds })` | Batch of signed full-size URLs, after an access check. `null` URLs with the local storage driver; clients then fetch `GET /files/:id` with their token. |

**Mobile:** a new field op, `comment.create`, joins the `fieldOp` union in `packages/shared/src/schemas.ts`. It is applied in `services/sync.ts` by the same service function as `discussion.post`, so the web and phone paths can't drift. `ProcessedOp` plus the client UUID primary key make retries harmless.

**Which tasks accept posts:** any task, including DONE and VERIFIED ones (useful for warranty and punch follow-up), until its project is marked **COMPLETE** (or **CANCELLED**). After that the thread is read-only; removing messages and photos still works, so storage can be freed. An offline post that arrives after completion is rejected with that reason, which the phone shows.

**Attachment rules** (enforced in the service):
- The `fileId` and `thumbFileId` must belong to the caller's org, have been uploaded by the caller, be of kind `PHOTO` / `THUMBNAIL`, and not already be attached elsewhere.
- At most 6 photos per message.

**File access** changes in `GET /files/:id` and `discussion.photoUrls`:
- Today, a worker can fetch only their own uploads.
- After this change, they can also fetch photos attached to a comment on a task they can access.
- Managers keep org-wide access.

## Offline posting (mobile)

This follows the receipt flow, which already uploads a photo before its op is sent. Two things need to change:

1. **More than one file per op.** The outbox has a single `local_receipt_uri` column.
   - Add a `local_files` JSON column (local DB migration v3): `[{ attachmentId, uri, thumbUri, fileId?, thumbFileId? }]`.
   - `flushOutbox` uploads each file that has no `fileId` yet and writes the new id back after each upload. If the connection drops after photo 2 of 4, the retry starts at photo 3.
   - The receipt path can move onto this later.
2. **Photos must survive until they upload.** The picker returns files in the cache folder, which iOS may clear. Copy them into the app's documents folder when the post is written; delete them after upload. **This is also a small existing risk for receipts today; fix it in the same change.**

Order is unchanged. Ops flush in sequence, so a reply written after a "Blocked" status change never arrives before it.

## Photos

| Step | Choice | Why |
|---|---|---|
| Capture | `expo-image-picker` (already installed) | Camera and library |
| Resize | `expo-image-manipulator` on the phone; `createImageBitmap` + canvas on the web | Longest edge 1600 px, JPEG quality 0.7, about 250–400 KB |
| Thumbnail | Made on the device: 320 px, quality 0.6, about 20–30 KB | No server image processing (Supabase free has no image transforms) |
| Metadata | Re-encoding strips EXIF, including GPS | Workers' locations aren't published by accident |
| Upload | Existing `POST /files` with `kind=photo`, under the 4 MB Vercel limit | One proven upload path |
| Check | Server checks JPEG/PNG/WebP magic bytes, not just the declared type | Rejects disguised files; no SVG or HEIC |
| Viewing | Thumbnails in threads; full size only on tap; device disk cache | Keeps downloads well under 5 GB/month |

`expo-image-manipulator` (and `expo-file-system`, if not already present) are native modules. The phone needs a **new development build** before this ships, the same as for this change's `expo-system-ui`.

## Staying on the free tier

Supabase free includes 500 MB of database, **1 GB of file storage** and **5 GB of egress** a month (2026-11-06 pricing). Vercel usage goes against the Pro plan's included credit.

| Resource | Use per photo | Budget |
|---|---|---|
| Storage | ~350 KB (photo + thumbnail) | **~2,800 photos per GB**, shared with receipts. At 10 photos a day, that's roughly 9 months. |
| Egress | 25 KB per thumbnail view, ~300 KB per full view | 200 thumbnail views and 50 full views a day is about 0.6 GB/month |
| Database | ~1 KB per message | Not a constraint (hundreds of thousands of messages) |

Guards, in phase 1:
- **Storage meter** on the Team page for owners, computed from `FileObject.sizeBytes` where not deleted.
- At **80%** of 1 GB: a warning banner for owners and managers.
- At **95%**: new photo uploads are refused with a clear message. Text notes still work. Receipts are always allowed, since they're needed for pay and tax.
- Deleting a message or a photo purges it from storage, so deletion also frees space.

A later "archive photos for completed projects" export (ZIP, then delete) can free space without a paid plan.

## Security and privacy

- Message text is plain text, rendered as text. React escapes it. URLs are auto-linked with `rel="noopener noreferrer nofollow"`.
- **Rate limit:** 60 messages per 10 minutes per user, counted from the messages themselves (no extra table). Photos are capped at 6 per message. From a phone, a message over the limit is rejected with its reason (shown on the phone with the text to copy) rather than holding up clock-outs queued behind it.
- **Photo uploads** (`POST /files?kind=photo|thumbnail`) accept only JPEG, PNG and WebP, checked by their bytes, not the declared type. HR and accountants can't upload photos. Downloads send `X-Content-Type-Options: nosniff`.
- Deactivating a worker revokes their sessions (already built). Their past messages stay, with their name.
- Edits and removals are written to the AuditLog: who, when, and the before text. The photo itself is deleted (authors and managers can delete photos), but the log records that one was removed.
- New tables are locked down from Supabase's public APIs (RLS on, anon/authenticated revoked).

## Tests

- **API (Vitest + Postgres):**
  - The access matrix: assigned worker yes; unassigned worker, HR and Accountant no; manager yes.
  - Idempotent create via both `discussion.post` and `comment.create`.
  - Attachment theft is rejected: another user's file, another org's file, a file attached twice.
  - The edit window; author and manager deletes (and a worker can't delete someone else's); removed messages hide their photos; signed URL access.
  - Questions: a manager reply marks them answered, a worker reply doesn't; Mark answered / Reopen; Still need help; the open-questions queue.
  - Posting to a task in a COMPLETE project is rejected, including via an offline op.
  - The storage guard at 95%.
- **Shared:** schema limits (body length, 6 photos).
- **Mobile outbox:**
  - A multi-photo post resumes after a failure partway through without re-uploading.
  - A rejected comment stays visible with its reason.
- **E2E (Playwright):**
  - A worker's question (seeded through the field op) appears in the dashboard's Open questions; the manager replies with a photo and it moves to Answered.
  - The unread count clears after opening the panel.
  - An accountant sees no Discussion.

## Build order

Each step is one PR.

| # | Step | Size |
|---|---|---|
| 1 | Schema, migration, `discussion` service and router, file access changes, API tests | M |
| 2 | Web task panel, composer with browser resize, timeline, Open questions dashboard, unread/question columns, e2e | M |
| 3 | Mobile: outbox v3 (`local_files`), `comment.create`, photo capture/compress/copy, task screen thread with Ask / Post, My Day markers, new dev build | L |
| 4 | Storage meter, 80% and 95% guards, photo purge on delete | S |

The migration in step 1 must be applied to Supabase before step 1 merges (see [deployment](../deployment.md)).

## Later phases

- **Push notifications:** Expo push (free) with a device-token table. Most valuable first: "Your question was answered" for workers and "New question" for managers. Then @mentions.
- **Manager-only notes:** not planned. Threads are for the crew and the office together; add a `visibility` field later only if a real need appears.
- **Photos on status changes:** "Mark done" and "Blocked" offer an optional photo, posted to the thread.
- **Threads on other records:** material requests, walkthrough items and daily logs. Change `taskId` to a `subjectType` + `subjectId` pair.
- **Photo archive:** export a completed project's photos as a ZIP, then delete them to free storage.

## Decisions

Confirmed by the owner on 2026-11-06:

1. **What it's for:** mainly the crew asking questions and the office responding, like a ticket. So questions get an Open / Answered state and an office queue in phase 1. Manager-only notes aren't needed.
2. **Deleting photos:** allowed. Authors can delete their own messages and photos, and managers can delete any, at any time. Each deletion is audited and frees storage.
3. **Finished tasks:** threads stay open on DONE and VERIFIED tasks until the project is marked complete, then become read-only.
4. **HR and Accountant:** no access; not needed.
