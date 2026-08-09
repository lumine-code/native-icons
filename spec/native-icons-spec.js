const path = require("path");

// The spec runner freezes `setTimeout`, so poll on animation frames instead.
function waitFor(predicate, timeout = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
      } else if (Date.now() - start > timeout) {
        reject(new Error("Timed out waiting for condition"));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

describe("native-icons", () => {
  let service;

  const iconFor = (filePath, hints = {}) => service.iconFor({ path: filePath, hints });

  beforeEach(async () => {
    const { mainModule } = await lumine.packages.activatePackage("native-icons");
    service = mainModule.provideIcons();
  });

  it("declares itself above the glyph-font providers", () => {
    expect(service.priority).toBe(100);
    expect(service.handles).toEqual(["path"]);
    // Answers arrive from the OS after the fact, so the registry has to be told.
    expect(service.async).toBe(true);
    expect(typeof service.onDidChange).toBe("function");
  });

  // Installing this package alongside a glyph set has to change nothing until
  // the user says which files they want it for.
  it("claims nothing while the greenlist is empty", () => {
    expect(lumine.config.get("native-icons.greenlist")).toEqual([]);
    expect(iconFor(__filename)).toBeNull();
  });

  describe("with a greenlist", () => {
    beforeEach(() => lumine.config.set("native-icons.greenlist", ["*.js"]));

    it("eventually answers with an image descriptor", async () => {
      // The first ask is a cache miss, so it declines and reports back later.
      expect(iconFor(__filename)).toBeNull();

      const descriptor = await waitFor(() => iconFor(__filename));
      expect(descriptor.render).toBe("image");
      expect(descriptor.source).toContain("data:image");
    });

    it("reports the paths it can now answer for", async () => {
      const callback = jasmine.createSpy("onDidChange");
      service.onDidChange(callback);

      iconFor(__filename);
      await waitFor(() => callback.calls.count() > 0);

      // Scoped to the paths that were declined, so one resolved extension does
      // not repaint an entire tree.
      expect(callback.calls.mostRecent().args[0].paths).toContain(__filename);
    });

    it("leaves files outside the greenlist alone", () => {
      expect(iconFor("/p/notes.txt")).toBeNull();
    });

    it("lets the blacklist win", () => {
      lumine.config.set("native-icons.blacklist", ["*.min.js"]);
      expect(iconFor("/p/jquery.min.js")).toBeNull();
    });

    it("declines directories so the editor's folder icons answer", () => {
      expect(iconFor(__dirname, { directory: true })).toBeNull();
    });

    it("resolves relative paths against the project", async () => {
      lumine.project.setPaths([path.dirname(__dirname)]);
      const relative = path.join("spec", path.basename(__filename));
      iconFor(relative);
      const descriptor = await waitFor(() => iconFor(relative));
      expect(descriptor.render).toBe("image");
    });
  });

  describe("with a match-all greenlist", () => {
    beforeEach(() => lumine.config.set("native-icons.greenlist", ["*"]));

    it("claims every file", async () => {
      iconFor("/p/notes.txt");
      const descriptor = await waitFor(() => iconFor("/p/notes.txt"));
      expect(descriptor.render).toBe("image");
    });
  });

  it("ignores patterns it cannot express", () => {
    spyOn(console, "warn");
    lumine.config.set("native-icons.greenlist", ["a?b", "we*rd*"]);
    expect(console.warn).toHaveBeenCalled();
    expect(iconFor("/p/axb")).toBeNull();
  });

  // No stylesheet, no generated rules, no class tagging: the descriptor carries
  // the data URL and the editor renders it.
  it("installs no stylesheet of its own", () => {
    expect(document.head.querySelector("style[data-native-icons]")).toBeNull();
  });
});
