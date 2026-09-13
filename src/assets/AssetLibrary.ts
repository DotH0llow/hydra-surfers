/**
 * AssetLibrary: `get(id)` → ready-to-use object. Never throws on a missing/broken file:
 * falls back to the entry's procedural placeholder and warns once.
 *
 * Swapping art = drop a file at the entry's `src` (or edit `src`) — zero code changes.
 * Game code must reference assets ONLY by manifest id through this class.
 */
import {
  Group,
  Mesh,
  SRGBColorSpace,
  NoColorSpace,
  RepeatWrapping,
  Texture,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { AssetEntry, AssetType, Manifest } from "./manifest";
import {
  buildMeshPlaceholder,
  buildSfxPlaceholder,
  buildSpritePlaceholder,
  buildTexturePlaceholder,
} from "./placeholders";

interface ModelRecord {
  /** Prototype object; getModel returns clones. */
  proto: Object3D;
  clips: AnimationClip[];
  placeholder: boolean;
  skinned: boolean;
}

type CloneFn = (o: Object3D) => Object3D;

export interface AssetReport {
  total: number;
  loaded: string[];
  placeholders: string[];
  unknownRequested: string[];
}

export class AssetLibrary {
  private readonly models = new Map<string, ModelRecord>();
  private readonly textures = new Map<string, Texture>();
  private readonly sprites = new Map<string, string>();
  private readonly audioRaw = new Map<string, ArrayBuffer>();
  private readonly audioDecoded = new Map<string, AudioBuffer>();
  private readonly audioPending = new Set<string>();
  private readonly json = new Map<string, unknown>();
  private readonly fromFile = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly unknown = new Set<string>();
  private skeletonClone: CloneFn | null = null;

  constructor(readonly manifest: Manifest) {}

  get base(): string {
    return this.manifest.base;
  }

  has(id: string): boolean {
    return this.manifest.entries.has(id);
  }

  entry(id: string): AssetEntry | undefined {
    return this.manifest.entries.get(id);
  }

  ids(type?: AssetType): string[] {
    const out: string[] = [];
    for (const e of this.manifest.entries.values()) if (!type || e.type === type) out.push(e.id);
    return out;
  }

  /** True when the id is being served by its procedural placeholder. */
  isPlaceholder(id: string): boolean {
    return !this.fromFile.has(id);
  }

  report(): AssetReport {
    const ids = this.ids();
    return {
      total: ids.length,
      loaded: ids.filter((id) => this.fromFile.has(id)),
      placeholders: ids.filter((id) => !this.fromFile.has(id)),
      unknownRequested: [...this.unknown],
    };
  }

  /** Fetch + parse every manifest entry (in parallel). Missing files resolve to placeholders. */
  async preload(onProgress?: (done: number, total: number) => void): Promise<void> {
    const entries = [...this.manifest.entries.values()];
    let done = 0;
    await Promise.all(
      entries.map(async (e) => {
        try {
          await this.loadEntry(e);
        } catch (err) {
          this.failed.add(e.id);
          console.debug(`[assets] ${e.id}: ${String(err)}`);
        }
        onProgress?.(++done, entries.length);
      }),
    );
    const ph = entries.filter((e) => !this.fromFile.has(e.id)).map((e) => e.id);
    if (ph.length) {
      for (const id of ph) this.warned.add(id);
      console.warn(`[assets] ${ph.length}/${entries.length} assets missing → using placeholders: ${ph.join(", ")}`);
    }
  }

  /** Generic accessor by entry type. */
  get(id: string): Object3D | Texture | string | unknown {
    const e = this.entry(id);
    switch (e?.type) {
      case "gltf":
        return this.getModel(id);
      case "texture":
        return this.getTexture(id);
      case "sprite":
        return this.getSpriteUrl(id);
      case "json":
        return this.getJson(id);
      case "audio":
        return this.audioDecoded.get(id) ?? this.audioRaw.get(id) ?? null;
      default:
        this.warnUnknown(id);
        return this.getModel(id);
    }
  }

  /** A fresh instance (clone sharing geometry/materials). Wrapped in a Group so callers own the root transform. */
  getModel(id: string): Object3D {
    const rec = this.modelRecord(id);
    const clone = rec.skinned && this.skeletonClone ? this.skeletonClone(rec.proto) : rec.proto.clone(true);
    clone.userData.assetId = id;
    clone.userData.placeholder = rec.placeholder;
    return clone;
  }

  getClips(id: string): AnimationClip[] {
    return this.modelRecord(id).clips;
  }

  /**
   * First mesh of a model with its node transform baked into a geometry copy — for InstancedMesh.
   */
  getMeshParts(id: string): { geometry: BufferGeometry; material: Material } {
    const rec = this.modelRecord(id);
    rec.proto.updateMatrixWorld(true);
    let found: Mesh | null = null;
    rec.proto.traverse((o) => {
      if (!found && (o as Mesh).isMesh) found = o as Mesh;
    });
    if (!found) {
      const ph = buildMeshPlaceholder({ entry: { id, type: "gltf", src: "", placeholder: "missing" }, getTexture: (t) => this.getTexture(t) });
      ph.traverse((o) => {
        if (!found && (o as Mesh).isMesh) found = o as Mesh;
      });
    }
    const mesh = found as unknown as Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return { geometry, material };
  }

  getTexture(id: string): Texture {
    const cached = this.textures.get(id);
    if (cached) return cached;
    const e = this.entry(id);
    if (!e) this.warnUnknown(id);
    else this.warnPlaceholder(id);
    const tex = buildTexturePlaceholder(e ?? { id, type: "texture", src: "", placeholder: "checker" });
    this.textures.set(id, tex);
    return tex;
  }

  getSpriteUrl(id: string): string {
    const cached = this.sprites.get(id);
    if (cached) return cached;
    const e = this.entry(id);
    if (!e) this.warnUnknown(id);
    else this.warnPlaceholder(id);
    const url = buildSpritePlaceholder(e ?? { id, type: "sprite", src: "", placeholder: "square" });
    this.sprites.set(id, url);
    return url;
  }

  getJson<T = unknown>(id: string): T | undefined {
    if (!this.json.has(id)) this.warnPlaceholder(id);
    return this.json.get(id) as T | undefined;
  }

  /**
   * Decoded audio for `ac`. Returns the synthesized placeholder immediately when the file is
   * missing; decodes real files once (async) and returns null until ready.
   */
  getAudioBuffer(id: string, ac: BaseAudioContext): AudioBuffer | null {
    const decoded = this.audioDecoded.get(id);
    if (decoded) return decoded;
    const e = this.entry(id);
    if (!e) {
      this.warnUnknown(id);
      const buf = buildSfxPlaceholder(ac, { id, type: "audio", src: "", placeholder: "synth-blip" });
      this.audioDecoded.set(id, buf);
      return buf;
    }
    const raw = this.audioRaw.get(id);
    if (raw && !this.audioPending.has(id)) {
      this.audioPending.add(id);
      ac.decodeAudioData(raw.slice(0))
        .then((buf) => this.audioDecoded.set(id, buf))
        .catch((err) => {
          console.warn(`[assets] ${id}: audio decode failed (${String(err)}); using placeholder`);
          this.fromFile.delete(id);
          this.audioDecoded.set(id, buildSfxPlaceholder(ac, e));
        });
      return null;
    }
    if (raw) return null; // decoding
    const buf = buildSfxPlaceholder(ac, e);
    this.audioDecoded.set(id, buf);
    return buf;
  }

  // ------------------------------------------------------------------ internals

  private url(e: AssetEntry): string {
    return this.manifest.base + e.src;
  }

  private async fetchFile(e: AssetEntry): Promise<Response | null> {
    if (!e.src) return null;
    try {
      const res = await fetch(this.url(e));
      if (!res.ok) return null;
      // SPA fallbacks answer unknown paths with index.html — treat as missing.
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/html")) return null;
      return res;
    } catch {
      return null;
    }
  }

  private async loadEntry(e: AssetEntry): Promise<void> {
    switch (e.type) {
      case "gltf":
        return this.loadModel(e);
      case "texture":
        return this.loadTexture(e);
      case "sprite":
        return this.loadSprite(e);
      case "audio": {
        const res = await this.fetchFile(e);
        if (!res) return;
        this.audioRaw.set(e.id, await res.arrayBuffer());
        this.fromFile.add(e.id);
        return;
      }
      case "json": {
        const res = await this.fetchFile(e);
        if (!res) return;
        this.json.set(e.id, await res.json());
        this.fromFile.add(e.id);
        return;
      }
      case "font": {
        const res = await this.fetchFile(e);
        if (!res || typeof FontFace === "undefined") return;
        const face = new FontFace(String(e.meta?.family ?? e.id), await res.arrayBuffer());
        await face.load();
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
        this.fromFile.add(e.id);
        return;
      }
    }
  }

  private async loadModel(e: AssetEntry): Promise<void> {
    const res = await this.fetchFile(e);
    if (!res) return;
    const data = await res.arrayBuffer();
    const [{ GLTFLoader }, skel] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/utils/SkeletonUtils.js"),
    ]);
    this.skeletonClone = skel.clone as CloneFn;
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(data, this.url(e).replace(/[^/]*$/, ""));
    const root = new Group();
    const scene = gltf.scene;
    if (e.scale && e.scale !== 1) scene.scale.setScalar(e.scale);
    if (e.forward === "+z") scene.rotation.y = Math.PI;
    root.add(scene);
    let skinned = false;
    scene.traverse((o) => {
      if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
    });
    this.models.set(e.id, { proto: root, clips: gltf.animations, placeholder: false, skinned });
    this.fromFile.add(e.id);
  }

  private async loadTexture(e: AssetEntry): Promise<void> {
    const res = await this.fetchFile(e);
    if (!res) return;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
    const tex = new Texture(bitmap as unknown as HTMLImageElement);
    tex.flipY = false;
    tex.colorSpace = e.srgb === false ? NoColorSpace : SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    if (e.repeat) tex.repeat.set(e.repeat[0], e.repeat[1]);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.textures.set(e.id, tex);
    this.fromFile.add(e.id);
  }

  private async loadSprite(e: AssetEntry): Promise<void> {
    const res = await this.fetchFile(e);
    if (!res) return;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return;
    // Use the URL directly so the browser caches it; the fetch proved it exists.
    this.sprites.set(e.id, this.url(e));
    this.fromFile.add(e.id);
  }

  private modelRecord(id: string): ModelRecord {
    let rec = this.models.get(id);
    if (rec) return rec;
    const e = this.entry(id);
    if (!e) this.warnUnknown(id);
    else this.warnPlaceholder(id);
    const proto = buildMeshPlaceholder({
      entry: e ?? { id, type: "gltf", src: "", placeholder: "missing" },
      getTexture: (t) => this.getTexture(t),
    });
    rec = { proto, clips: [], placeholder: true, skinned: false };
    this.models.set(id, rec);
    return rec;
  }

  private warnPlaceholder(id: string): void {
    if (this.warned.has(id) || this.fromFile.has(id)) return;
    this.warned.add(id);
    const e = this.entry(id);
    console.warn(`[assets] ${id}: "${e?.src}" unavailable → placeholder "${e?.placeholder ?? "default"}"`);
  }

  private warnUnknown(id: string): void {
    if (this.unknown.has(id)) return;
    this.unknown.add(id);
    console.warn(`[assets] unknown asset id "${id}" (not in manifest) → generic placeholder`);
  }
}
