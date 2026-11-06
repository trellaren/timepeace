"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC, type RouterOutputs } from "@timepeace/api-client";
import { MAX_COMMENT_BODY, MAX_PHOTOS_PER_COMMENT, type CommentKind } from "@timepeace/shared";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/AppShell";
import { preparePhoto, uploadFile, usePhotoSrc } from "@/lib/photos";
import { can } from "@/lib/session";
import { Button, ErrorText, Loading, cx } from "./ui";

type Timeline = RouterOutputs["discussion"]["list"];
type Item = Timeline["items"][number];
type CommentItem = Extract<Item, { type: "comment" }>;
type Photo = CommentItem["photos"][number];

const STATUS_WORDS: Record<string, string> = {
  TODO: "to do",
  IN_PROGRESS: "in progress",
  NEEDS_MATERIALS: "needs materials",
  BLOCKED: "blocked",
  DONE: "done",
  VERIFIED: "verified",
};

const when = (d: Date) => d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The discussion for one task: notes and questions with photos, plus status changes and material requests. */
export function TaskDiscussion({ taskId }: { taskId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const list = useQuery({ ...trpc.discussion.list.queryOptions({ taskId }), refetchInterval: 30_000 });
  const [older, setOlder] = useState<{ items: Item[]; nextBefore: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const markRead = useMutation(trpc.discussion.markRead.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.discussion.unread.queryKey() }) }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.discussion.pathKey() });
  const bottom = useRef<HTMLDivElement>(null);

  // Viewing the thread marks it read.
  const { mutate: markReadMutate } = markRead;
  useEffect(() => {
    if (list.data) markReadMutate({ taskId });
  }, [list.dataUpdatedAt, list.data, taskId, markReadMutate]);

  const newest = list.data?.items.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [newest]);

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorText error={errorMessage(list.error)} />;
  const data = list.data!;
  const nextBefore = older ? older.nextBefore : data.nextBefore;
  const items = [...(older?.items ?? []), ...data.items];

  const loadOlder = async () => {
    if (!nextBefore) return;
    setLoadingOlder(true);
    try {
      const page = await qc.fetchQuery(trpc.discussion.list.queryOptions({ taskId, before: nextBefore }));
      setOlder((o) => ({ items: [...page.items, ...(o?.items ?? [])], nextBefore: page.nextBefore }));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <section aria-label="Discussion" className="flex flex-col gap-3">
      {nextBefore && (
        <button className="self-center text-xs text-accent-ink hover:underline" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? "Loading…" : "Show earlier messages"}
        </button>
      )}
      {items.length === 0 && <p className="py-4 text-center text-sm text-muted">No messages yet. Questions from the crew and replies from the office show up here.</p>}
      <ol className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={`${item.type}:${item.id}`}>{item.type === "comment" ? <Message item={item} onChanged={refresh} /> : <EventLine item={item} />}</li>
        ))}
      </ol>
      <div ref={bottom} />
      {data.canPost ? (
        <Composer taskId={taskId} onPosted={refresh} />
      ) : (
        <p className="rounded-md bg-surface-3 px-3 py-2 text-sm text-ink-2">This project is closed, so its discussion is read-only.</p>
      )}
    </section>
  );
}

function EventLine({ item }: { item: Exclude<Item, CommentItem> }) {
  const text =
    item.type === "status" ? (
      <>
        {item.byName ?? "Someone"} marked this <strong className="font-medium text-ink-2">{STATUS_WORDS[item.to] ?? item.to}</strong>
        {item.note ? `: ${item.note}` : ""}
      </>
    ) : (
      <>
        {item.byName} requested materials: {item.quantity ? `${item.quantity} × ` : ""}
        {item.description}
      </>
    );
  return (
    <p className="flex items-baseline gap-2 px-1 text-xs text-muted">
      <span aria-hidden>{item.type === "status" ? "↻" : "▤"}</span>
      <span>
        {text} · <time dateTime={item.at.toISOString()}>{when(item.at)}</time>
      </span>
    </p>
  );
}

