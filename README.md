# Claude Cat Mod 🐱

A tiny pixel-art cat that lives above your [Claude Code](https://claude.com/claude-code) prompt. It wanders around, watches your usage limits, and tells you when Claude finishes.

![Claude cat poses: walk, walk 2, sit, happy, sleep](docs/preview.svg)

## What it does

- **Wanders** back and forth above the prompt, sits down now and then, and blinks.
- **Runs while Claude works**, with a speech bubble showing the current tool (`‹Bash…›`).
- **Announces when a turn finishes** (`‹done! 42s›`), plus a toast for turns longer than 20 seconds.
- **Reacts to failures** with a `>.<` face when a tool call errors.
- **Tracks your limits:** shows your 5-hour, 7-day and context usage in green, yellow or red. It gets sleepy at 80% of the 5-hour limit and sends a toast at 75% and 90%.
- **Naps** after 5 minutes of inactivity and wakes up on your next prompt.
- **Pet** button (it purrs) and **Hide** button.
- **`/cat`** toggles it and prints your current limits and when the 5-hour window resets.

In the Claude desktop app it's drawn as a crisp SVG. In the terminal it's drawn with colored half-block characters.

## Install

You need a Claude Code version that supports mods (October 2026 or later).

```bash
git clone https://github.com/matthlh/claude-cat-mod ~/.claude/mods/claude-cat
```

**For one session:**

```bash
claude --plugin-dir ~/.claude/mods/claude-cat
```

**For every session**, including the desktop app, add this to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<you>/.claude/mods/claude-cat"
  }
}
```

`CLAUDE_CODE_PLUGIN_DIRS` takes absolute paths. If you already load other plugin folders, separate them with `:`.

## Customize

The sprites are 12×10 grids of letters in [`hooks/register.tsx`](hooks/register.tsx):

| Letter | Color |
| --- | --- |
| `o` | fur (Claude orange) |
| `d` | shade |
| `H` / `K` | eye shine / eye |
| `r` | blush |
| `n` | nose |
| `w` | chest |

Edit the grids or the `PALETTE` to make a tuxedo, calico or black cat. In an interactive session, saving the file hot-reloads the mod.

Check your changes with:

```bash
claude plugin validate ~/.claude/mods/claude-cat
```

## Heads-up

Mods run with the same access to your machine as Claude Code itself; they are not sandboxed. This one only reads session usage and draws UI, but read any mod before you install it.

## License

MIT
