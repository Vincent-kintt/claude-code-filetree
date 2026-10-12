# filetree spec list

Each spec is one checkable statement. The IDs are stable, so tests and pull requests can refer
to them. To install and use the plugin, see the [main README](../README.md).

## Platform and requirements

| ID | Spec |
|---|---|
| PLT-01 | Runs on Claude Code 2.1.287 or newer. |
| PLT-02 | Runs on macOS, Linux and Windows. |
| PLT-03 | Does not load in Desktop app WSL sessions. |
| PLT-04 | In the terminal, opens only in the fullscreen layout with at least 110 columns, both from `/filetree` and when it docks itself at session start. |
| PLT-05 | The Desktop app docks the pane by itself, and `/filetree` reopens it. |
| PLT-06 | Has no npm dependencies: all I/O goes through the `claude-code` host API. |
| PLT-07 | Runs `git`, `du`, `find`, `uname`, and on macOS `touch` and `rm` for change markers. The font probe runs `sh -c` with `fc-list`, `ls`, `stat`, `ps` and other POSIX tools. Under herdr it runs `herdr --version`. To open files it runs `open` on macOS, `sh -c` with `setsid`, `gio` or `xdg-open` on Linux, `powershell` on Windows, or the command set in `open`. Windows uses no `find`, `du` or `sh`. `gh` commands are parsed but never run. |
| PLT-08 | Mouse clicks under herdr need herdr 0.9.1 or newer. On older versions the rows ignore the mouse. |

## Tree

| ID | Spec |
|---|---|
| TRE-01 | The root is always the cwd. It follows the cwd when it changes, including after `cd`, `pushd` and `popd` in Bash, and after `/clear`, resume or fork. A double-click or Ctrl/Shift-click on a folder only toggles it. |
| TRE-03 | Lists directories first, then files, in numeric-aware, case-insensitive name order. |
| TRE-04 | Search matches relative paths as a case-insensitive substring, including in folders that haven't been opened yet. It reveals at most 60 matches from folders you haven't opened, even when they're all in one folder; a folder you opened shows all its matches. |
| TRE-05 | Inside a git repo, the search index is the tracked and untracked files under the cwd, minus git's standard excludes (`.gitignore`, `.git/info/exclude`, the global excludes file), at any depth. |
| TRE-06 | Outside a git repo, the search index skips `.git`, `node_modules`, `target`, `.venv`, `__pycache__`, `dist` and `.next`, and goes 6 levels deep (3 at a disk root). At the home folder or a disk root it also skips `Library`, `AppData` and `.Trash`. `find` stays on one filesystem; on Windows a listing walk follows linked folders and stops after the folder that reaches 20,000 files. |
| TRE-07 | Hidden files are always shown, in the muted colour unless a git status colours them. |
| TRE-08 | The right column shows file dates, or sizes when the `column` setting is `size`. Folders show no date, and a changed file shows its `+N -N` instead of its date. A pane narrower than 40 columns hides the dates, so the names get the room; sizes and `+N -N` still show. |
| TRE-09 | Folder sizes come from `du`, or from a summed listing on Windows. They are computed in the background for visible rows, 2 jobs at a time. `du` has a 15 s timeout; the Windows listing gives up after 50,000 entries. |
| TRE-10 | Folder sizes are recomputed after a write. |
| TRE-11 | A newer directory listing is never overwritten by an older one. A failed listing keeps the cached rows. |

## Git

| ID | Spec |
|---|---|
| GIT-01 | Every changed file and folder shows a status colour; clean files show none. Files and folders use the same order, U > D > M > T > R > C > A > ?: a file takes the strongest of its index and worktree status, and a folder takes its strongest child's. |
| GIT-02 | Each modified file shows `+N -N` lines changed against `HEAD`. Folders and the header show the sum for what is under them. New files show none. |
| GIT-03 | Each folder with changes shows `?:N M:N D:N` counts: new (untracked or staged-added), modified (renames included) and deleted. A clean folder shows no counts. The header says "clean" when nothing in the root changed. |
| GIT-04 | The header shows the branch, its upstream, and ahead/behind counts. |
| GIT-05 | All git calls use `--no-optional-locks -C <root>` and are limited to the cwd. |
| GIT-06 | Outside a repo, only `git rev-parse` runs. |
| GIT-07 | A change to the cwd's `.git/index` or `HEAD` triggers a git refresh 300 ms after the last change in a burst. The watch follows the cwd, and outside a repo it catches a `git init`. |
| GIT-08 | Git refreshes never overlap. Requests that arrive during a refresh run as one follow-up. |

## Claude activity

