# Purple Dark 💜

A purple take on the dark Claude Code theme: a lavender accent for Claude's spinner and labels, violet prompt and permission borders, and deep purple message backgrounds.

![Purple Dark: the prompt box, a user message and Claude's label in the theme colours](docs/preview.svg)

## Install

See the [top-level README](../../README.md) for the one-time marketplace setup, then:

```
/plugin install purple-dark@matthlh
```

Then pick it: `/theme` lists **Purple Dark** (marked as from `purple-dark`). Plugin themes are read-only; if you edit it in `/theme`, Claude Code saves your copy to `~/.claude/themes/`.

## Without the plugin

Copy [`themes/purple-dark.json`](themes/purple-dark.json) into `~/.claude/themes/` and pick it in `/theme`, or set `"theme": "custom:purple-dark"` in `~/.claude/settings.json`.

## Tokens

The file overrides these tokens on the `dark` base: `claude` and `claudeShimmer`, `promptBorder` and `promptBorderShimmer`, `permission` and `permissionShimmer`, `suggestion`, `subtle`, `inactive`, `userMessageBackground` and `userMessageBackgroundHover`, `composerSidebarBackground`, `bashMessageBackgroundColor`, `memoryBackgroundColor`, `selectionBg`, `rate_limit_fill` and `rate_limit_empty`, `briefLabelClaude` and `briefLabelYou`. The full token list is in the [custom theme docs](https://code.claude.com/docs/en/terminal-config#create-a-custom-theme).
