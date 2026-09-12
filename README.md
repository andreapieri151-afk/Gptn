# GPTN

**A modern, Gemini-powered AI desktop app for macOS.**

GPTN is a real desktop application — not a mockup — built with Electron, React and TypeScript.
It talks to Google Gemini directly from the main process, keeps every conversation on your Mac and
stores your API key in the macOS Keychain.

```
┌──────────────────────────────────────────────────────────┐
│  macOS window                                             │
├──────────────┬───────────────────────────────────────────┤
│  GPTN        │  Chat title                model ▾    ⋯   │
│  + New chat  │                                           │
│  ⌘K Search   │            How can I help you?            │
│              │        [Explain] [Code] [Ideas] [Write]   │
│  Today       │                                           │
│   Postgres…  │───────────────────────────────────────────│
│   Résumé…    │  Write a message to GPTN          [ ↑ ]   │
│  Settings    │  Enter to send · Shift+Enter newline      │
└──────────────┴───────────────────────────────────────────┘
```

## Features

**Chat**
- Streaming answers with a discreet `Generating…` state and a **Stop** button that keeps the partial text
- Markdown: headings, lists, quotes, tables (GFM), links opened in your browser
- Code blocks with language label, syntax highlighting and one-click **Copy**
- Copy an answer, regenerate it, or retry after a failure
- `Enter` sends, `Shift + Enter` adds a line
- Conversation titles derived from the first message; rename or delete from the sidebar

**Desktop experience**
- Native macOS menu bar (File / Edit / View / Window / Help), traffic-light window, drag-anywhere title bar
- Light and Dark mode following the system, or pinned in Settings
- Resizable window that remembers its size and position; resizable sidebar
- Shortcuts: `⌘N` new chat · `⌘K` search · `⌘,` settings · `⌘B` sidebar · `⌘⇧C` copy last answer · `Esc` stop
- Very light animations, Retina-ready typography, native font stack

**AI layer**
- Gemini REST API used directly from the main process (streaming via SSE)
- Model picker fed by the API (`models.list`), plus curated defaults and custom model IDs
- Configurable temperature, top-p, max output tokens, system instruction and safety mode
- Optional custom API base URL for proxies or enterprise gateways
- Plain-language errors with an **Open Settings** shortcut and technical details behind a disclosure

**Data**
- Conversations stored locally in `~/Library/Application Support/GPTN/conversations.json` (atomic writes + automatic backup recovery)
- API key encrypted with the macOS Keychain through Electron `safeStorage`
- Export history as Markdown or JSON, import a JSON backup, delete everything from Settings

## Requirements

- macOS 13 Ventura or newer (Apple silicon or Intel) — GPTN 1.0.0 uses Electron 44
  (Chromium 152), whose minimum supported system is macOS 13
