#!/bin/sh
# Installs this checkout as the filetree plugin, so a new session loads exactly what is on disk.
# The install is a copy taken now, so run it after every change you want to see in a session.
#   1. bumps the patch version (plugin.json, hooks/version.ts, README badge), so /filetree shows which build is loaded
#   2. reinstalls the plugin from this folder
#   3. deletes the cached copies of older versions, which a running session could still load
# Usage: scripts/dev-install.sh [--no-bump] [--config key=value ...]
# A reinstall resets the plugin's settings; pass them again with --config, e.g. --config column=size.
set -e
cd "$(dirname "$0")/.."
CLAUDE=claude
[ -x "$HOME/.local/bin/claude" ] && CLAUDE="$HOME/.local/bin/claude"
PLUGIN=filetree@claude-code-filetree
CACHE="$HOME/.claude/plugins/cache/claude-code-filetree/filetree"

bump=1
[ "$1" = "--no-bump" ] && { bump=0; shift; }

old=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json)
new=$old
if [ $bump = 1 ]; then
  new=$(printf '%s\n' "$old" | awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 1 }')
  perl -pi -e "s/\"version\": \"\Q$old\E\"/\"version\": \"$new\"/" .claude-plugin/plugin.json
  perl -pi -e "s/VERSION = '\Q$old\E'/VERSION = '$new'/" hooks/version.ts
  perl -pi -e "s/badge\/version-\Q$old\E-blue/badge\/version-$new-blue/" README.md
  echo "version $old -> $new"
fi

"$CLAUDE" plugin validate .claude-plugin/plugin.json >/dev/null || { "$CLAUDE" plugin validate .claude-plugin/plugin.json; exit 1; }
"$CLAUDE" plugin marketplace update claude-code-filetree >/dev/null
"$CLAUDE" plugin uninstall "$PLUGIN" >/dev/null 2>&1 || true
"$CLAUDE" plugin install "$PLUGIN" "$@"

for dir in "$CACHE"/*/; do
  [ "$(basename "$dir")" = "$new" ] || { rm -rf "$dir"; echo "removed old cache $(basename "$dir")"; }
done

diff -rq hooks "$CACHE/$new/hooks" >/dev/null || { echo "the installed copy at $CACHE/$new differs from hooks/"; exit 1; }
echo "installed filetree $new. Start a new session; /filetree should reply \"filetree $new: ...\"."
