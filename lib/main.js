"use strict";

const fs = require("fs");
const path = require("path");
const { CompositeDisposable } = require("atom");
const IconResolver = require("./resolver.js");

let resolver, disposables, styleEl, ruleSet;

// -----------------------------------------------------------------------------
// Pattern parsing (CSS-compatible subset)
// -----------------------------------------------------------------------------
//
// Supported greenlist/blacklist patterns (case-insensitive):
//   "*.ext"      suffix       -> [data-name$=".ext" i], probe basename "probe.ext"
//   "name*"      prefix       -> [data-name^="name"  i], probe basename "name"
//   "*sub*"      substring    -> [data-name*="sub"   i], probe basename "sub"
//   "exact"      exact match  -> [data-name="exact"  i], probe basename "exact"
//
// Anything with `?` or with a `*` somewhere other than the very start or end
// is rejected with a console warning and skipped.

function patternToParts(glob) {
  if ("string" === typeof glob) glob = glob.trim();
  if ("string" !== typeof glob || !glob.length) return null;
  if (/^\*,[a-z0-9_-]+$/i.test(glob)) glob = "*." + glob.slice(2);
  if (glob.includes("?")) return null;

  const startWild = glob.startsWith("*");
  const endWild = glob.endsWith("*") && glob.length > 1;
  const middle = glob.slice(startWild ? 1 : 0, endWild ? -1 : undefined);

  // Middle must be a plain literal.
  if (!middle.length || middle.includes("*")) return null;

  const escaped = middle.replace(/(["\\])/g, "\\$1");
  let op, probe;
  if (startWild && endWild) {
    op = "*=";
    probe = middle;
  } else if (startWild) {
    op = "$=";
    // Probe with a representative filename ending in `middle` so Windows
    // resolves the right icon. For `*.py` this becomes "probe.py" (extension
    // .py). Extension-like suffixes such as `*ipy` also probe as "probe.ipy".
    probe =
      "probe" + (middle.startsWith(".") || !/^[a-z0-9_-]+$/i.test(middle) ? middle : "." + middle);
  } else if (endWild) {
    op = "^=";
    probe = middle;
  } else {
    op = "=";
    probe = middle;
  }

  return {
    selector: `[data-name${op}"${escaped}" i]`,
    op,
    value: middle.toLowerCase(),
    probe,
  };
}

function supportedPattern(raw, listName) {
  const parts = patternToParts(raw);
  if (!parts) console.warn(`[native-icons] ignored unsupported ${listName} pattern:`, raw);
  return parts;
}

function configPatterns(key) {
  const value = atom.config.get(`native-icons.${key}`) || [];
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

// -----------------------------------------------------------------------------
// Support-mode rule compilation (pure CSS, no DOM mutation)
// -----------------------------------------------------------------------------

function compileSupportRules() {
  if (!resolver || !resolver.available() || !styleEl) return;
  resetRules();

  const greens = configPatterns("greenlist");
  if (!greens.length) return; // support mode is a no-op without a greenlist

  const blacks = configPatterns("blacklist")
    .map((p) => ({ raw: p, parts: supportedPattern(p, "blacklist") }))
    .filter((b) => b.parts);
  const notClauses = blacks.map((b) => `:not(${b.parts.selector})`).join("");

  for (const pat of greens) {
    const parts = supportedPattern(pat, "greenlist");
    if (!parts) continue;
    const probe = applyCustomFileTypeToProbe(parts.probe);
    const selectorFull = `.icon${parts.selector}${notClauses}::before`;
    const seen = ruleSet.has(selectorFull);
    if (seen) continue;

    const onReady = (url) => writeSupportRule(selectorFull, url);
    const url = resolver.resolveProbe(probe, onReady);
    if (url) writeSupportRule(selectorFull, url);
  }
}

function writeSupportRule(selector, url) {
  if (!url || !styleEl || !styleEl.sheet) return;
  if (ruleSet.has(selector)) return;
  const rule =
    `${selector} {` +
    `content: "" !important;` +
    `display: inline-block;` +
    `height: 16px !important;` +
    `width: 16px !important;` +
    `background-image: url("${url}") !important;` +
    `background-position: center;` +
    `background-repeat: no-repeat;` +
    `background-size: contain;` +
    `vertical-align: middle !important;` +
    `}`;
  try {
    styleEl.sheet.insertRule(rule, styleEl.sheet.cssRules.length);
  } catch {
    return;
  }
  ruleSet.add(selector);
}

// If the probe filename's extension is overridden by core.customFileTypes,
// swap it to the grammar's primary file extension.
function applyCustomFileTypeToProbe(probe) {
  if (!atom.config.get("native-icons.useCustomFileTypes")) return probe;
  const ext = path.extname(probe).replace(/^\./, "").toLowerCase();
  if (!ext) return probe;
  const override = customFileTypeExtForExt(ext);
  if (!override) return probe;
  // Replace extension; keep the "probe" prefix.
  return "probe" + override;
}

function customFileTypeExtForExt(extNoDot) {
  const map = atom.config.get("core.customFileTypes");
  if (!map || "object" !== typeof map) return null;
  const target = extNoDot.toLowerCase();
  for (const scope of Object.keys(map)) {
    const patterns = map[scope];
    if (!Array.isArray(patterns)) continue;
    if (
      !patterns.some((p) => "string" === typeof p && p.toLowerCase().replace(/^\./, "") === target)
    )
      continue;
    const grammar = atom.grammars && atom.grammars.grammarForScopeName(scope);
    const types = grammar && grammar.fileTypes;
    if (!types || !types.length) continue;
    return "." + String(types[0]).replace(/^\./, "").toLowerCase();
  }
  return null;
}

// -----------------------------------------------------------------------------
// Service-mode pipeline (class tagging + per-extension rules)
// -----------------------------------------------------------------------------

function tagElement(el, target, isDir) {
  if (isDir) {
    el.classList.add("icon-file-directory");
    return;
  }

  el.classList.add("native-icon");
  const slug = slugFor(target);
  el.classList.add("native-icon-" + slug);
  el.setAttribute("data-native-icon-key", keyFor(target));
}

function untagElement(el) {
  if (!el || !el.classList) return;
  const toRemove = [];
  el.classList.forEach((c) => {
    if (c === "native-icon" || c === "icon-file-directory" || c.startsWith("native-icon-"))
      toRemove.push(c);
  });
  for (const c of toRemove) el.classList.remove(c);
  el.removeAttribute("data-native-icon-key");
}

function keyFor(target) {
  const lower = target.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return lower;
  const ext = lower.slice(dot);
  if (
    [".exe", ".lnk", ".ico", ".dll", ".url", ".scr", ".msi"].includes(ext) &&
    atom.config.get("native-icons.useFullPathForExecutables")
  )
    return lower;
  return ext;
}

function slugFor(target) {
  const key = keyFor(target);
  return (
    key
      .replace(/^\./, "")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase() || "unknown"
  );
}

function existingPath(candidate) {
  if ("string" !== typeof candidate || !candidate.length) return null;
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function resolveExistingPath(filePath, element = null) {
  const candidates = [];

  if (element) {
    const dataPath = element.dataset?.path || element.getAttribute?.("data-path");
    if (dataPath) candidates.push(dataPath);
  }
  candidates.push(filePath);

  const projectPaths = atom.project && atom.project.getPaths ? atom.project.getPaths() : [];
  for (const p of [filePath, ...candidates]) {
    if ("string" !== typeof p || !p.length || path.isAbsolute(p)) continue;
    for (const projectPath of projectPaths) candidates.push(path.join(projectPath, p));
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

function isDirectoryElement(element) {
  if (!element || !element.closest) return false;
  const entry = element.closest(".entry");
  return !!entry && entry.classList.contains("directory");
}

function isDirectoryPath(filePath, options = {}, element = null) {
  if (options.isDirectory) return true;
  if (isDirectoryElement(element)) return true;
  if ("string" === typeof filePath && filePath.endsWith(path.sep)) return true;
  try {
    return fs.statSync(resolveExistingPath(filePath, element)).isDirectory();
  } catch {
    return false;
  }
}

function targetForFile(filePath) {
  const override = customFileTypeExt(filePath);
  return override ? "override" + override : filePath;
}

function writeFileRule(target, urlMaybe) {
  writeRule(target, false, urlMaybe);
}

function writeRule(target, isDir, urlMaybe) {
  if (isDir) return;
  const key = keyFor(target);
  if (ruleSet.has(key)) return;
  let url = urlMaybe;
  if (!url) {
    if (key.startsWith(".") || (!key.includes("\\") && !key.includes("/")))
      url = resolver.extCache.get(key);
    else url = resolver.pathCache.get(key);
  }
  if (!url) return;

  const slug = slugFor(target);
  const cls = "native-icon-" + slug;
  const rule =
    `.tree-view .native-icon.${cls}::before,` +
    `.tab-bar .native-icon.${cls}::before {` +
    `background-image: url("${url}") !important;` +
    `}`;
  try {
    styleEl.sheet.insertRule(rule, styleEl.sheet.cssRules.length);
  } catch {
    return;
  }
  ruleSet.add(key);
}

function customFileTypeExt(filePath) {
  if (!atom.config.get("native-icons.useCustomFileTypes")) return null;
  const map = atom.config.get("core.customFileTypes");
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
    const grammar = atom.grammars && atom.grammars.grammarForScopeName(scope);
    const types = grammar && grammar.fileTypes;
    if (!types || !types.length) continue;
    return "." + String(types[0]).replace(/^\./, "").toLowerCase();
  }
  return null;
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

function isServiceMode() {
  const mode = atom.config.get("native-icons.mode");
  return mode === "service" || mode === "base";
}

function resetRules() {
  ruleSet.clear();
  if (styleEl && styleEl.sheet) {
    while (styleEl.sheet.cssRules.length) styleEl.sheet.deleteRule(0);
  }
  for (const el of document.querySelectorAll(".native-icon")) untagElement(el);
}

function refresh() {
  if (isServiceMode()) return;
  resetRules();
  compileSupportRules();
}

function pullOptions() {
  resolver.setOptions({
    useFullPathForExecutables: atom.config.get("native-icons.useFullPathForExecutables"),
  });
}

function activate() {
  resolver = new IconResolver();
  disposables = new CompositeDisposable();
  ruleSet = new Set();

  if (!resolver.available()) {
    atom.notifications.addError("native-icons", {
      description:
        "Electron `app.getFileIcon` is not reachable. " +
        "`@electron/remote` may not be available in this Lumine build.",
      dismissable: true,
    });
    return;
  }

  styleEl = document.createElement("style");
  styleEl.dataset.nativeIcons = "true";
  document.head.appendChild(styleEl);

  pullOptions();
  disposables.add(
    atom.config.observe("native-icons.useFullPathForExecutables", () => {
      pullOptions();
      refresh();
    }),
    atom.config.observe("native-icons.useCustomFileTypes", () => refresh()),
    atom.config.observe("native-icons.greenlist", () => refresh()),
    atom.config.observe("native-icons.blacklist", () => refresh()),
    atom.config.onDidChange("core.customFileTypes", () => refresh()),
  );

  if (!isServiceMode()) {
    setTimeout(compileSupportRules, 0);
  }
}

function deactivate() {
  if (disposables) disposables.dispose();
  if (styleEl) styleEl.remove();
  resolver = disposables = styleEl = ruleSet = null;
}

// -----------------------------------------------------------------------------
// Services (registered only in service mode)
// -----------------------------------------------------------------------------

function provideIconsClass() {
  if (!isServiceMode()) return undefined;
  return {
    iconClassForPath(filePath, _context) {
      if (!resolver || !resolver.available()) return null;
      if (!filePath) return null;
      const resolvedPath = resolveExistingPath(filePath);

      if (isDirectoryPath(resolvedPath)) {
        return "icon-file-directory";
      }

      const target = targetForFile(resolvedPath);
      const url = resolver.resolve(target, false, (dataUrl) => writeFileRule(target, dataUrl));
      writeFileRule(target, url);
      return ["native-icon", "native-icon-" + slugFor(target)];
    },
  };
}

function provideIconsElement() {
  if (!isServiceMode()) return undefined;
  return function addIconToElement(element, filePath, options = {}) {
    if (!resolver || !resolver.available() || !element || !filePath) return { dispose() {} };

    const resolvedPath = resolveExistingPath(filePath, element);
    const isDir = isDirectoryPath(resolvedPath, options, element);
    if (isDir) {
      tagElement(element, resolvedPath, true);

      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          untagElement(element);
        },
      };
    }

    const target = targetForFile(resolvedPath);
    const url = resolver.resolve(target, false, (dataUrl) => writeRule(target, false, dataUrl));
    writeRule(target, false, url);
    tagElement(element, target, false);

    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        untagElement(element);
      },
    };
  };
}

module.exports = { activate, deactivate, provideIconsElement, provideIconsClass };
