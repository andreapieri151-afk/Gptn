# GPTN

A small, calm desktop client for Google Gemini. It sits in your Dock, keeps your conversations on
your own disk, keeps your API key in the Keychain, and otherwise stays out of the way while you type.

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

## What is GPTN?

I wanted a Gemini client that felt like a Mac app rather than a browser tab with extra steps. So GPTN
is just a window: a sidebar on the left, a text field at the bottom, ⌘N for a new chat, ⌘, for
settings, no account to create and no sign-in screen. You paste your own Gemini API key once and it
stays on your machine. There is no GPTN server in the middle — nothing is proxied, and nobody but you
and Google ever sees a conversation.

It's built with Electron, React and TypeScript, which means there's a web engine underneath and I'm
not going to pretend otherwise. What I did care about is that it behaves like a real Mac app: the
menus are the real macOS menus, the window has proper traffic lights and remembers its size and
position, Dark and Light mode follow the system, and nothing in the interface animates unless it's
telling you something.

The other thing I cared about is that the boring paths feel finished. When something goes wrong you
get "Invalid API key" with a button that takes you to the setting that fixes it, not a wall of JSON.
When you press Stop you keep the part of the answer that already arrived. If you quit halfway through
an answer, your history is still there when you come back.

## What it does

**Talking to Gemini**

- The first time you open it, GPTN walks you through the key: a link to create one, a field to paste
  it, and a real request to prove it works before anything is stored. A key that Gemini rejects is
  never saved — you just paste a correct one.
- Answers stream in as they're written, behind a quiet "Generating…", with a **Stop** button that
  keeps the partial text. If you'd rather wait for whole answers, turn streaming off in Settings.
- Models come from your key, not from a hardcoded list — GPTN asks the API what's available and lets
  you pick, or type a custom model ID. Temperature, top-p, max output tokens, system instruction and
  safety mode all live in Settings → AI.
- Markdown is rendered properly: headings, lists, quotes, tables, and code blocks with the language
  label, syntax colours and a Copy button. Any answer can be copied, or asked again.
- Enter sends, Shift + Enter starts a new line.

**Your conversations**

- They're saved locally and restored the next time you open the app. The title comes from your first
  message; you can rename or delete anything from the sidebar.
- ⌘K searches your history, ⌘N starts a fresh chat, Esc stops an answer that's running.
- Export everything as Markdown or JSON, import a JSON backup, or wipe it all from Settings → Data.

**Small things**

- Light, Dark, or follow the system.
- The sidebar is resizable, the window remembers where you left it.
- Real macOS menu bar with the usual roles (⌘, ⌘H, ⌘Q…), plus Help → Diagnostics if you ever need to
  report something.
- Logs stay in the app's data folder, where you'd expect them.

## What it isn't

- Not a ChatGPT clone and not affiliated with any AI company. The name, icon and interface are
  original; Gemini is Google's, I just talk to their API.
- Not a service. No accounts, no sync between Macs, no mobile app, no share links.
- Not a browser wrapper: the UI has no access to Node, to your files, or to your API key.
- Not everything. There are no file attachments, no team workspaces, no agents. It's a good place to
  think with a model, and that's the whole ambition.

## Requirements