function Message({ item, onChanged }: { item: CommentItem; onChanged: () => void }) {
  const trpc = useTRPC();
  const session = useSession();
  const isManager = can.manage(session?.role);
  const mine = item.author.id === session?.user.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const opts = { onSuccess: onChanged };
  const edit = useMutation(trpc.discussion.edit.mutationOptions({ onSuccess: () => (setEditing(false), onChanged()) }));
  const remove = useMutation(trpc.discussion.remove.mutationOptions(opts));
  const removePhoto = useMutation(trpc.discussion.removePhoto.mutationOptions(opts));
  const setAnswered = useMutation(trpc.discussion.setAnswered.mutationOptions(opts));
  const err = edit.error ?? remove.error ?? removePhoto.error ?? setAnswered.error;

  if (item.deleted) {
    return <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">Message removed · {item.author.name}</p>;
  }
  const question = item.kind === "QUESTION";
  return (
    <article
      aria-label={`${question ? "Question" : "Note"} from ${item.author.name}`}
      className={cx("rounded-lg border px-3 py-2", question && !item.answered ? "border-warning-line bg-warning-soft" : "border-line bg-surface", mine && "ml-6", !mine && "mr-6")}
    >
      <header className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-medium text-ink">{item.author.name}</span>
        <time className="text-muted" dateTime={item.at.toISOString()}>
          {when(item.at)}
        </time>
        {item.editedAt && <span className="text-faint">edited</span>}
        {question && <QuestionState item={item} />}
      </header>

      {editing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate({ commentId: item.id, body: draft });
          }}
        >
          <textarea className="w-full rounded-md border border-line-strong bg-surface p-2 text-sm text-ink" rows={3} maxLength={MAX_COMMENT_BODY} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" disabled={edit.isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => (setEditing(false), setDraft(item.body))}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        item.body && <p className="text-sm whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{linkify(item.body)}</p>
      )}

      {item.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {item.photos.map((p) => (
            <Thumb key={p.id} photo={p} onOpen={() => setViewing(p)} onRemove={item.canDelete ? () => confirm("Remove this photo?") && removePhoto.mutate({ attachmentId: p.id }) : undefined} />
          ))}
        </div>
      )}

      <ErrorText error={err ? errorMessage(err) : null} />

      <footer className="mt-1 flex flex-wrap gap-3 text-xs">
        {question && item.answered && mine && !isManager && (
          <button className="text-accent-ink hover:underline" onClick={() => setAnswered.mutate({ commentId: item.id, answered: false })}>
            Still need help
          </button>
        )}
        {question && isManager && (
          <button className="text-accent-ink hover:underline" onClick={() => setAnswered.mutate({ commentId: item.id, answered: !item.answered })}>
            {item.answered ? "Reopen" : "Mark answered"}
          </button>
        )}
        {item.canEdit && !editing && (
          <button className="text-muted hover:text-ink" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {item.canDelete && (
          <button className="text-muted hover:text-critical-ink" onClick={() => confirm(mine ? "Delete your message?" : `Remove ${item.author.name}'s message?`) && remove.mutate({ commentId: item.id })}>
            Delete
          </button>
        )}
      </footer>
      {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />}
    </article>
  );
}

