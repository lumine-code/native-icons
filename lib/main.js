"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable } = require("lumine");
const IconResolver = require("./resolver.js");

let resolver, disposables;
let greenlist = [];
let blacklist = [];

// Paths declined because the OS had not produced their icon yet, grouped by the
// resolver key that will answer for them. The registry is told exactly which
// paths to repaint when one arrives, so a `.psd` resolving does not redraw an
// entire tree.
const pendingPaths = new Map();
const changeCallbacks = new Set();

// -----------------------------------------------------------------------------
// Pattern parsing
// -----------------------------------------------------------------------------
//
// Greenlist and blacklist patterns, matched case-insensitively against the
// basename:
//   "*"          everything
//   "*.ext"      suffix
//   "name*"      prefix
//   "*sub*"      substring
//   "exact"      exact match
//
// Anything with `?` or with a `*` somewhere other than the very start or end is
// rejected with a console warning and skipped.

function patternToParts(glob) {
  if ("string" === typeof glob) glob = glob.trim();
  if ("string" !== typeof glob || !glob.length) return null;
  if (glob === "*") return { op: "any", value: "" };
  if (/^\*,[a-z0-9_-]+$/i.test(glob)) glob = "*." + glob.slice(2);
  if (glob.includes("?")) return null;

  const startWild = glob.startsWith("*");
  const endWild = glob.endsWith("*") && glob.length > 1;
  const middle = glob.slice(startWild ? 1 : 0, endWild ? -1 : undefined);

  // Middle must be a plain literal.
  if (!middle.length || middle.includes("*")) return null;

  let op;
  if (startWild && endWild) op = "*=";
  else if (startWild) op = "$=";
  else if (endWild) op = "^=";
  else op = "=";

  return { op, value: middle.toLowerCase() };
}

function supportedPattern(raw, listName) {
  const parts = patternToParts(raw);
  if (!parts) console.warn(`[native-icons] ignored unsupported ${listName} pattern:`, raw);
  return parts;
}

function configPatterns(key) {
  const value = lumine.config.get(`native-icons.${key}`) || [];
  const items = Array.isArray(value) ? value : [value];
  const patterns = [];

  for (const item of items) {
    if ("string" !== typeof item) continue;
    const text = item.trim();
    if (!text) continue;
    if (text.includes(", ") || text.includes(",\t")) {
      patterns.push(
        ...text
          .split(/\s*,\s+/)
          .map((p) => p.trim())
          .filter(Boolean),
      );
    } else {
      patterns.push(text);
    }
  }

  return patterns;
}

function compileLists() {
  greenlist = configPatterns("greenlist")
    .map((p) => supportedPattern(p, "greenlist"))
    .filter(Boolean);
  blacklist = configPatterns("blacklist")
    .map((p) => supportedPattern(p, "blacklist"))
    .filter(Boolean);
}

function matchesPattern(parts, name) {
  switch (parts.op) {
    case "any":
      return true;
    case "$=":
      return name.endsWith(parts.value);
    case "^=":
      return name.startsWith(parts.value);
    case "*=":
      return name.includes(parts.value);
    default:
      return name === parts.value;
  }
}

// An empty greenlist claims nothing, so the package is inert until asked for
// something specific. The blacklist always wins.
function claims(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (!greenlist.some((parts) => matchesPattern(parts, name))) return false;
  return !blacklist.some((parts) => matchesPattern(parts, name));
}

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

