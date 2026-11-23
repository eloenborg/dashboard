# Ebbe's dashboard: instructions for Claude

You build and look after this app for Ebbe. Read this file at the start of every session.

## What this is

- A personal dashboard for Ebbe. It starts blank on purpose: "Hello, world." and an Ask Claude box. Ebbe decides what goes on it by asking you.
- Plain HTML, CSS and JavaScript modules. No build step, no packages, no framework.
- A PWA: he can add it to his phone's home screen, and it opens offline after one visit.
- Live at https://eloenborg.github.io/dashboard/ (GitHub Pages). Every push to `main` is checked by `tests/run.mjs` and then published by `.github/workflows/pages.yml`, in about a minute.
- The repo is **public**. See "Rules for a public repo".
- It began as a copy of Anna's Stratos family tracker (github.com/annakinz/tracking) with all its screens, its sync and its Gemini agent removed. Pieces worth borrowing back are under "Ready-made pieces".

## How requests reach you

1. **The Ask Claude box** on the home screen.
   - Connected (normal): the app posts the message to the relay, a Google Apps Script in Ebbe's Google account (`ask-claude/relay.gs`). The relay starts the scheduled task "Dashboard: Ask Claude" in Ebbe's Claude account through its API trigger. That run is you: the message is in the `routine-fire-payload` block.
   - Not connected yet: the box opens the Claude app with the message already typed, and Ebbe taps send.
   - Either way the message starts with a header line "Ask Claude message from Ebbe, typed into his dashboard" plus the time (Copenhagen), the app version on his device, and the device. His words come after the `---` line.
2. **A normal Claude Code session** Ebbe opens himself.

## Requests from the Ask Claude box

These are Ebbe's own requests, made just now. Act on them straight away: no plan for approval, no "shall I start?".

- **A question:** answer it in the session, short and plain. He reads your answer in the Claude app on his phone or computer.
- **A change to the app:** make it, then follow "Publishing a change" below, all the way to the push. Then reply in one or two sentences: what changed, and "It will be online in about a minute. Tap Force update in Settings, or Update now when the app says a new version is online."
- **Unclear:** take the most reasonable reading, do it, and say which reading you took. Stop and ask first only when the change would delete or overwrite something he made (for example data saved on his device), or when it needs an account, a key or money.
- **Needs something only he can do** (sign up for a service, create a key, change a GitHub setting): prepare everything else, then give him numbered steps.

## Publishing a change

1. Make the change.
2. `node tests/run.mjs`: must end with "0 failed".
3. `node tests/browser.mjs`: drives the app in a headless browser if Playwright is installed, and skips itself if not.
4. `node tools/bump.mjs`: raises the version (`BUILD` in `js/version.js`). Do this in every push; the "new version" note and Settings compare it with the copy online.
5. Commit, with a message that says what changed for Ebbe.
6. `git push origin HEAD:main`. The live app follows `main` only. Never force-push.
7. The Actions run "Publish to GitHub Pages" turns green in about a minute. If it fails, read its log, fix, and push again. If the checks fail, nothing is published and the old version stays live.

If a push to `main` is refused, push your branch, open a pull request, and tell Ebbe it needs one tap to merge.

## Files

| File | What it is |
|---|---|
| `index.html` | Both screens: `#screen-home` and `#screen-settings`. New widgets go in `<section id="dashboard">`. |
| `style.css` | All styles. Colors are `:root` variables. |
| `js/app.js` | Startup and screen switching. `#settings` in the address shows Settings. |
| `js/home.js` | Home: hello text, Ask Claude box, recent messages, "new version is online" note. |
| `js/settings.js` | Settings: version and Force update; Ask Claude connection (relay address, passphrase, Save and test). |
| `js/ask.js` | Ask Claude: the message format, the relay calls, the Claude-app fallback link. |
| `js/update.js` | Service worker registration, online version check, Force update. |
| `js/store.js` | Saved data: `state`, `save()`, `changed()`. localStorage key `dashboard.v1`. |
| `js/config.js` | Repo name, owner name, time zone. |
| `js/version.js` | `BUILD`, the version number. |
| `js/ui.js` | Helpers: `$`, `esc`, `safeHref`, time formats. |
| `sw.js` | Service worker: fresh files when online, saved copies when offline. |
| `manifest.webmanifest`, `icon.svg`, `icon-180.png`, `icon-512.png` | Home-screen app name and icons. |
| `fonts/` | Fraunces (titles) and Outfit (everything else), bundled so the app looks the same offline. |
| `ask-claude/relay.gs` | The relay. Ebbe pastes it into Apps Script; the app does not load it. |
| `ask-claude/routine-prompt.md` | The prompt of the scheduled task. Kept short; it points here. |
| `tests/run.mjs` | Required checks, plain Node. Also run by Actions before publishing. |
| `tests/browser.mjs` | Optional browser checks (Playwright). |
| `tools/bump.mjs` | Raises `BUILD`. |
| `.github/workflows/pages.yml` | Check, then publish, on every push to `main`. |

## What must keep working