| ID | Spec |
|---|---|
| ACT-01 | A file Claude reads or searches shimmers purple: with the Read, Grep or Glob tool, or with Bash `rg`, `grep`, `egrep`, `fgrep`, `find`, `fd`, `fdfind`, `cat`, `head`, `tail`, `bat`, `less`, `more`, `ls`, `eza`, `tree`, `wc`, `sed` (without `-i`), `awk` or `jq`. For the search tools and for `rg`, `grep`, `egrep`, `fgrep`, `find`, `fd` and `fdfind`, the files they list count too. A Bash command or search lights at most 12 of them (folders included, for `ls dir`), and each Read call lights its own file; writes (ACT-02) have no such cap. |
| ACT-02 | A file Claude writes with Edit, Write or NotebookEdit shimmers orange. A file a Bash command changes shimmers orange too, or, when the command holds a git or `gh` action with evidence it succeeded (ACT-07), every file it changed takes the colour of its first such action other than commit, push and add: blue for checkout, switch, branch, pull, fetch and clone; red for reset, restore, revert, rm and `checkout -- <file>`; purple for merge, rebase, cherry-pick and tag; green for init; and for `gh`, blue for pr checkout and repo clone, purple for the rest. A failed or denied edit doesn't shimmer. |
| ACT-03 | After a commit or `git add` with evidence it succeeded (ACT-07), its files shimmer green, at most 12: a commit's files, or the staged files under the paths `git add` named (all staged files for `.`, `-A`, `-u` or a glob). The branch row flashes in the action's colour on push (teal), pull and fetch (blue), checkout, switch and branch (blue), merge, rebase and tag (purple) and the `gh` commands ACT-07 knows, and green on a commit alone. |
| ACT-04 | A shimmer lasts 2.7 s. |
| ACT-05 | Collapsed folders open to reveal a touched file. |
| ACT-06 | Terminal only. With `follow: on`, the view scrolls to the touched file. With `follow: off` it doesn't scroll, but the shimmer still shows. In the Desktop app the app does the scrolling, so `follow` has no effect there. |
| ACT-07 | The footer shows these as running, then done or failed: git commit, push, pull, fetch, checkout, switch, branch, merge, rebase, cherry-pick, stash, reset, restore, revert, add, rm, mv, tag, init and clone, and `gh` pr create, merge, checkout, comment and review, release create, issue create and repo clone. Done needs evidence: a new `HEAD` for a commit, otherwise the host's report or a zero exit from a plain `&&` chain. Failed needs a commit with no new `HEAD`, or a single command that exits non-zero. Anything else is taken off the footer. |
| ACT-08 | A background git command stays "running" until its task notification arrives. If none arrives within 10 minutes, it is hidden from the footer. |
| ACT-09 | A failed Bash command still triggers a refresh. |
| ACT-10 | Footer activity left running when a session was interrupted is marked failed when the session restarts. |
| ACT-11 | The `activity` setting decides which shimmers show, including the branch-row flash, and which file activity the Desktop card and touched list record. Git status, line counts and the footer always show. |

## Prompt context

| ID | Spec |
|---|---|
| CTX-01 | The selected file is sent to Claude as context with each prompt. |
| CTX-02 | An `@path` mention in a prompt reveals that file if it is inside the root, and moves the cursor to it whatever `follow` is set to. |

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
| OPN-07 | If the opener fails to start or exits non-zero, a toast says so. On Linux every opener, custom commands included, runs detached, so only failures in its first second count. On macOS and Windows a custom command that waits longer than 10 s (like `code --wait`) is reported as failed. A file the preview can't read gets a note in the viewer, not a toast. |

## Desktop app

| ID | Spec |
|---|---|
| DSK-01 | Shows a card with Claude's current action, or its last one when nothing is running, marked RIGHT NOW, DONE, FAILED or IDLE. Below it: the branch with ahead/behind, and a change summary. |
| DSK-02 | Shows "Find a file" search. |
| DSK-03 | Shows a "Claude touched" list. It keeps 40 files and shows the first 8 inside the root, with a "+N more" line. A folder is badged `DIR`. |
| DSK-04 | Offers an All files / Edited files view menu. |
| DSK-05 | The in-pane file view has "← Back to files" and "Open in app ↗". |
| DSK-06 | The body scrolls natively, and every row is drawn, up to the cap in DSK-07. |
| DSK-07 | The file view and the tree each stay within 60,000 serialized characters. A long file is cut at a line break, and a big tree keeps the rows centred on the cursor (or the top rows, when the cursor isn't among them) and says how many it left out above and below. |
| DSK-08 | With `glyphs: auto`, the Desktop app uses plain Unicode glyphs. |
| DSK-09 | From 280 px wide, nothing spills out of its box: long text ends in an ellipsis, the change summary wraps under the branch, and no two texts in a row run together. A touched file name too long for its row ends in an ellipsis too. |

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
| APP-01 | In the terminal, `glyphs: auto` uses Nerd Font icons over SSH, or when a Nerd Font is installed and the terminal started after the install. On Windows outside SSH, and always in the Desktop app, it uses plain Unicode. |
| APP-02 | `icons.ts` maps 28 exact filenames and 64 extensions to icons. |
| APP-03 | With an Omarchy theme present, the pane takes its colours and background and follows a theme switch within 2 s. A theme installed mid-session is picked up on the next resync. With no theme, nothing is polled. |

## Version

| ID | Spec |
|---|---|
| VER-01 | `/filetree` replies with the loaded version (`filetree <version>: File tree on …`), and the Desktop pane ends with it in a dim line. `hooks/version.ts` matches `plugin.json`, which the pre-commit hook checks. |

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
| QA-03 | QA-01 and QA-02 run locally on macOS, through the pre-commit hook, before each commit that touches the plugin. There is no CI. |
| QA-04 | `node scripts/check-desktop-layout.ts` renders the Desktop scenes in headless Chrome at 280, 360 and 480 px, fails on DSK-09, and saves screenshots. It mirrors the app's layout; it is not the app's renderer. |
