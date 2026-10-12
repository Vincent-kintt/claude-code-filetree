# filetree spec list

Each spec is one checkable statement. The IDs are stable, so tests and pull requests can refer
to them. To install and use the plugin, see the [main README](../README.md).

## Platform and requirements

| ID | Spec |
|---|---|
| PLT-01 | Runs on Claude Code 2.1.287 or newer. |
| PLT-02 | Runs on macOS, Linux and Windows. |
| PLT-03 | Does not load in Desktop app WSL sessions. |
| PLT-04 | In the terminal, opens only in the fullscreen layout with at least 110 columns. |
| PLT-05 | The Desktop app docks the pane by itself, and `/filetree` reopens it. |
| PLT-06 | Has no npm dependencies: all I/O goes through the `claude-code` host API. |
| PLT-07 | Runs `git`, `du`, `find`, `fc-list` and the OS open command. `gh` commands are parsed but never run. |
| PLT-08 | Mouse clicks under herdr need herdr 0.9.1 or newer. On older versions the rows ignore the mouse. |

## Tree

| ID | Spec |
|---|---|
| TRE-01 | The root is always the cwd. It follows the cwd when it changes, including after `cd`, `pushd` and `popd` in Bash, and after `/clear`, resume or fork. A double-click or Ctrl/Shift-click on a folder only toggles it. |
| TRE-03 | Lists directories first, then files, in numeric-aware name order. |
| TRE-04 | Search matches relative paths, including in folders that haven't been opened yet. |
| TRE-05 | The search index skips `.git`, `node_modules`, `target`, `.venv`, `__pycache__`, `dist` and `.next`. |
| TRE-06 | The search index goes 6 levels deep (3 at a disk root). |
| TRE-07 | Hidden files are always shown, dimmed. |
| TRE-08 | The right column shows dates, or sizes when the `column` setting is `size`. |
| TRE-09 | Folder sizes come from `du`, or from a summed listing on Windows. They are computed in the background for visible rows, 2 jobs at a time, each with a 15 s timeout. |
| TRE-10 | Folder sizes are recomputed after a write. |
| TRE-11 | A newer directory listing is never overwritten by an older one. A failed listing keeps the cached rows. |

## Git

| ID | Spec |
|---|---|
| GIT-01 | Every file and folder shows a status colour. A folder takes its strongest child's status, in the order U > D > M > T > R > C > A > ?. |
| GIT-02 | Each modified file shows `+N -N` lines changed against `HEAD`. |
| GIT-03 | Each folder shows `?:N M:N D:N` counts, or "clean". |
| GIT-04 | The header shows the branch, its upstream, and ahead/behind counts. |
| GIT-05 | All git calls use `--no-optional-locks -C <root>` and are limited to the cwd. |
| GIT-06 | Outside a repo, only `git rev-parse` runs. |
| GIT-07 | A change to `.git/index` or `HEAD` triggers a git refresh within 300 ms. |
| GIT-08 | Git refreshes never overlap. Requests that arrive during a refresh run as one follow-up. |

## Claude activity

| ID | Spec |
|---|---|
| ACT-01 | A file Claude reads, or searches with `rg`, `grep`, `find` or `cat`, shimmers purple. |
| ACT-02 | A file Claude writes with Edit, Write, NotebookEdit or Bash shimmers orange. |
| ACT-03 | Committed or staged files shimmer green. The branch row flashes on push-like actions. |
| ACT-04 | A shimmer lasts 2.7 s. |
| ACT-05 | Collapsed folders open to reveal a touched file. |
| ACT-06 | Terminal only. With `follow: on`, the view scrolls to the touched file. With `follow: off` it doesn't scroll, but the shimmer still shows. In the Desktop app the app does the scrolling, so `follow` has no effect there. |
| ACT-07 | Git and GitHub commands Claude runs show in the footer as running, then done or failed, only when there is evidence of the outcome. |
| ACT-08 | A background git command stays "running" until its task notification arrives. |
| ACT-09 | A failed Bash command still triggers a refresh. |
| ACT-10 | Footer activity left running when a session was interrupted is marked failed when the session restarts. |
| ACT-11 | The `activity` setting decides which shimmers show. Git status, line counts and the footer always show. |