function existingPath(candidate) {
  if ("string" !== typeof candidate || !candidate.length) return null;
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveExistingPath(filePath) {
  const candidates = [filePath];

  const projectPaths = lumine.project && lumine.project.getPaths ? lumine.project.getPaths() : [];
  if ("string" === typeof filePath && filePath.length && !path.isAbsolute(filePath)) {
    for (const projectPath of projectPaths) candidates.push(path.join(projectPath, filePath));
  }

  for (const p of candidates) {
    const found = existingPath(p);
    if (found) {
      try {
        return fs.realpathSync(found);
      } catch {
        return path.resolve(found);
      }
    }
  }

  return path.resolve(filePath);
}

function customFileTypeExt(filePath) {
  if (!lumine.config.get("native-icons.useCustomFileTypes")) return null;
  const map = lumine.config.get("core.customFileTypes");
  if (!map || "object" !== typeof map) return null;

  const basename = path.basename(filePath);
  const realExt = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const baseLow = basename.toLowerCase();

  for (const scope of Object.keys(map)) {
    const patterns = map[scope];
    if (!Array.isArray(patterns)) continue;
    const matched = patterns.some((p) => {
      if ("string" !== typeof p) return false;
      const pl = p.toLowerCase().replace(/^\./, "");
      return pl === realExt || pl === baseLow;
    });
    if (!matched) continue;
    const grammar = lumine.grammars && lumine.grammars.grammarForScopeName(scope);
    const types = grammar && grammar.fileTypes;
    if (!types || !types.length) continue;
    return "." + String(types[0]).replace(/^\./, "").toLowerCase();
  }
  return null;
}

function targetForFile(filePath) {
  const override = customFileTypeExt(filePath);
  return override ? "override" + override : filePath;
}

// -----------------------------------------------------------------------------
// Change reporting
// -----------------------------------------------------------------------------

function emitDidChange(scope) {
  for (const callback of changeCallbacks) callback(scope);
}

function rememberPending(target, filePath) {
  let paths = pendingPaths.get(target);
  if (!paths) pendingPaths.set(target, (paths = new Set()));
  paths.add(filePath);
}

function resolvePending(target) {
  const paths = pendingPaths.get(target);
  if (!paths || paths.size === 0) return;
  pendingPaths.delete(target);
  emitDidChange({ paths: [...paths] });
}

function invalidateEverything() {
  pendingPaths.clear();
  emitDidChange({ types: ["path"] });
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

function pullOptions() {
  resolver.setOptions({
    useFullPathForExecutables: lumine.config.get("native-icons.useFullPathForExecutables"),
  });
}

function activate() {
  resolver = new IconResolver();
  disposables = new CompositeDisposable();

  if (!resolver.available()) {
    lumine.notifications.addError("native-icons", {
      description: "The Lumine `lumine.app.getFileIcon` service is not available in this build.",
      dismissable: true,
    });
    return;
  }

  pullOptions();
  compileLists();

  const recompile = () => {
    compileLists();
    invalidateEverything();
  };

  disposables.add(
    lumine.config.observe("native-icons.useFullPathForExecutables", () => {
      pullOptions();
      invalidateEverything();
    }),
    lumine.config.observe("native-icons.useCustomFileTypes", () => invalidateEverything()),
    lumine.config.observe("native-icons.greenlist", recompile),
    lumine.config.observe("native-icons.blacklist", recompile),
  );
}

function deactivate() {
  if (disposables) disposables.dispose();
  changeCallbacks.clear();
  pendingPaths.clear();
  resolver = disposables = null;
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

// Above the glyph-font providers, so a greenlisted path takes the OS icon and
// everything else falls through to them untouched. Nothing is claimed until the
// greenlist says so, which is why installing this package alongside a glyph set
// changes nothing on its own.
function provideIcons() {
  return {
    id: "native-icons",
    priority: 100,
    handles: ["path"],
    async: true,

    iconFor(target) {
      if (!resolver || !resolver.available()) return null;
      // The OS has no icon for a directory that says anything the editor's own
      // folder icons do not already say.
      if (target.hints.directory) return null;
      if (typeof target.path !== "string" || !target.path.length) return null;
      if (!claims(target.path)) return null;

      const key = targetForFile(resolveExistingPath(target.path));
      const url = resolver.resolve(key, false, () => resolvePending(key));
      if (url) return { render: "image", source: url };

      // Not ready. Declining lets a glyph provider paint something now; the
      // registry repaints this path once the icon arrives.
      rememberPending(key, target.path);
      return null;
    },

    onDidChange(callback) {
      changeCallbacks.add(callback);
      return { dispose: () => changeCallbacks.delete(callback) };
    },
  };
}

module.exports = { activate, deactivate, provideIcons };