function QuestionState({ item }: { item: CommentItem }) {
  return item.answered ? (
    <span className="inline-flex items-center gap-1 rounded bg-good-soft px-1.5 py-0.5 font-medium text-good-ink">
      <span aria-hidden>✓</span> Answered{item.answered.byName ? ` by ${item.answered.byName.split(" ")[0]}` : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-medium text-warning-ink">
      <span aria-hidden>?</span> Open question
    </span>
  );
}

function Thumb({ photo, onOpen, onRemove }: { photo: Photo; onOpen: () => void; onRemove?: () => void }) {
  const src = usePhotoSrc(photo.thumbUrl, photo.thumbFileId);
  return (
    <div className="group relative">
      <button onClick={onOpen} className="block overflow-hidden rounded-md border border-line bg-surface-3" aria-label="Open photo">
        {src ? <img src={src} alt="" className="h-24 w-24 object-cover" /> : <span className="block h-24 w-24" />}
      </button>
      {onRemove && (
        <button onClick={onRemove} aria-label="Remove photo" className="absolute -top-2 -right-2 hidden h-6 w-6 rounded-full border border-line bg-surface text-xs text-muted group-hover:block hover:text-critical-ink focus:block">
          ×
        </button>
      )}
    </div>
  );
}

function PhotoViewer({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const trpc = useTRPC();
  const urls = useQuery(trpc.discussion.photoUrls.queryOptions({ fileIds: [photo.fileId] }));
  const src = usePhotoSrc(urls.data?.[0]?.url, photo.fileId, urls.isSuccess);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal aria-label="Photo" className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgb(0 0 0 / 0.8)" }} onClick={onClose}>
      {src ? <img src={src} alt="" className="max-h-full max-w-full rounded-md" style={{ aspectRatio: `${photo.width} / ${photo.height}` }} /> : <Loading />}
      <button className="absolute top-4 right-4 rounded-full bg-surface px-3 py-1 text-sm text-ink" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Message text with web links made clickable. Everything else stays plain text. */
function linkify(text: string): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline">
        {p}
      </a>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

type Pending = { key: string; file: File; preview: string };

function Composer({ taskId, onPosted }: { taskId: string; onPosted: () => void }) {
  const trpc = useTRPC();
  const session = useSession();
  const isManager = can.manage(session?.role);
  const post = useMutation(trpc.discussion.post.mutationOptions());
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Kept across a failed send, so a retry neither re-uploads photos nor posts twice.
  const uploaded = useRef(new Map<string, { id: string; fileId: string; thumbFileId: string; width: number; height: number }>());
  const commentId = useRef<string | null>(null);

  // Release preview images when the composer goes away (removed photos are released as they go).
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const addFiles = (list: FileList | File[]) => {
    const images = [...list].filter((f) => f.type.startsWith("image/"));
    const room = MAX_PHOTOS_PER_COMMENT - photos.length;
    if (images.length > room) setError(`Up to ${MAX_PHOTOS_PER_COMMENT} photos per message`);
    setPhotos((p) => [...p, ...images.slice(0, Math.max(0, room)).map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))]);
  };

  const send = async (kind: CommentKind) => {
    if (!body.trim() && photos.length === 0) return;
    setError(null);
    commentId.current ??= crypto.randomUUID();
    try {
      const attachments = [];
      for (const [i, p] of photos.entries()) {
        let a = uploaded.current.get(p.key);
        if (!a) {
          setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
          const prepared = await preparePhoto(p.file);
          const [fileId, thumbFileId] = await Promise.all([uploadFile(prepared.full, "photo"), uploadFile(prepared.thumb, "thumbnail")]);
          a = { id: crypto.randomUUID(), fileId, thumbFileId, width: prepared.width, height: prepared.height };
          uploaded.current.set(p.key, a);
        }
        attachments.push(a);
      }
      setProgress("Posting…");
      await post.mutateAsync({ commentId: commentId.current, taskId, kind, body, attachments });
      setBody("");
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      uploaded.current.clear();
      commentId.current = null;
      onPosted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const primary: CommentKind = isManager ? "NOTE" : "QUESTION";
  const busy = progress !== null;
  const empty = !body.trim() && photos.length === 0;
  const label = (k: CommentKind) => (k === "QUESTION" ? (isManager ? "Ask a question" : "Ask the office") : isManager ? "Reply" : "Post note");

  return (
    <form
      aria-label="New message"
      className={cx("rounded-lg border bg-surface p-2", dragging ? "border-accent ring-2 ring-accent-ring" : "border-line-strong")}
      onSubmit={(e) => {
        e.preventDefault();
        void send(primary);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <textarea
        aria-label="Message"
        className="w-full resize-y bg-transparent p-1 text-sm text-ink outline-none"
        rows={3}
        maxLength={MAX_COMMENT_BODY}
        placeholder={isManager ? "Reply to the crew… (photos: drag, paste or Add photos)" : "Ask the office a question or leave a note…"}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => e.clipboardData.files.length && addFiles(e.clipboardData.files)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send(primary);
          }
        }}
      />
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2 p-1">
          {photos.map((p) => (
            <div key={p.key} className="relative">
              <img src={p.preview} alt="" className="h-16 w-16 rounded-md border border-line object-cover" />
              <button type="button" aria-label="Remove photo" className="absolute -top-2 -right-2 h-5 w-5 rounded-full border border-line bg-surface text-xs text-muted hover:text-critical-ink" onClick={() => (URL.revokeObjectURL(p.preview), setPhotos((all) => all.filter((x) => x !== p)))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <ErrorText error={error} />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ""))} />
        <Button type="button" variant="ghost" onClick={() => input.current?.click()} disabled={busy || photos.length >= MAX_PHOTOS_PER_COMMENT}>
          📷 Add photos
        </Button>
        {body.length > MAX_COMMENT_BODY - 500 && <span className="text-xs text-muted tabular">{body.length}/{MAX_COMMENT_BODY}</span>}
        <span className="ml-auto text-xs text-muted">{progress}</span>
        <Button type="button" variant="secondary" disabled={busy || empty} onClick={() => void send(primary === "NOTE" ? "QUESTION" : "NOTE")}>
          {label(primary === "NOTE" ? "QUESTION" : "NOTE")}
        </Button>
        <Button type="submit" disabled={busy || empty}>
          {label(primary)}
        </Button>
      </div>
    </form>
  );
}
