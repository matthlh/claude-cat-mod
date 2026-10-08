# claude-mods

One marketplace (`matthlh`), three Claude Code plugins under `plugins/`: `pixel-cat` and `token-tycoon` are mods (function-hook plugins that draw above the prompt), `purple-dark` is a theme.

## Rules

- Never rename the marketplace (`matthlh`) or a plugin (`pixel-cat`, `token-tycoon`, `purple-dark`). Users' installs and saved data are keyed on `<plugin>@matthlh`.
- Move files with plain `git mv` commits, content edits in separate commits, so rename detection carries other branches across.
- Don't add a `CLAUDE.md` inside a plugin folder; the validator warns and it isn't loaded. This file is the only one.
- Plain commit messages, no attribution trailers.

## Check a change

Use the Claude Code binary bundled with the desktop app (the `claude` on PATH may be too old for mods):

```bash
CLAUDE="$HOME/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/Contents/MacOS/claude"
"$CLAUDE" plugin validate .                        # the marketplace
"$CLAUDE" plugin validate plugins/pixel-cat        # one plugin
"$CLAUDE" plugin test plugins/pixel-cat            # its tests
npx -p typescript tsc -p plugins/pixel-cat         # type-check (needs .claude-plugin/types/, written when Claude Code loads the mod)
```

Try a plugin in a session with `claude --plugin-dir plugins/<name>` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A headless check: `claude -p ok --plugin-dir plugins/<name> --debug-file /tmp/d.log`, then grep the log for `hooks module <name>@inline loaded`.

## Layout

- `.claude-plugin/marketplace.json`: the catalog, sources `./plugins/<name>`.
- `plugins/<name>/.claude-plugin/plugin.json`: the plugin manifest. `.claude-plugin/types/` is generated and ignored.
- `plugins/pixel-cat/hooks/engine/` is the lane machinery, `hooks/packs/<pack>/` is one character each (cat, adventurer). See its README for how to add a pack.
- `plugins/purple-dark/themes/purple-dark.json` is the theme; plugin themes are read-only, shown in `/theme` under the file's `name`.
