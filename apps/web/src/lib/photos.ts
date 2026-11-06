"use client";

import { useEffect, useState } from "react";
import { getToken } from "./session";
import { API_URL } from "./trpc";

/**
 * Photos for task discussions are resized in the browser before upload: 1600 px on the long edge
 * plus a 320 px thumbnail, both JPEG. Re-encoding through a canvas also drops EXIF metadata,
 * including GPS. See docs/plans/task-discussions.md.
 */
const FULL = { edge: 1600, quality: 0.7 };
const THUMB = { edge: 320, quality: 0.6 };

export type PreparedPhoto = { full: Blob; thumb: Blob; width: number; height: number };

async function encode(bitmap: ImageBitmap, edge: number, quality: number) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process photos");
  ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't process that photo");
  return { blob, width, height };
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Couldn't read ${file.name}. Use a JPEG, PNG or WebP photo.`);
  }
  try {
    const full = await encode(bitmap, FULL.edge, FULL.quality);
    const thumb = await encode(bitmap, THUMB.edge, THUMB.quality);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    bitmap.close();
  }
}

export async function uploadFile(blob: Blob, kind: "photo" | "thumbnail"): Promise<string> {
  const form = new FormData();
  form.append("file", blob, kind === "photo" ? "photo.jpg" : "thumb.jpg");
  const res = await fetch(`${API_URL}/files?kind=${kind}`, { method: "POST", headers: { authorization: `Bearer ${getToken()}` }, body: form });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(msg ?? `Upload failed (${res.status})`);
  }
  return ((await res.json()) as { id: string }).id;
}

/**
 * A displayable URL for a stored photo. Hosted storage returns signed URLs that load directly;
 * with local storage (development) the file is fetched with the session token instead.
 */
export function usePhotoSrc(signedUrl: string | null | undefined, fileId: string, enabled = true) {
  const [src, setSrc] = useState<string | null>(signedUrl ?? null);
  useEffect(() => {
    if (signedUrl) {
      setSrc(signedUrl);
      return;
    }
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(`${API_URL}/files/${fileId}`, { headers: { authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b || cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [signedUrl, fileId, enabled]);
  return src;
}
