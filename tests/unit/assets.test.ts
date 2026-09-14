import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "../../src/assets/AssetLibrary";
import { indexKey, loadManifest, mergeParts, parseFileIndex, type ManifestPart } from "../../src/assets/manifest";

const part = {
  assets: [
    { id: "data.a", type: "json", src: "data/a.json" },
    { id: "data.b", type: "json", src: "./data/b.json" },
  ],
} as ManifestPart;

function manifest(files: string[] | null) {
  const m = mergeParts(1, "assets/", [{ name: "p", data: part }]);
  m.files = files && new Set(files);
  return m;
}

/** fetch stub serving `served` (url → body); `html` urls answer like an SPA fallback. */
function stubFetch(served: Record<string, unknown>, html: string[] = []) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (html.includes(url)) return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      if (url in served) return new Response(JSON.stringify(served[url]), { headers: { "content-type": "application/json" } });
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("asset file index", () => {
  it("normalises and parses index payloads", () => {
    expect(indexKey("./ui/icons/coin.svg")).toBe("ui/icons/coin.svg");
    expect(indexKey("textures\\a.png")).toBe("textures/a.png");
    expect([...parseFileIndex({ files: ["a.png", "./b/c.glb"] })!]).toEqual(["a.png", "b/c.glb"]);
    expect(parseFileIndex({ files: "nope" })).toBeNull();
    expect(parseFileIndex(null)).toBeNull();
  });

  it("requests only files listed in the index; unlisted ids use placeholders without a warning", async () => {
    const calls = stubFetch({ "assets/data/a.json": { v: 1 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const lib = new AssetLibrary(manifest(["data/a.json"]));
    await lib.preload();
    expect(calls).toEqual(["assets/data/a.json"]);
    expect(lib.getJson("data.a")).toEqual({ v: 1 });
    const r = lib.report();
    expect(r.loaded).toEqual(["data.a"]);
    expect(r.noFile).toEqual(["data.b"]);
    expect(r.fileIndex).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("a newly listed file is loaded with no code or manifest change", async () => {
    stubFetch({ "assets/data/a.json": { v: 1 }, "assets/./data/b.json": { v: 2 } });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const lib = new AssetLibrary(manifest(["data/a.json", "data/b.json"]));
    await lib.preload();
    expect(lib.report().loaded).toEqual(["data.a", "data.b"]);
    expect(lib.getJson("data.b")).toEqual({ v: 2 });
  });

  it("warns once when a listed file cannot be fetched", async () => {
    stubFetch({ "assets/data/a.json": { v: 1 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = new AssetLibrary(manifest(["data/a.json", "data/b.json"]));
    await lib.preload();
    expect(lib.report().placeholders).toEqual(["data.b"]);
    expect(lib.report().noFile).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("data.b");
  });

  it("without an index every src is probed", async () => {
    const calls = stubFetch({ "assets/data/a.json": { v: 1 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = new AssetLibrary(manifest(null));
    await lib.preload();
    expect(calls.sort()).toEqual(["assets/./data/b.json", "assets/data/a.json"]);
    expect(lib.report().fileIndex).toBe(false);
  });

  it("loadManifest reads the declared index and ignores an SPA html fallback", async () => {
    const root = { version: 1, parts: ["p.json"], fileIndex: "files.json" };
    stubFetch({ "assets/manifest.json": root, "assets/p.json": part, "assets/files.json": { version: 1, files: ["data/a.json"] } });
    const m = await loadManifest("assets/manifest.json");
    expect([...m.files!]).toEqual(["data/a.json"]);
    expect(m.entries.size).toBe(2);

    vi.unstubAllGlobals();
    stubFetch({ "assets/manifest.json": root, "assets/p.json": part }, ["assets/files.json"]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await loadManifest("assets/manifest.json")).files).toBeNull();
  });
});