- macOS 13 Ventura or newer, Apple silicon or Intel. (GPTN 1.1.0 ships Electron 44 / Chromium 152,
  and that's the oldest macOS it supports — installing it on anything older would just fail to launch.)
- A Google Gemini API key.
- Node.js 20+ and npm, only if you want to build it yourself.

## Install

1. Grab `GPTN-1.1.0-arm64.dmg` (Apple silicon) or `GPTN-1.1.0-x64.dmg` (Intel) from the
   [latest release](https://github.com/andreapieri151-afk/Gptn/releases/latest).
2. Open the DMG and drag **GPTN** into Applications.
3. The first time, right-click the app and choose **Open**, then **Open** again. These builds aren't
   signed with an Apple Developer ID yet, so macOS wants to ask once. After that it opens normally.

GPTN then asks for your Gemini API key on its own screen (see below).

## Your Gemini API key

GPTN doesn't ship with a key, and it never will — it uses yours.

1. Create one in [Google AI Studio](https://aistudio.google.com/apikey). The free tier is enough to
   try it out.
2. On first launch GPTN shows a **Connect Gemini** screen: paste the key and press **Save & test**.
   GPTN makes a real request before storing anything, then tells you which model answered and how
   long it took.
3. Already running? The same thing lives in **Settings → AI / Gemini**, with a **Test connection**
   button next to it. On a proxied or enterprise network you can point GPTN at a different base URL on
   the same screen.

If the key is wrong, nothing is saved and the screen tells you what Gemini answered — including the
raw error behind *Technical details* if you want to see it.

Where the key ends up: the macOS Keychain, via Electron's `safeStorage`, encrypted with a key only
your login session can unlock. It is never written to the repository, never written to the logs, and
never sent anywhere except Google.

## Development

```bash
git clone https://github.com/andreapieri151-afk/Gptn.git
cd Gptn
npm install
npm run dev          # Electron with hot reload
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run dev:preview` | Serve the interface in a browser (see below) |
| `npm run typecheck` | TypeScript check for main, preload, renderer and tests |
| `npm test` | Unit, DOM and transport tests (Vitest) |
| `npm run verify` | typecheck → tests → production build (what CI runs) |
| `npm run build` | Compile main, preload and renderer into `out/` |
| `npm run icon` | Regenerate the app icon (`build/icon.png`, `.iconset`, `.icns`) |
| `npm run dist:mac` | Build `GPTN.app` + `.dmg` + `.zip` into `release/` |

`npm run dev:preview` serves the same interface at <http://localhost:5273>. It's only for looking at
layout and interactions: outside Electron there's no Keychain and no Gemini, so the app switches to a
clearly labelled **Preview** mode with scripted answers. Real answers only ever come from the desktop
app.

## Building GPTN.app

```bash
npm run dist:mac            # GPTN.app + installers for both architectures
npm run dist:mac:universal  # one universal binary instead of two
npm run dist:dir            # unpacked GPTN.app only (fast smoke test)
```

Everything lands in `release/`:

| File | What it is |
| --- | --- |
| `GPTN-1.1.0-arm64.dmg` / `GPTN-1.1.0-x64.dmg` | Drag-and-drop installers (Apple silicon / Intel) |
| `GPTN-1.1.0-arm64.zip` / `GPTN-1.1.0-x64.zip` | Zipped `GPTN.app` for the same architectures |
| `GPTN-1.1.0.dmg` / `GPTN-1.1.0.zip` | The same installers from `dist:mac:universal`, renamed by `scripts/rename-artifacts.mjs` |

The first `dist:mac` needs internet: electron-builder downloads the official Electron binary for the
target architecture and caches it. Inside the app bundle there's only `out/` and `package.json` — no
sources, no tests, no `node_modules`. Because the build is unsigned, the first launch needs
right-click → **Open** (or *System Settings → Privacy & Security → Open Anyway*).

### Signing and notarising

GPTN is already wired for a signed, notarised distribution — the credentials just aren't in the
repository, by design.

```bash
# 1. Your Developer ID Application certificate, exported as a .p12
export CSC_LINK=/path/to/developer-id.p12
export CSC_KEY_PASSWORD='your-p12-password'

# 2. Notarisation credentials (app-specific password from appleid.apple.com)
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='ABCDE12345'

# 3. Build: the afterSign hook notarises the app before the DMG is written
npm run dist:mac
```

`scripts/notarize.cjs` submits the app to Apple and waits for the result; with no credentials it
prints why it skipped and the build carries on unsigned. Hardened runtime and
`build/entitlements.mac.plist` are configured already.

One gotcha worth knowing: an **empty** `CSC_LINK` in your shell is worse than none at all, because
electron-builder reads it as a certificate path and fails with `<project folder> not a file`. Unset it
if you're not signing.

### Continuous integration

Two workflows, both starting with `npm ci`:

| Workflow | When | What it does |
| --- | --- | --- |
| `ci.yml` | every push and pull request | `npm run verify` on Linux: typecheck (main, preload, renderer, tests), the full test suite, the production build |
| `build-macos.yml` | `v*` tags, or manually | the same typecheck and tests on macOS, then `GPTN.app`, the DMG and the ZIP |

The packaging workflow uploads the installers as workflow artifacts and, for tag builds, attaches them
to the GitHub Release of the tag. Add the secrets above to the repository and those builds come out
signed and notarised automatically; without them you still get a working unsigned app. If packaging
fails, the tail of its log is published as a job annotation, so the reason is visible straight from
the checks panel.

### Icon

`npm run icon` writes the icon from vector code: `build/icon.png` (1024×1024 master),
`build/icon.iconset/` (the standard macOS slices, handy for designers and for `iconutil`) and
`build/icon.icns`, which is what the packaged app uses. GPTN builds that ICNS container itself so
packaging never depends on `iconutil` being installed or on a remote icon-conversion download.

## Security and privacy

- Conversations, settings and window state never leave your Mac.
- The API key is encrypted through `safeStorage` (macOS Keychain) and decrypted only in the main
  process, only to sign a request to Google.
- The renderer is sandboxed with `contextIsolation` on, `nodeIntegration` off and a strict
  Content-Security-Policy; it has no access to Node, to the filesystem or to the key. The IPC surface
  is limited to the operations the UI actually uses.
- The renderer can't reach the network. The only outbound traffic is the Gemini request made by the
  main process, plus the links you explicitly open — those open in your browser, not in the app.

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

```
UI  →  State (zustand)  →  window.gptn (IPC)  →  GeminiService  →  Gemini API
                                             └→  Persistence     →  Local JSON + Keychain
```

`secrets.test` accepts an optional key so the first-run screen can verify a key *before* it is stored:
the main process uses it for one request and never writes it to the Keychain unless it answers.

No component ever calls the API: components dispatch store actions, the store calls the bridge. All
privileged work (network, disk, Keychain, dialogs) happens in the main process. Failures are
translated in one place, `src/shared/errors.ts`, so the UI shows a sentence instead of
`HTTP 400 INVALID_ARGUMENT`.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| "No API key configured" | Paste it on the **Connect Gemini** screen, or in Settings → AI / Gemini (GPTN tests it right away) |
| "Invalid API key" | Check the key in AI Studio, and that the Generative Language API is enabled for the project |
| "Too many requests" / quota | Wait for the limit to reset, or switch to a lighter model such as Gemini 2.5 Flash Lite |
| "Model unavailable" | Pick another model in Settings → AI, or add the ID under *Custom model IDs* |
| "Connection problem" | Check your connection, VPN or proxy. A proxy goes under *Advanced → API base URL* |
| macOS refuses to open the app | Unsigned build: right-click → Open. Signed releases don't have this problem |
| `npm run dist:mac` fails while downloading | electron-builder fetches the Electron binary from GitHub the first time; check the proxy/firewall and retry |
| electron-builder fails with `<project folder> not a file` | You have an empty `CSC_LINK` set; unset it or point it at a real `.p12` |

Logs are in `~/Library/Application Support/GPTN/logs/gptn.log`. You can open the folder from
**Help → Open Logs Folder**, and **Help → Diagnostics…** copies a summary you can paste into an issue.

## Tech stack

Electron 44 · React 19 · TypeScript 5.9 · Vite 7 (electron-vite) · Zustand · react-markdown +
remark-gfm · highlight.js · Vitest + Testing Library · electron-builder.

## License

MIT. The GPTN name, icon and visual identity are original and not derived from any other product.
