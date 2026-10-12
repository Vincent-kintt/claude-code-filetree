<h1 align="center">Claude Code Filetree</h1>

<p align="center">
  An IDE-style file tree for Claude Code that shows what Claude is doing and where in files
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-%E2%89%A5_2.1.287-D97757?logo=claude&logoColor=fff" alt="Claude Code 2.1.287 or newer">
  <img src="https://img.shields.io/badge/version-0.2.29-blue" alt="Version">
  <img src="https://img.shields.io/badge/type-mod-6f42c1" alt="Claude Code mod">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

<p align="center">
  <img src="media/filetree-shimmer.gif" alt="filetree shimmering the file Claude is editing" width="900">
</p>

> [!NOTE]
> filetree is a Claude Code **mod** and needs **Claude Code 2.1.287+**. It shows in the right sidebar, which in the terminal needs the fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide; the Desktop app docks it on its own, and `/filetree` reopens it there after you close it. Tested on macOS; Linux and Windows are covered by the plugin tests only. Mods don't load in WSL sessions of the Desktop app.

---

## Installation

The repo is its own plugin marketplace. Run this in the terminal:

```bash
claude plugin marketplace add data-goblin/claude-code-filetree
claude plugin install filetree@claude-code-filetree
```

Or inside a Claude Code session:

```text
/plugin marketplace add data-goblin/claude-code-filetree
/plugin install filetree@claude-code-filetree
```

Installed it as `filetree@filetree` before the repository was renamed? Nothing to do: that install keeps loading and keeps receiving updates.

## Features

- Interactive file tree for the working directory where you're using Claude Code; it follows the cwd
- Search the file tree, including folders you have not opened yet
- Git status per file and folder in color, with exact lines changed (`+N` `-N`) on modified files and `?:N M:N D:N` file counts on folders
- Branch, upstream and ahead/behind in the header
- Visual indicator of Claude reads and searches (purple), writes (orange) and commits (green); collapsed folders open to show the file

  <img src="media/filetree-read.gif" alt="Files shimmer purple while Claude reads and searches them" width="800">

- Git and GitHub operations via `git` and `gh` (commit, push, pull, checkout, merge, PR and more) shown as a status at the bottom of the pane

  <img src="media/filetree-git.gif" alt="A committed file shimmers green and the footer shows the commit" width="800">

- Selection-aware: the selected file is passed to Claude as context through a `prompt.submit` hook, and `@path` mentions in a prompt reveal that file in the tree

  <img src="media/filetree-ask.gif" alt="Selecting config.yaml in the tree and asking Claude what it changed there" width="800">

- File and folder sizes: set **Right column** to `size` to show sizes instead of dates; folders show their disk usage (`du`, or a summed listing on Windows), worked out in the background for the rows on screen and refreshed after Claude writes
- Double-click a file to preview it in the pane, or set **Open with** to `app` to open it in its default app
- Click to select, arrow keys to move through the tree
- Light on large repos: outside a repo it only checks once whether one exists, and every git call is scoped to the cwd
- Nerd Font icons with a plain Unicode fallback
- On Omarchy, the pane takes its colors and background from the current theme and follows theme switches

### In the Desktop app

The Desktop app draws a card layout instead of the compact terminal pane:

- A **Right now** card says what Claude is reading, editing or committing, then what it last did, with the branch, ahead/behind and a summary of what changed
- **Find a file** search
- A **Claude touched** list of the files Claude read, edited or committed this session; click one to reveal it in the tree
- The tree below, under a menu: **All files**, or **Edited files** for only what git reports added, modified or deleted, and their folders
- Double-click or Enter on a file shows it in the pane; **← Back to files** returns to the tree and **Open in app ↗** opens it in its default app. Set **Open with** to `app` or a command to change that

The **Claude activity** setting also decides what the card and the touched list record.

### Resizing the pane

You can resize the pane with the mouse, or by setting custom `pane:grow` or `pane:shrink` keybindings in `keybindings.json`

