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
  let mainModule;

  beforeEach(async () => {
    ({ mainModule } = await atom.packages.activatePackage("native-icons"));
  });

  it("attaches its style element on activation", () => {
    expect(document.head.querySelector("style[data-native-icons]")).not.toBeNull();
  });

  describe("in support mode (default)", () => {
    it("does not hand out the icon services", () => {
      expect(atom.config.get("native-icons.mode")).toBe("support");
      expect(mainModule.provideFileIcons()).toBeUndefined();
      expect(mainModule.provideElementIcons()).toBeUndefined();
    });
  });

  describe("in service mode", () => {
    beforeEach(() => {
      atom.config.set("native-icons.mode", "service");
    });

    describe("the icons.class service", () => {
      it("returns native icon classes for a file path", () => {
        const service = mainModule.provideFileIcons();
        expect(service).toBeDefined();
        const classes = service.iconClassForPath(__filename, "tree-view");
        expect(Array.isArray(classes)).toBe(true);
        expect(classes).toContain("native-icon");
        expect(classes).toContain("native-icon-js");
      });

      it("returns the directory icon class for a directory path", () => {
        const service = mainModule.provideFileIcons();
        expect(service.iconClassForPath(__dirname)).toBe("icon-file-directory");
      });

      it("eventually writes a background-image rule for the extension", async () => {
        const service = mainModule.provideFileIcons();
        service.iconClassForPath(__filename, "tree-view");
        const styleEl = document.head.querySelector("style[data-native-icons]");
        await waitFor(() =>
          Array.from(styleEl.sheet.cssRules).some((rule) =>
            rule.cssText.includes("native-icon-js"),
          ),
        );
      });
    });

    describe("the icons.element service", () => {
      it("tags a file element and untags it on dispose", () => {
        const addIconToElement = mainModule.provideElementIcons();
        expect(typeof addIconToElement).toBe("function");

        const element = document.createElement("span");
        const disposable = addIconToElement(element, __filename);
        expect(element.classList.contains("native-icon")).toBe(true);
        expect(element.classList.contains("native-icon-js")).toBe(true);
        expect(element.getAttribute("data-native-icon-key")).toBe(".js");

        disposable.dispose();
        expect(element.classList.contains("native-icon")).toBe(false);
        expect(element.classList.contains("native-icon-js")).toBe(false);
        expect(element.hasAttribute("data-native-icon-key")).toBe(false);
      });

      it("tags a directory element with the folder icon class", () => {
        const addIconToElement = mainModule.provideElementIcons();
        const element = document.createElement("span");
        const disposable = addIconToElement(element, __dirname);
        expect(element.classList.contains("icon-file-directory")).toBe(true);
        disposable.dispose();
        expect(element.classList.contains("icon-file-directory")).toBe(false);
      });
    });
  });

  describe("support-mode greenlist", () => {
    it("compiles a CSS rule per greenlisted pattern", async () => {
      atom.config.set("native-icons.greenlist", ["*.js"]);
      const styleEl = document.head.querySelector("style[data-native-icons]");
      await waitFor(() =>
        Array.from(styleEl.sheet.cssRules).some((rule) =>
          rule.selectorText?.includes('[data-name$=".js" i]'),
        ),
      );
    });

    it("excludes blacklisted patterns from greenlist selectors", async () => {
      atom.config.set("native-icons.blacklist", ["*.min.js"]);
      atom.config.set("native-icons.greenlist", ["*.js"]);
      const styleEl = document.head.querySelector("style[data-native-icons]");
      const rule = await waitFor(() =>
        Array.from(styleEl.sheet.cssRules).find((r) => r.selectorText?.includes('".js"')),
      );
      expect(rule.selectorText).toContain(':not([data-name$=".min.js" i])');
    });
  });

  describe("deactivation", () => {
    it("removes the style element", async () => {
      await atom.packages.deactivatePackage("native-icons");
      expect(document.head.querySelector("style[data-native-icons]")).toBeNull();
    });
  });

  it("resolves relative paths against the project", () => {
    atom.config.set("native-icons.mode", "service");
    atom.project.setPaths([path.dirname(__dirname)]);
    const service = mainModule.provideFileIcons();
    const classes = service.iconClassForPath(path.join("spec", path.basename(__filename)));
    expect(classes).toContain("native-icon-js");
  });
});
