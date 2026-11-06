import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseStorage } from "../src/lib/storage";

const s = supabaseStorage({ url: "https://proj.supabase.co/", serviceRoleKey: "srk", bucket: "timepeace" });

afterEach(() => vi.unstubAllGlobals());

describe("supabase storage driver", () => {
  it("uploads to the private bucket with the service key and upsert", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await s.put("org1/2026-11/a b.png".replace(" ", "_"), Buffer.from("x"), "image/png");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/timepeace/org1/2026-11/a_b.png");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer srk", apikey: "srk", "Content-Type": "image/png", "x-upsert": "true" });
  });

  it("reads through the authenticated endpoint and surfaces errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bytes", { status: 200 })));
    expect((await s.read("org1/x.png")).toString()).toBe("bytes");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(s.read("org1/missing.png")).rejects.toThrow(/404/);
  });

  it("builds a signed download URL with the filename", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signedURL: "/object/sign/timepeace/org1/p.zip?token=abc" })));
    const url = new URL(await s.signedUrl!("org1/p.zip", 600, "Acme_2026.zip"));
    expect(url.origin + url.pathname).toBe("https://proj.supabase.co/storage/v1/object/sign/timepeace/org1/p.zip");
    expect(url.searchParams.get("token")).toBe("abc");
    expect(url.searchParams.get("download")).toBe("Acme_2026.zip");
  });

  it("signs many objects in one request, in the order asked", async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        { path: "org1/b.jpg", signedURL: "/object/sign/timepeace/org1/b.jpg?token=b", error: null },
        { path: "org1/a.jpg", signedURL: "/object/sign/timepeace/org1/a.jpg?token=a", error: null },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await s.signedUrls!(["org1/a.jpg", "org1/b.jpg"], 3600)).toEqual([
      "https://proj.supabase.co/storage/v1/object/sign/timepeace/org1/a.jpg?token=a",
      "https://proj.supabase.co/storage/v1/object/sign/timepeace/org1/b.jpg?token=b",
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/sign/timepeace");
    expect(JSON.parse(init.body as string)).toEqual({ expiresIn: 3600, paths: ["org1/a.jpg", "org1/b.jpg"] });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ path: "org1/a.jpg", signedURL: null, error: "Not found" }])));
    await expect(s.signedUrls!(["org1/a.jpg"], 60)).rejects.toThrow(/Not found/);
  });

  it("deletes many objects in one request", async () => {
    const fetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetch);
    await s.remove(["org1/a.jpg", "org1/a_t.jpg"]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/timepeace");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ prefixes: ["org1/a.jpg", "org1/a_t.jpg"] });
    await s.remove([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(s.remove(["../x"])).rejects.toThrow(/Invalid storage key/);
  });

  it("rejects path traversal and odd keys before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const key of ["../etc/passwd", "org1/../../x", "/abs", "a?b", ""]) await expect(s.read(key)).rejects.toThrow(/Invalid storage key/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
