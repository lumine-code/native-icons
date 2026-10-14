// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view"],
  viewport: { width: 1200, height: 760 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("Signal Lab/src/signal.js");
    await lumine.project.setPaths([fixture("Signal Lab")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Display native file icons in the project tree.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.config.set("native-icons.greenlist", ["*"]);
          lumine.commands.dispatch(lumine.views.getView(state.editor), "tree-view:show");
        }
      },
      ready() {
        return Boolean(document.querySelector(".tree-view"));
      },
    },
  ],
  async cleanup(context) {
    const { lumine } = context;
    lumine.config.unset("native-icons.greenlist");
  },
};
