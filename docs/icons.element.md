# icons.element

An icon source that decorates a DOM element directly, for icons a CSS class cannot express — a native shell icon, an embedded image, a per-file thumbnail.

|             |                                                               |
| ----------- | ------------------------------------------------------------- |
| Version     | `1.0.0`                                                       |
| Provided by | `provideIconsElement()` returning the decorate function       |
| Consumed by | `consumeIconsElement(service)` returning a `Disposable`       |
| Owner       | [`native-icons`](https://github.com/lumine-code/native-icons) |

The companion to [`icons.class`](icons.class.md), and **mutually exclusive with it** at the consumer: a view that has an element service never calls the class service. Provide this one only if you can answer for every path, including directories — otherwise the consumer is left with an undecorated element and no fallback.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "icons.element": {
      "versions": { "1.0.0": "provideIconsElement" }
    }
  }
}
```

Returning `undefined` registers nothing, which is how a package ships an icon set that its settings have switched off.

## Contract

```ts
type IconsElement = (
  element: HTMLElement,
  filePath: string,
  options?: { isDirectory?: boolean },
) => Disposable;
```

The service **is** the function itself, not an object with a method on it. Consumers call `service(element, filePath)` directly.

| Argument   | Description                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `element`  | The icon element to decorate. Already in the document; style or fill it in place.                                         |
| `filePath` | The path the element represents.                                                                                          |
| `options`  | Hints from the consumer. `isDirectory` is the only one in use, and it may be absent — detect it yourself when it matters. |

Return a `Disposable` that undoes whatever the call did. Return a no-op `Disposable` rather than `null` when you decline: consumers add the return value to a collection unconditionally.

## Minimal example

```js
module.exports = {
  provideIconsElement() {
    return function addIconToElement(element, filePath) {
      if (!element || !filePath) return { dispose() {} };

      element.classList.add("my-icon");
      element.style.backgroundImage = `url(${iconUrlFor(filePath)})`;

      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          element.classList.remove("my-icon");
          element.style.backgroundImage = "";
        },
      };
    };
  },
};
```

## Behavior

Because the element service suppresses the class service entirely, a provider that only knows about files silently strips a consumer's folder icons rather than falling back for them. A package whose icon set has no folder glyphs should therefore provide only `icons.class`, as `more-icons` does.

The function is called once per element per path, and again whenever the consumer re-renders that row. Consumers dispose the previous return value before calling again, so a provider does not need to detect repeats — but it must make `dispose` idempotent, since a consumer tearing down may dispose a handle twice.

Resolution that cannot be synchronous should decorate the element immediately with a placeholder and update it in place when the real icon arrives. There is no change notification on this service; the element is the channel.

## Teardown

`consumeIconsElement` returns a `Disposable` that disposes every outstanding per-element handle and restores the consumer's class-based path. Guard your own `dispose` against being called twice.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