- **Force update.** It is how Ebbe gets your changes. `forceUpdate()` in `js/update.js` deletes the service worker's caches, fetches every file the page used again with `cache: 'reload'`, unregisters the service worker and reloads. Keep Settings and its Force update button reachable even if the home screen is broken.
- **Ask Claude.** It is how Ebbe reaches you. If you redesign the home screen, keep the box (or a button that opens it) and keep the relay protocol in `js/ask.js` matching `ask-claude/relay.gs`.
- **Fresh files.** GitHub Pages sends `Cache-Control: max-age=600`, so a plain browser fetch can be 10 minutes stale. `sw.js` therefore fetches every file of this site with `cache: 'no-cache'` (a cheap revalidation). Requests with a query string, and other sites, bypass the cache. New files need no list: the service worker saves whatever loads.
- **Escaping.** Put values into `innerHTML` only through `esc()`, and links only through `safeHref()`.

## Data

- Everything the app keeps goes in `state` (`js/store.js`) and stays in localStorage on that device. There is no server and no sync between his devices yet.
- Add new top-level fields to `DEFAULTS`, so older saved data still loads. Call `changed()` after edits; screens listen for `dashboard:changed`.
- localStorage holds about 5 MB. Use IndexedDB for anything big, such as pictures.
- Keys and passwords for services he connects later get their own localStorage key and a field in Settings, as `js/ask.js` does with the relay. Never put them in `state`: `exportJSON()` would include them.

## Rules for a public repo

- Never commit personal data: no family names, addresses, calendars, emails, money, health, photos. Personal data lives on his device (typed into the app, or fetched at run time from his accounts). The code only knows how to show it.
- Never commit secrets: API keys, tokens, the relay address, the passphrase. `tests/run.mjs` fails on the common kinds.
- When a request would need either in the code, build it so Ebbe enters the value in the app instead, and tell him why in one line.

## What you can build here

In the app (it runs in his browser, only while open):

- Anything HTML, CSS and JavaScript can show: clocks, countdowns, lists, notes, timers, charts drawn with SVG or canvas.
- Data from public web APIs that allow calls from web pages (CORS). Example: weather from Open-Meteo, no key needed.
- Data from APIs that refuse web pages, or that need a secret key: add a relay like `ask-claude/relay.gs`, a Google Apps Script that holds the key in its Script Properties.
- His Google data (calendar, mail): either a Google sign-in in the app (he creates an OAuth client ID) or an Apps Script running as him that returns just what the dashboard shows. Agree the plan with him first.
- Offline use and the home-screen app come for free.
- Not possible without a server: notifications while the app is closed, or anything that runs while it is closed.

In your own session, when an Ask Claude message arrives:

- Web search and web fetch, this repo, Node.
- The claude.ai connectors in Ebbe's account (for example Google Calendar or Gmail) if he left them switched on in the scheduled task. Good for answering questions in the session; the app itself cannot use them.

Ready-made pieces in github.com/annakinz/tracking (public, same no-build style). Port only what Ebbe asks for, and adapt it: Stratos assumes two people and a household list.

- **Sync between his devices** without a server of his own: `js/hsync.js` and `apps-script.gs`, with the merge in `js/store.js` (`syncSnapshot`, `applySync`). Encrypted on the device with AES-GCM; a Google Drive file holds only ciphertext.
- **Gemini** (free tier) called from the device: `js/agent.js`.
- **Automatic local backups** with restore: the backup functions in `js/store.js` and the "local backups" part of Settings in `js/views.js`.
- **Bubble UI** with pinch-to-size: `js/bubbles.js`. Visual rules of that app: `DESIGN.md`.

## Set-up status

- Ask Claude needs a one-time setup by Ebbe: README.md, "Set up Ask Claude". Until then the box opens the Claude app instead. If he asks for help with it, walk him through one step at a time; the account steps are his to do.
- Settings shows whether a device is connected. Each device (phone, computer) connects separately.

## Troubleshooting

- **Publish failed:** GitHub, Actions tab, "Publish to GitHub Pages", read the failing step. "Get Pages site failed" or a 404 means Pages is off: repo Settings, Pages, Source "GitHub Actions". Only Ebbe can change that; tell him.
- **Force update shows the old version:** check the Actions run finished; compare https://eloenborg.github.io/dashboard/js/version.js with `js/version.js` on `main`; check that `BUILD` was raised.
- **Relay errors** (shown under the Ask Claude box):
  - "Wrong passphrase": copy it again; running `setup()` in the script prints it.
  - "Claude refused the token": the task's token was regenerated. Put the new one in the relay's `FIRE_TOKEN` script property.
  - "no Claude task yet": `FIRE_URL` or `FIRE_TOKEN` is missing in the relay.
  - "Too many messages this hour": the relay allows 20 per hour; Anthropic allows 30 per hour per task.
  - A 400 answer: the trigger API changed. `relay.gs` sends the beta header `experimental-cc-routine-2026-04-01`; check https://platform.claude.com/docs/en/api/claude-code/routines-fire and update `relay.gs`.
- **You changed `relay.gs`:** Ebbe must paste the new file into Apps Script and publish it as a new version of the same deployment (Deploy, Manage deployments, edit, Version: New version). The address stays the same.
- **An Ask Claude run is waiting:** auto mode blocked an action three times in a row and now asks for approval. Ebbe answers in that session in the Claude app.
- **The fallback link opens Claude without the repo selected:** his Claude GitHub connection does not include `eloenborg/dashboard` (README, step 1).

## Writing to Ebbe

Short, plain sentences. Say what you did and what he does next. No jargon he did not use first.
