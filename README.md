# native-icons

Show native OS file icons in the tree view, tabs, and archive view.

Uses the icon that Windows Explorer, macOS Finder, or the Linux desktop theme would show for the same file type.

## Features

- **Native OS icons**: uses system file icons instead of bundled icon fonts.
- **Composes with glyph sets**: claims only the files you list and leaves the rest to whichever icon package would otherwise draw them.
- **Filename filters**: greenlist and blacklist accept simple filename patterns, with `*` for every file.
- **Custom file types**: honours the `core.customFileTypes` mappings.
- **Embedded-icon binaries**: `.exe`, `.lnk`, `.ico`, `.dll`, `.url`, `.scr`, `.msi` can use their real per-file icon.

## Installation

To install `native-icons` search for _native-icons_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/native-icons`.

## Usage

Nothing gets a native icon until the greenlist says so, so installing this package alongside a glyph set such as `more-icons` changes nothing on its own.

Greenlist the files you want the system icon for. `*.exe, *.lnk` is the common case — binaries carry their own icon and no glyph font can show it — while everything else keeps the glyph it already had. Set the greenlist to `*` to use native icons throughout.

Icons arrive from the operating system asynchronously. A file whose icon is not cached yet is left to the next icon package for that one paint and swapped in as soon as it arrives, so a fresh window fills in rather than showing gaps. The cache is keyed by extension, so this costs one swap per file type rather than one per file.

## Services

- **icons.provider** (`1.0.0`): provided to the editor's icon registry; answers greenlisted file paths with the system icon as an image descriptor, declines everything else so another provider can answer, and reports through `onDidChange` when an icon finishes resolving.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