## Prompt context

| ID | Spec |
|---|---|
| CTX-01 | The selected file is sent to Claude as context with each prompt. |
| CTX-02 | An `@path` mention in a prompt reveals that file if it is inside the root. |

## Opening files

| ID | Spec |
|---|---|
| OPN-01 | Double-click, Enter, or Ctrl/Shift-click opens a file. |
| OPN-02 | `open` always has a value. It defaults to `preview`, and a blank value counts as `preview`. |
| OPN-03 | With `open: preview`, the file opens in an in-pane viewer that renders Markdown and highlights code, on both surfaces. **Open in app ↗** in the viewer always uses the OS default app. |
| OPN-08 | With `open: app`, the file opens in the OS default app: `open` on macOS, `gio`/`xdg-open` run detached on Linux, PowerShell `Process.Start` on Windows. |
| OPN-04 | The preview refuses files over 4 MB and says when a file is binary. |
| OPN-05 | Any other `open` value is run as a command, with no shell. `{path}` and `{dir}` are replaced. Without `{path}`, the path is added at the end. |
| OPN-06 | The file path is always passed as data, never as shell code. |
| OPN-07 | If opening a file fails, a toast says so. |

## Desktop app

| ID | Spec |
|---|---|
| DSK-01 | Shows a "Right now" card: the current and last action, the branch, ahead/behind, and a change summary. |
| DSK-02 | Shows "Find a file" search. |
| DSK-03 | Shows a "Claude touched" list for the session. It keeps 40 files and shows 8. |
| DSK-04 | Offers an All files / Edited files view menu. |
| DSK-05 | The in-pane file view has "← Back to files" and "Open in app ↗". |
| DSK-06 | The body scrolls natively, and every row is drawn. |
| DSK-07 | A single drawing stays within 60,000 characters. |
| DSK-08 | With `glyphs: auto`, the Desktop app uses plain Unicode glyphs. |

## Input

| ID | Spec |
|---|---|
| INP-01 | `↑`/`↓` and `j`/`k` move. `PgUp`/`PgDn` move 10 rows. `Home`/`End` go to the first or last row. |
| INP-02 | `→`/`l` expands a folder. `←`/`h` collapses a folder or goes to its parent. |
| INP-03 | `Enter` opens a file or toggles a folder. `Space` toggles. |
| INP-04 | `y` copies the relative path and `Y` copies the absolute path. Right-click copies the path; Shift+right-click copies the absolute path. |
| INP-05 | Two clicks within 450 ms count as a double-click. |
| INP-06 | Mouse-wheel scrolling moves at least 3 rows. A click never jumps the view. |
| INP-07 | The pane resizes by mouse, or with the `pane:grow` and `pane:shrink` keybindings. |

## Appearance

| ID | Spec |
|---|---|
| APP-01 | `glyphs: auto` uses Nerd Font icons when a Nerd Font is installed and the terminal started after the install, and over SSH. Otherwise it uses plain Unicode. |
| APP-02 | `icons.ts` maps 28 exact filenames and 64 extensions to icons. |
| APP-03 | With an Omarchy theme present, the pane takes its colours and background and follows a theme switch within 2 s. With no theme, nothing is polled. |

## Settings

| ID | Setting | Values (default first) |
|---|---|---|
| CFG-01 | `activity` | `reads and writes`, `writes`, `reads`, `none` |
| CFG-02 | `glyphs` | `auto`, `nerd`, `plain` |
| CFG-03 | `follow` (terminal only) | `on`, `off` |
| CFG-04 | `column` | `date`, `size` |
| CFG-05 | `open` | `preview`, `app`, or a command |

## Quality

| ID | Spec |
|---|---|
| QA-01 | `claude plugin test .` passes, with no model and no API key. |
| QA-02 | `claude plugin validate` passes for `plugin.json` and for `marketplace.json`. |
| QA-03 | CI runs QA-01 and QA-02 on Ubuntu, macOS and Windows for every push to `main` and every pull request. |
| QA-04 | There is no end-to-end tier. Behaviour that only a real surface paints is covered by a manual checklist, run after a Claude Code upgrade and before a release. |