- Node.js 20+ and npm (only for building from source)
- A Google Gemini API key — create one in [Google AI Studio](https://aistudio.google.com/apikey)

## Getting started (development)

```bash
git clone https://github.com/andreapieri151-afk/Gptn.git
cd Gptn
npm install
npm run dev          # launches Electron with hot reload
```

Then open **Settings → AI / Gemini**, paste your API key and press **Save**.
GPTN immediately runs a real request to Gemini and reports the latency.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run dev:preview` | Serve the interface in a browser (see “Browser preview”) |
| `npm run typecheck` | TypeScript check for main, preload, renderer and tests |
| `npm test` | Unit + DOM + transport tests (Vitest) |
| `npm run verify` | typecheck → tests → production build |
| `npm run build` | Compile main, preload and renderer into `out/` |
| `npm run icon` | Regenerate the app icon (`build/icon.png`, `.iconset`, `.icns`) |
| `npm run dist:mac` | Build `GPTN.app` + `.dmg` + `.zip` in `release/` |

### Browser preview

`npm run dev:preview` serves the same interface in a browser at <http://localhost:5273>.
This exists only to review layout and interactions: outside Electron there is no Keychain and no
Gemini access, so GPTN switches to a clearly labelled **Preview** mode with scripted answers.
Real answers always come from the desktop app.

## Building a distributable GPTN.app

```bash
npm run dist:mac            # GPTN.app + installer for both architectures
npm run dist:mac:universal  # one universal binary instead of two
npm run dist:dir            # unpacked GPTN.app only (fast smoke test)
```

Artifacts land in `release/`:

| File | What it is |
| --- | --- |
| `GPTN-1.0.0-arm64.dmg` / `GPTN-1.0.0-x64.dmg` | Drag-and-drop installers (Apple silicon / Intel) |
| `GPTN-1.0.0-arm64.zip` / `GPTN-1.0.0-x64.zip` | Zipped `GPTN.app` for the same architectures |
| `GPTN-1.0.0.dmg` / `GPTN-1.0.0.zip` | Same installers after `npm run dist:mac:universal` (renamed by `scripts/rename-artifacts.mjs`) |

`npm run dist:mac` needs network access the first time: electron-builder downloads the official
Electron binary for the target architecture and caches it in the electron-builder cache directory.
The app bundle itself contains only `out/` and `package.json` — no sources, tests or `node_modules`. The first launch of an **unsigned** build requires
right-click → **Open** (or *System Settings → Privacy & Security → Open Anyway*), because macOS
cannot verify the developer.

### Signing and notarising (Apple Developer ID)

GPTN ships ready for a signed, notarised distribution:

1. Export your **Developer ID Application** certificate as a `.p12` and export the password:
   ```bash
   export CSC_LINK=/path/to/developer-id.p12
   export CSC_KEY_PASSWORD='your-p12-password'
   ```
2. Provide notarisation credentials (app-specific password from <https://appleid.apple.com>):
   ```bash
   export APPLE_ID='you@example.com'
   export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
   export APPLE_TEAM_ID='ABCDE12345'
   ```
3. Build: when all three variables are present the `afterSign` hook notarises the app before the
   DMG is written.
   ```bash
   export CSC_LINK=... CSC_KEY_PASSWORD=... APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=...
   npm run dist:mac
   ```

`scripts/notarize.cjs` (the electron-builder `afterSign` hook) submits the app to Apple and waits for
the result; when the credentials are missing it skips notarisation and explains what to set.
Hardened runtime and `build/entitlements.mac.plist` are already configured.

### CI

`.github/workflows/build-macos.yml` builds on a macOS runner (on `v*` tags or manually): it runs
`npm ci`, the typechecks and the tests, then packages `GPTN.app`, the DMG and the ZIP. The installers
are uploaded as workflow artifacts and, for tag builds, attached to the GitHub Release of that tag.
Add the signing/notarisation secrets below to the repository to get signed, notarised builds
automatically; without them the workflow still produces a runnable unsigned build.

### Icon

The icon is generated from vector code by `npm run icon`, which writes:

- `build/icon.png` — 1024×1024 master;
- `build/icon.iconset/` — the standard macOS slice set (for designers, and for `iconutil`);
- `build/icon.icns` — the icon used by the packaged app. GPTN builds this container itself, so
  packaging never depends on `iconutil` (macOS only) or on a remote icon-conversion download.

```bash
npm run icon                      # regenerate everything from scripts/make-icon.mjs
iconutil -c icns build/icon.iconset   # optional: verify the slices on macOS
```

## Architecture

```
src/
├─ shared/        Types, IPC channel names, error mapping, text helpers (used by every process)
├─ main/          Node side of the app — no UI code
│  ├─ index.ts         Window creation, theme, quit/flush lifecycle
│  ├─ ipc.ts           The complete privileged API surface, validated at the boundary
│  ├─ gemini/          GeminiService (conversations, streaming, cancellation) + REST transport + SSE parser
│  ├─ store/           JSON persistence (conversations, settings) and the Keychain secret store
│  ├─ menu.ts          Native macOS menu bar
│  ├─ exporter.ts      Markdown / JSON export
│  └─ logger.ts        Rotating log file for diagnostics
├─ preload/       contextBridge surface (`window.gptn`) — the only thing the UI can reach
└─ renderer/      React UI
   ├─ platform/       Bridge access, browser preview fallback, stream batching
   ├─ state/          Zustand store: the single source of truth for the UI
   ├─ components/     Sidebar, chat, composer, markdown, palette, settings…
   └─ styles/         Design tokens, layout, syntax highlighting theme
```

Separation of concerns:

```
UI  →  State (zustand)  →  window.gptn (IPC)  →  GeminiService  →  Gemini API
                                             └→  Persistence     →  Local JSON + Keychain
```

- No API call lives in a component: components dispatch store actions, the store calls the bridge.
- All privileged work (network, disk, Keychain, dialogs) happens in the main process; the renderer is
  sandboxed with `contextIsolation`, no Node integration and a strict CSP.
- Failures are translated in one place (`src/shared/errors.ts`) into human messages, so the UI never
  shows raw `HTTP 400 INVALID_ARGUMENT` text in the headline.

## Privacy

- Conversations, settings and window state never leave your Mac.
- The API key is encrypted with `safeStorage` (macOS Keychain) and only decrypted in the main process
  to sign requests to Google.
- The renderer cannot reach the internet: the only outbound traffic is the Gemini request made by the
  main process, plus the links you explicitly open.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| “No API key configured” | Settings → AI / Gemini → paste the key → **Save** (GPTN tests it immediately) |
| “Invalid API key” | Check the key in AI Studio; make sure the Generative Language API is enabled for the project |
| “Too many requests” / quota | Wait for the limit to reset, or select a lighter model such as Gemini 2.5 Flash Lite |
| “Model unavailable” | Pick another model in Settings → AI, or add the ID under *Custom model IDs* |
| “Connection problem” | Check your internet connection or VPN/proxy. A proxy can be set under *Advanced → API base URL* |
| macOS refuses to open the app | Unsigned build: right-click → Open. Signed releases do not have this issue |
| `npm run dist:mac` fails while downloading | electron-builder needs to fetch the Electron binary from GitHub the first time; check the proxy/firewall and retry |
| electron-builder fails with `<project folder> not a file` | An **empty** `CSC_LINK` variable is set in your shell (electron-builder reads it as a certificate path); unset it or point it to a valid `.p12` |

Logs are written to `~/Library/Application Support/GPTN/logs/gptn.log`; open them from
**Help → Open Logs Folder**, and **Help → Diagnostics…** copies a summary you can share.

## Tech stack

Electron 44 · React 19 · TypeScript 5.9 · Vite 7 (electron-vite) · Zustand · react-markdown + remark-gfm ·
highlight.js · Vitest + Testing Library · electron-builder.

## License

MIT — the GPTN name, logo and visual identity are original and not derived from any other product.
