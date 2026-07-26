# icons.class

An icon source that answers with CSS class names, so any view showing a file path can style its own icon element.

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| Version     | `1.0.0`                                                       |
| Provided by | `provideIconsClass()` returning the lookup object             |
| Consumed by | `consumeIconsClass(service)` returning a `Disposable`         |
| Owner       | [`native-icons`](https://github.com/lumine-code/native-icons) |

This contract has no hub: it is provided by icon packages and consumed directly by the tree view, tabs, the search panel, the fuzzy finders, and the archive view. `native-icons` owns the document because it implements both this service and [`icons.element`](icons.element.md), but the contract belongs to neither provider — a third icon package may implement it without either being installed.

When nothing provides it, consumers fall back to core's own octicon mapping (`atom.ui.iconClassForPath`), so a missing provider degrades to plain icons rather than to none.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "icons.class": {
      "versions": { "1.0.0": "provideIconsClass" }
    }
  }
}
```

Returning `undefined` from `provideIconsClass` registers nothing, which is the supported way for a package to ship an icon set that is switched off in its settings.

## Contract

```ts
type IconsClass = {
  iconClassForPath(filePath: string, context?: string): string | string[] | null;
  onDidChange?(callback: () => void): Disposable;
};
```

| Member                                | Description                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iconClassForPath(filePath, context)` | Required. Returns one class name, an array of them, or `null` to let the consumer fall back to core's mapping.                                                                                      |
| `onDidChange(callback)`               | Optional but important. Fires when previously-given answers have changed — a different set, a light/dark switch — so consumers re-render. Without it, views keep the classes they were first given. |

`context` is a string naming the call site, such as `"search-panel"` or `"tree-view"`. Providers are free to ignore it; consumers must not rely on it being used.

## Minimal example

```js
const changeCallbacks = new Set();

module.exports = {
  provideIconsClass() {
    return {
      iconClassForPath(filePath) {
        if (typeof filePath !== "string") return null;
        if (filePath.endsWith(".rs")) return ["my-icon", "my-icon-rust"];
        return null;
      },
      onDidChange(callback) {
        changeCallbacks.add(callback);
        return { dispose: () => changeCallbacks.delete(callback) };
      },
    };
  },
};
```

## Behavior

`iconClassForPath` is called on every render of every row, so it must be cheap and synchronous. Providers that resolve icons lazily — from disk, from the shell, from a theme — should return a class immediately, write the real rule into a stylesheet when it resolves, and fire `onDidChange`.

Returning `null` is a real answer: it means "I have nothing for this path", and the consumer falls back. It does not mean the provider is unavailable.

A directory is a plain path like any other. A provider that wants folder icons must detect directories itself; consumers do not flag them.

Only one `icons.class` provider is used at a time — the last one registered wins, and consumers hold a single service reference. Two icon packages installed together will fight, which is why `native-icons` and `more-icons` each offer a mode that registers nothing.

## Teardown

`consumeIconsClass` returns a `Disposable` that restores the core fallback and drops the consumer's `onDidChange` subscription. A provider needs no `dispose` of its own, but any stylesheet it attached is its to remove on deactivate.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