<p align="center">
  <img src="media/filetree-resize.gif" alt="Dragging the filetree pane edge to resize it" width="900">
</p>

## Settings

All settings are in `/config` under filetree.

- **Claude activity:** what shimmers: `reads and writes` (default), `writes`, `reads` or `none`. Git status, line counts and the git status at the bottom always show.
- **Follow Claude** (terminal only): `on` (default) scrolls the tree to what Claude reads, writes or commits; `off` keeps the view where you put it, and highlights still show. In the Desktop app the app does the scrolling, so this setting has no effect there.
- **Right column:** `date` (default) or `size`; what the right column shows.
- **Open with:** `preview` (default) shows a double-clicked file in the pane: Markdown rendered, code highlighted, arrow keys, Page Up/Down and the wheel to scroll, `←`/`h` or `← files` back to the tree, **Open in app ↗** the default app. A blank value means `preview`. `app` opens the file in its default app instead. Anything else is a command that double-click and Enter run instead: `{path}` is the file and `{dir}` its folder, and without `{path}` the path goes last. It runs without a shell, so quote a word that holds spaces, and it should start the viewer and return rather than wait for it. Examples: `zed {path}`, `code -g {path}`, or in herdr a tab running [herdr-file-viewer](https://github.com/smarzban/herdr-file-viewer) on the file: `herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement tab --focus --env HERDR_FILE_VIEWER_OPEN={path}`.
- **Glyphs:** `auto` (default) uses Nerd Font icons when a Nerd Font is installed and your terminal started after it was installed, plain Unicode in the desktop app, and Nerd Font over SSH. `nerd` or `plain` forces one.

## herdr

Clicking rows needs herdr 0.9.1 or later. herdr 0.9.0 and older accept pixel mouse reporting but still send cell positions, which would put every click in the session in the wrong place, so on those versions the rows ignore the mouse and the rest of the pane and session keep working. Run `herdr update` to get row clicks.

## Contributing

Turn on the pre-commit hook once per clone; it runs the layering checks below, `claude plugin validate` and the plugin tests before each commit that touches the plugin:

```bash
git config core.hooksPath .githooks
```

A session loads a copy of the plugin made at install time, so edits don't show until you reinstall. This bumps the patch version, reinstalls from your checkout and deletes older cached copies; then start a new session and check that `/filetree` replies with the new version:

```bash
scripts/dev-install.sh
```

A reinstall resets the plugin's settings; pass yours again with `--config`, for example `scripts/dev-install.sh --config column=size`.

To check the Desktop layout at narrow widths in headless Chrome (screenshots included):

```bash
node scripts/check-desktop-layout.ts
```

### Code layout

```
hooks/
  register.tsx   every hook and every call on the host ($); the only module hooks.json lists
  core/          path and shell helpers, shared constants and types, the session state (rt, settings)
  features/      one folder per feature: model.ts holds its pure rules, view.tsx draws from a view model
  ui/            icons, tones, and rows.tsx, the row renderer that runs on the client
  version.ts     the version, which the pre-commit hook keeps in step with plugin.json
```

`register.tsx` is long because the host reads it to load the plugin, and every test fails with `hooks module did not load` if it can't:

1. `$` is used only in `register.tsx` and never passed to an imported function. The host follows `$` only into functions declared next to the hooks.
2. The store keys (`TREE`, `THEME`, `ACTIVITY`, `CLAUDE`) stay literal consts in `register.tsx`. The host lists what the plugin reads and writes from them.
3. There is one hooks module.

Everything else stays pure, which the pre-commit hook checks: no `$` outside `register.tsx`, no `rt` or `settings` in models or `core/` (bar `core/runtime.ts` and `core/platform.ts`), only type imports from `claude-code` there, and no `await` in views.

## License

[MIT](LICENSE)

*This project is inspired by my Omarchy app [FileBlade](https://github.com/data-goblin/fileblade)*
