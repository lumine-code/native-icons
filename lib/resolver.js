"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Electron's `app.getFileIcon` wraps Win32 SHGetFileInfo. In Lumine the
// renderer reaches it through @electron/remote, which ships with Lumine
// but isn't in this package's own node_modules.
function loadElectronRemote() {
  try {
    return require("@electron/remote");
  } catch {
    /* ignore */
  }

  let resourcePath = "";
  try {
    resourcePath = atom.getLoadSettings().resourcePath;
  } catch {
    /* ignore */
  }

  // @electron/remote may live inside app.asar (packed) or app.asar.unpacked.
  const candidates = [
    resourcePath && path.join(resourcePath, "node_modules", "@electron", "remote"),
    resourcePath &&
      path.extname(resourcePath) === ".asar" &&
      path.join(`${resourcePath}.unpacked`, "node_modules", "@electron", "remote"),
    resourcePath &&
      path.join(path.dirname(resourcePath), "app", "node_modules", "@electron", "remote"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      return require(p);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function getRemoteApp() {
  const remote = loadElectronRemote();
  return remote && remote.app ? remote.app : null;
}

const PROBE_DIR = path.join(os.tmpdir(), "lumine-native-icons");
const PER_FILE_EXTS = new Set([".exe", ".lnk", ".ico", ".dll", ".url", ".scr", ".msi"]);

class IconResolver {
  constructor() {
    this.app = getRemoteApp();
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
    // `app` via @electron/remote is a Proxy; `typeof` of its members may
    // report "object" instead of "function". So we just check the module
    // loaded; the first real call will tell us if anything's actually broken.
    return !!this.app;
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
   * Return a dataURL for a representative basename used by support-mode CSS
   * selectors, or null synchronously if not yet cached.
   */
  resolveProbe(basename, onReady) {
    if (!this.available() || "string" !== typeof basename || !basename.length) return null;

    const safe = basename.replace(/[\\/:*?"<>|]/g, "_");
    const key = "probe:" + safe.toLowerCase();
    const hit = this.pathCache.get(key);
    if (hit) return hit;

    const probe = path.join(PROBE_DIR, safe);
    try {
      if (!fs.existsSync(probe)) fs.writeFileSync(probe, "");
    } catch {
      /* ignore */
    }

    this._fetch(probe, key).then((url) => {
      this.pathCache.set(key, url);
      onReady && onReady(url);
    });
    return null;
  }

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

    const p = Promise.resolve(this.app.getFileIcon(target, { size }))
      .then((img) => (!img || img.isEmpty() ? null : img.toDataURL()))
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
