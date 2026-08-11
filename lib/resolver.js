"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PROBE_DIR = path.join(os.tmpdir(), "lumine-native-icons");
const PER_FILE_EXTS = new Set([".exe", ".lnk", ".ico", ".dll", ".url", ".scr", ".msi"]);

class IconResolver {
  constructor() {
    this.application = global.lumine?.application || null;
    this.extCache = new Map(); // ".psd" -> dataURL
    this.pathCache = new Map(); // real paths and probe keys -> dataURL
    this.pending = new Map(); // key -> Promise<dataURL>
    this.perFile = true;
    try {
      fs.mkdirSync(PROBE_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  available() {
    return typeof this.application?.getFileIcon === "function";
  }

  setOptions({ useFullPathForExecutables }) {
    if ("boolean" === typeof useFullPathForExecutables) this.perFile = useFullPathForExecutables;
  }

  clear() {
    this.extCache.clear();
    this.pathCache.clear();
    this.pending.clear();
  }

  /**
   * Return a dataURL for a file path, or null synchronously if not yet cached.
   * Triggers an async fetch on miss; `onReady(dataUrl)` fires when available.
   */
  resolve(fullPath, isDirectory, onReady) {
    if (!this.available()) return null;

    if (isDirectory) {
      return null;
    }

    const ext = (path.extname(fullPath) || path.basename(fullPath)).toLowerCase();
    const usePath = this.perFile && PER_FILE_EXTS.has(ext);

    if (usePath) {
      const hit = this.pathCache.get(fullPath);
      if (hit) return hit;
      this._fetch(fullPath, fullPath).then((url) => {
        this.pathCache.set(fullPath, url);
        onReady && onReady(url);
      });
      return null;
    }

    const hit = this.extCache.get(ext);
    if (hit) return hit;

    // Probe file: cheap, lets SHGetFileInfo resolve the extension without
    // touching the actual file (network shares, locked files, etc.)
    const probe = this._probeFor(ext);
    this._fetch(probe, ext).then((url) => {
      this.extCache.set(ext, url);
      onReady && onReady(url);
    });
    return null;
  }

  /**
   * Return the path to a zero-byte file named for this extension, creating it
   * on first use, so the OS can be asked for the extension's icon without
   * touching the real file.
   */
  _probeFor(ext) {
    // `ext` already lowercased and may be a basename like "makefile" (no dot).
    // Coerce to a safe filename.
    const safe = ext.replace(/[^a-z0-9.+_-]/g, "_") || ".unknown";
    const file = path.join(PROBE_DIR, "probe" + (safe.startsWith(".") ? safe : "." + safe));
    try {
      if (!fs.existsSync(file)) fs.writeFileSync(file, "");
    } catch {
      /* ignore */
    }
    return file;
  }

  _fetch(target, key) {
    return this._fetchAt(target, key, "small");
  }

  _fetchAt(target, key, size) {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const p = Promise.resolve(this.application.getFileIcon(target, { size }))
      .catch(() => null)
      .then((url) => {
        this.pending.delete(key);
        return url;
      });

    this.pending.set(key, p);
    return p;
  }
}

module.exports = IconResolver;
