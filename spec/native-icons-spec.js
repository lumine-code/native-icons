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

  async function settleIcons() {
    for (let count = 0; count < 40; count++) await Promise.resolve();
  }

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
      expect(descriptor.classes).toContain("icon-image");
      expect(Object.isFrozen(descriptor)).toBe(true);
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

  describe("failed lookups", () => {
    let getFileIcon;

    beforeEach(() => {
      lumine.config.set("native-icons.greenlist", ["*.js"]);
      getFileIcon = spyOn(lumine.application, "getFileIcon").and.rejectWith(
        new Error("The file icon is temporarily unavailable"),
      );
    });

    it("does not keep asking the OS when failure would repaint and ask again", async () => {
      let repaints = 0;
      const subscription = service.onDidChange(() => {
        repaints++;
        // Stand in for the icon registry's repaint, bounded so the old failure
        // feedback loop cannot leave an unending microtask chain in the suite.
        if (repaints < 4) iconFor(__filename);
      });
      try {
        expect(iconFor(__filename)).toBeNull();
        await settleIcons();

        expect(repaints).toBe(0);
        expect(getFileIcon).toHaveBeenCalledTimes(1);
      } finally {
        subscription.dispose();
      }
    });

    it("retries an independent request and repaints when the icon becomes available", async () => {
      const repaint = jasmine.createSpy("repaint");
      const subscription = service.onDidChange(repaint);
      const image = "data:image/png;base64,ZmFrZQ==";
      try {
        expect(iconFor(__filename)).toBeNull();
        await settleIcons();
        expect(repaint).not.toHaveBeenCalled();

        getFileIcon.and.resolveTo(image);
        expect(iconFor(__filename)).toBeNull();
        await settleIcons();

        expect(getFileIcon).toHaveBeenCalledTimes(2);
        expect(repaint).toHaveBeenCalledOnceWith({ paths: [__filename] });
        expect(iconFor(__filename).source).toBe(image);
        expect(getFileIcon).toHaveBeenCalledTimes(2);
      } finally {
        subscription.dispose();
      }
    });

    it("does not repaint for an empty icon response", async () => {
      getFileIcon.and.resolveTo(null);
      const repaint = jasmine.createSpy("repaint");
      const subscription = service.onDidChange(repaint);
      try {
        expect(iconFor(__filename)).toBeNull();
        await settleIcons();

        expect(repaint).not.toHaveBeenCalled();
      } finally {
        subscription.dispose();
      }
    });

    it("keeps a replacement resolver's pending paths until its own response arrives", async () => {
      let finishOld, finishCurrent;
      getFileIcon.and.callFake(() => new Promise((resolve) => (finishOld = resolve)));
      iconFor(__filename);
      await lumine.packages.deactivatePackage("native-icons");
      const current = (await lumine.packages.activatePackage("native-icons")).mainModule;
      service = current.provideIcons();
      getFileIcon.and.callFake(() => new Promise((resolve) => (finishCurrent = resolve)));
      const repaint = jasmine.createSpy("repaint");
      const subscription = service.onDidChange(repaint);
      try {
        iconFor(__filename);
        finishOld("data:image/png;base64,b2xk");
        await settleIcons();
        expect(repaint).not.toHaveBeenCalled();

        finishCurrent("data:image/png;base64,Y3VycmVudA==");
        await settleIcons();
        expect(repaint).toHaveBeenCalledOnceWith({ paths: [__filename] });
      } finally {
        subscription.dispose();
      }
    });
  });

  // No stylesheet, no generated rules, no class tagging: the descriptor carries
  // the data URL and the editor renders it.
  it("installs no stylesheet of its own", () => {
    expect(document.head.querySelector("style[data-native-icons]")).toBeNull();
  });
});
