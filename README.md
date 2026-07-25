# native-icons

Show native OS file icons in the tree view, tabs, and archive view.

Uses the icon that Windows Explorer, macOS Finder, or the Linux desktop theme would show for the same file type.

## Features

- **Native OS icons**: uses system file icons instead of bundled icon fonts.
- **Support mode**: adds native icons only for greenlisted files, alongside another icon package.
- **Service mode**: registers icon services and can be used as the primary icon package.
- **CSS-compatible filters**: greenlist and blacklist support simple filename patterns in support mode.
- **Custom file types**: honours the `core.customFileTypes` mappings.
- **Embedded-icon binaries**: `.exe`, `.lnk`, `.ico`, `.dll`, `.url`, `.scr`, `.msi` can use their real per-file icon.

## Installation

To install `native-icons` search for _native-icons_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/native-icons`.

## Usage

Use `support` mode when another icon package is already active. It does not register services or mutate DOM elements. It injects one CSS rule per greenlisted pattern using the `.icon[data-name...]::before` convention used by tree-view, tabs, fuzzy finder, find-and-replace, archive-view, and many community packages. Files outside the greenlist are untouched.

Use `service` mode when `native-icons` is your primary icon package. It registers services, tags supported file elements, and returns icon classes to consumers. Greenlist and blacklist are ignored in this mode. Files receive their native file icon, and directories use the default folder icon.

## Services

- **atom.file-icons** (`1.0.0`): provided to icon consumers (tree-view, tabs, fuzzy finder, archive-view) in service mode; exposes `iconClassForPath(filePath, context)` returning a CSS class name or array of class names for the given path.
- **file-icons.element-icons** (`1.0.0`): provided to packages that iconize their own DOM elements in service mode; exposes `addIconToElement(element, filePath, options)` which attaches a native icon and returns a `Disposable` that removes it.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
