# Tab Keeping

A Firefox/Zen Browser extension that automatically unloads and closes inactive tabs in two stages — saving RAM without losing your browsing history.

## How it works

| Stage | Action | Default | Applies to |
|-------|--------|---------|------------|
| 1 | **Unload** (discard) — tab stays in bar, content freed from RAM | 30 min inactive | All non-active tabs |
| 2 | **Close** — tab removed entirely | 24h after being unloaded | Unpinned tabs only |

**Protected tabs** (never closed, can be unloaded):
- The currently active tab
- Pinned tabs / Zen Essential tabs

## Installation

### From GitHub Releases (recommended)

1. Download the latest `.xpi` from [Releases](../../releases)
2. Open `about:addons` in Zen/Firefox
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi`

No config changes needed — the extension is signed by Mozilla.

### From source (development)

1. Clone this repo
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** → select `manifest.json`

> Temporary installs are removed on browser restart. For permanent dev installs, set `xpinstall.signatures.required` to `false` in `about:config` (Firefox Developer Edition / Zen only).

## Configuration

Click the extension icon in the toolbar to open settings:

- **Unload after** — minutes of inactivity before a tab is unloaded (min: 1)
- **Close after** — minutes after being unloaded before a tab is closed (min: 1)

Settings are saved immediately and survive browser restarts.

## Development

No build step required — the extension is plain JavaScript.

```bash
# Install web-ext for linting and testing
npm install -g web-ext

# Lint
web-ext lint

# Run in a temporary Firefox profile (auto-reloads on file change)
web-ext run
```

### Releasing

Push a version tag to trigger the GitHub Actions workflow, which signs the extension via the Mozilla AMO API and attaches the `.xpi` to a GitHub Release:

```bash
# Bump version in manifest.json first, then:
git tag v1.2.0
git push origin v1.2.0
```

Required repository secrets: `AMO_API_KEY`, `AMO_API_SECRET` — see [Mozilla's API docs](https://addons-server.readthedocs.io/en/latest/topics/api/auth.html).

## File overview

```
├── manifest.json       Extension manifest (MV2)
├── background.js       Core logic — tab tracking, discard/close timers
├── popup.html/js/css   Settings UI
└── icons/              SVG source + generated PNGs (16, 48, 128px)
```
