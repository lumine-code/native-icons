const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Native Icons Core custom file types", () => {
  let scratch, getFileIcon, application, element, projectPaths;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"]) {
      spyOn(lumine.shell, method).and.resolveTo();
    }
    spyOn(lumine.application, "openWindow").and.resolveTo();
    getFileIcon = spyOn(lumine.application, "getFileIcon").and.callThrough();
    projectPaths = lumine.project.getPaths();
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "native-types-")));
    jasmine.attachToDOM(lumine.workspace.getElement());
    lumine.config.set("native-icons.greenlist", ["*"]);
    await lumine.packages.activatePackage("language-python");
    await lumine.packages.activatePackage("language-javascript");
    await lumine.packages.activatePackage("native-icons");
    getFileIcon.calls.reset();
  });

  afterEach(async () => {
    application?.dispose();
    element?.remove();
    application = element = null;
    for (const editor of lumine.workspace.getTextEditors()) editor.destroy();
    for (const name of ["native-icons", "language-python", "language-javascript"]) {
      if (lumine.packages.isPackageActive(name)) await lumine.packages.deactivatePackage(name);
      if (lumine.packages.getLoadedPackage(name)) await lumine.packages.unloadPackage(name);
    }
    lumine.project.setPaths(projectPaths);
    await lumine.fileWatchClient.settlePendingTeardown();
    const relative = path.relative(
      fs.realpathSync.native(os.tmpdir()),
      fs.realpathSync.native(scratch),
    );
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Owned scratch escaped the private temporary root");
    }
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function expectPythonIcon(relativePath, customTypes) {
    lumine.config.set("core.customFileTypes", customTypes);
    const file = path.join(scratch, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "value = 1\n");
    const editor = await lumine.workspace.open(file);
    expect(editor.getGrammar().scopeName).toBe("source.python");
    element = document.createElement("span");
    jasmine.attachToDOM(element);
    application = lumine.icons.applyTo(element, { path: editor.getPath() });
    const rendered = element;
    await waitForFrames(() => Boolean(rendered.style.getPropertyValue("--icon-image")));
    expect(rendered.style.getPropertyValue("--icon-image")).toContain("data:image");
    const targets = getFileIcon.calls.allArgs().map(([target]) => target);
    expect(targets.map((target) => path.basename(target))).toEqual(["probe.py"]);
    const probe = fs.realpathSync.native(targets[0]);
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), probe);
    expect(relative.startsWith(`lumine-native-icons${path.sep}`)).toBeTrue();
    expect(fs.statSync(probe).size).toBe(0);
  }

  it("uses a compound extension accepted by the Core grammar registry", async () => {
    await expectPythonIcon("sample.foo.bar", { "source.python": ["foo.bar"] });
  });

  it("uses a configured path suffix accepted by the Core grammar registry", async () => {
    await expectPythonIcon(path.join("nested", "marker.foo"), {
      "source.python": ["nested/marker.foo"],
    });
  });

  it("uses the more specific mapping instead of the first scope's short extension", async () => {
    await expectPythonIcon("sample.foo.bar", {
      "source.js": ["bar"],
      "source.python": ["foo.bar"],
    });
  });

  it("preserves a simple extension mapping", async () => {
    await expectPythonIcon("sample.ipy", { "source.python": ["ipy"] });
  });
});
