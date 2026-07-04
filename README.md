# Codex Usage GNOME Extension

Display OpenAI Codex usage in the GNOME Shell top panel.

> Forked from [claude-usage-extension](https://github.com/Haletran/claude-usage-extension) by Haletran. Now maintained by [kevinpita](https://github.com/kevinpita).
>
> The current UI direction was inspired by Dennis van der Stelt's [Claude Code Usage Monitor](https://github.com/dvdstelt/ClaudeCodeUsage), especially its compact panel gauge, projected burn-rate colors, reset captions, and polished popup layout.

## What It Shows

- Shows current usage in the top panel with a circular ring, compact bar, text, or bar plus text
- Displays 5-hour and weekly usage in the dropdown menu
- Displays model-specific limits (e.g. GPT-5.3-Codex-Spark) in the dropdown menu, toggleable in settings
- Colors usage from projected end-of-window burn rate, so amber/red can appear before the limit is reached
- Shows reset countdowns, banked pending resets with their expiry, projected exhaustion estimates, and last refresh time
- Can reflect the 5-hour window, weekly window, or whichever window is most constrained
- Can show used or remaining percentages
- Includes configurable refresh interval, icon style, and optional HTTP proxy

## Requirements

- GNOME Shell 46, 47, 48, 49, or 50
- Codex CLI installed and authenticated so `~/.codex/auth.json` exists

## Installation

### Quick Deploy

From the repository root:

```bash
./update
```

The script copies this repo to:

```text
~/.local/share/gnome-shell/extensions/codex-usage@kevinpita.dev
```

It then recompiles the GSettings schema and ends the current GNOME session with `gnome-session-quit --no-prompt`, so save your work first.

After logging back in, enable the extension if needed:

```bash
gnome-extensions enable codex-usage@kevinpita.dev
```

### Manual Installation

From the repository root:

```bash
install_dir="$HOME/.local/share/gnome-shell/extensions/codex-usage@kevinpita.dev"

rm -rf "$install_dir"
mkdir -p "$(dirname "$install_dir")"
cp -rT "$PWD" "$install_dir"
glib-compile-schemas "$install_dir/schemas"
gnome-extensions enable codex-usage@kevinpita.dev
```

Reload GNOME Shell after installation:

- X11: press `Alt+F2`, type `r`, then press Enter
- Wayland: log out and log back in

## Notes

The extension reads authentication from `~/.codex/auth.json` or `$CODEX_HOME/auth.json`, then requests usage from `https://chatgpt.com/backend-api/wham/usage`.

## Disclaimer

This extension is not affiliated with, funded by, or associated with OpenAI.

## License Notes

This project is currently MIT licensed. The Claude Code Usage Monitor project that inspired the refreshed UI is GPL-2.0-or-later, so source code or assets from that project should not be copied into this repository unless this project is relicensed compatibly or separate permission is granted.
