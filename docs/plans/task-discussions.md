# Plan: discussions on tasks (notes and photos)

Status: **proposed**, not built. Written 2026-11-06.

## Goal

Give every task a conversation thread where the crew and the office can post **notes** and **photos**:
- a worker shows a problem or the finished work
- a manager answers a question
- the task's history (status changes, blocked reasons, material requests) reads as one timeline

It has to work offline on the phone, like clocking in does, and stay inside the **free tiers** of Supabase and Vercel.

"Ticket" in this plan means a **task**, including punch-list tasks created from failed walkthrough items. Timepeace has no separate ticket object, and adding one would split the work in two. Material requests, walkthrough items and daily logs can get threads later through the same model (see [Later phases](#later-phases)).

## What people can do

| Who | Can |
|---|---|
| **Worker** on the task | Read the thread, post notes and photos (also offline), see who replied, see unread markers on My Day |
| **Manager / Owner** | Same, on every task in the org. Remove any message (audited). |
| **HR, Accountant** | No access. Threads are field work, not payroll or finance (least privilege). |

Examples:
- *Worker, no signal in a basement:* "Joist is notched here, OK to sister it?" plus 2 photos. The post shows "Waiting to send" and uploads when the phone reconnects.
- *Manager on the web:* replies "Yes, sister with a 2x10, I'll add it as a change order." The worker sees it next time the app syncs.
- *Punch list:* the manager opens the punch task from a failed walkthrough item and posts the original photo; the worker posts the fix.
- *Blocked task:* the "Blocked: waiting on inspection" status change already has a note; it appears in the thread as an event, so nobody has to retype it.

## Scope

**Phase 1 (this plan):**
- notes and photos on tasks, web and mobile
- offline posting from the phone
- a timeline that merges status changes
- unread markers
- a storage meter that keeps photos within the free tier

**Not in phase 1** (see [Later phases](#later-phases)):
- manager-only internal notes
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
- **Messages you haven't sent yet** show their state:
  - "Waiting to send": queued in the outbox.
  - "Not sent: *reason*": the server rejected it, for example because you were taken off the task. You can copy the text or delete it.
- **My Day** shows a dot on task cards that have unread messages.

### Web: task panel

Today, tasks are only rows in the project's task table. Phase 1 adds:
- **Task side panel:** clicking a task opens a side panel with the task's details and the same Discussion thread. The panel has its own link, `/projects/[id]?task=[taskId]`, so a manager can send it to someone.
- **Composer:** a text box, an **Add photos** button, drag-and-drop and paste. Photos are resized in the browser before upload.
- **Task table:** a "💬 3" column with unread counts.
- **Dashboard:** a "Recent discussion" card showing the latest 10 messages across projects the user can see.

## Data model

New tables (Prisma sketch):

```prisma
model TaskComment {
  id          String    @id               // client-generated UUID, so offline posts are idempotent
  orgId       String
  taskId      String
  authorId    String
  body        String    @default("")      // plain text, ≤ 4,000 chars; may be empty if it has photos
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
| `discussion.post({ id, taskId, body, attachments })` | Web (online) posting. Idempotent on `id`. |
| `discussion.edit({ id, body })` | Author only, within 15 minutes of posting. Sets `editedAt`. |
| `discussion.remove({ id })` | Author within 15 minutes; managers any time. Soft delete with an AuditLog entry. Its photos are marked deleted and purged from storage. |
| `discussion.markRead({ taskId, at })` | Upserts `TaskCommentRead`. |
| `discussion.unread()` | `{ taskId: count }` for the caller's visible tasks (My Day dots, task table column). |
| `files.photoUrls({ fileIds })` | Batch of signed full-size URLs, after an access check. |

**Mobile:** a new field op, `comment.create`, joins the `fieldOp` union in `packages/shared/src/schemas.ts`. It is applied in `services/sync.ts` by the same service function as `discussion.post`, so the web and phone paths can't drift. `ProcessedOp` plus the client UUID primary key make retries harmless.

**Attachment rules** (enforced in the service):
- The `fileId` and `thumbFileId` must belong to the caller's org, have been uploaded by the caller, be of kind `PHOTO` / `THUMBNAIL`, and not already be attached elsewhere.
- At most 6 photos per message.

**File access** changes in `GET /files/:id` and `files.photoUrls`:
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
- Deleting a message purges its photos from storage.

A later "archive photos for completed projects" export (ZIP, then delete) can free space without a paid plan.

## Security and privacy

- Message text is plain text, rendered as text. React escapes it. URLs are auto-linked with `rel="noopener noreferrer nofollow"`.
- **Rate limit:** 60 messages per 10 minutes per user, stored in Postgres like the sign-in limits. Photo uploads are capped at 6 per message.
- Deactivating a worker revokes their sessions (already built). Their past messages stay, with their name.
- Edits and removals are written to the AuditLog with before and after text. Photos used as proof of work can't vanish without a trace.
- New tables are locked down from Supabase's public APIs (RLS on, anon/authenticated revoked).

## Tests

- **API (Vitest + Postgres):**
  - The access matrix: assigned worker yes; unassigned worker, HR and Accountant no; manager yes.
  - Idempotent create via both `discussion.post` and `comment.create`.
  - Attachment theft is rejected: another user's file, another org's file, a file attached twice.
  - Edit and delete windows; removed messages hide their photos; signed URL access.
  - The storage guard at 95%.
- **Shared:** schema limits (body length, 6 photos).
- **Mobile outbox:**
  - A multi-photo post resumes after a failure partway through without re-uploading.
  - A rejected comment stays visible with its reason.
- **E2E (Playwright):**
  - A manager posts a note with a photo on the web; a reply seeded from the field op appears.
  - The unread count clears after opening the panel.
  - An accountant sees no Discussion.

## Build order

Each step is one PR.

| # | Step | Size |
|---|---|---|
| 1 | Schema, migration, `discussion` service and router, file access changes, API tests | M |
| 2 | Web task panel, composer with browser resize, timeline, unread column, e2e | M |
| 3 | Mobile: outbox v3 (`local_files`), `comment.create`, photo capture/compress/copy, task screen thread, My Day dots, new dev build | L |
| 4 | Storage meter, 80% and 95% guards, photo purge on delete | S |

The migration in step 1 must be applied to Supabase before step 1 merges (see [deployment](../deployment.md)).

## Later phases

- **Manager-only notes:** a `visibility` field (`TEAM | MANAGERS`) and a toggle in the composer.
- **@mentions and push notifications:** Expo push (free) with a device-token table; mentions notify the person, replies notify everyone on the task.
- **Photos on status changes:** "Mark done" and "Blocked" offer an optional photo, posted to the thread.
- **Threads on other records:** material requests, walkthrough items and daily logs. Change `taskId` to a `subjectType` + `subjectId` pair.
- **Photo archive:** export a completed project's photos as a ZIP, then delete them to free storage.

## Decisions to confirm

1. **Manager-only notes:** phase 2, as above, or needed in phase 1?
2. **Deleting photos:** authors can delete within 15 minutes and managers any time, with an audit entry. Or should photos be permanent once posted, as proof of work?
3. **Finished tasks:** keep threads open on DONE and VERIFIED tasks (useful for warranty and punch follow-up) until the project is marked complete?
4. **HR and Accountant:** no access, as proposed?
