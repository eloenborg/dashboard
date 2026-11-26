# Ebbe's dashboard: instructions for Claude

You build and look after this app for Ebbe. Read this file at the start of every session.

## What this is

- Ebbe's personal "everything app": a Notion-like workspace (pages, lists, records) where the organizing is done by you, not by him. He writes and drops things in; you work out what kind of thing each item is, which fields it needs, what it relates to (across pages), and what state it is in. A wanted item becomes owned, a stocked item runs low, and so on. Then you show it in useful views, kept or one-off. Also a daily brief and a quick-look "today" view, and help with his calendar.
- Any concrete example Ebbe gives (a hobby collection, a shopping list, a weekend plan) shows a pattern. It is not a feature to build. Build the general pattern.
- It must have a proper phone layout AND a proper desktop layout.
- Plain HTML, CSS and JavaScript modules. No build step, no packages, no framework.
- A PWA: he can add it to his phone's home screen, and it opens offline after one visit.
- Live at https://eloenborg.github.io/dashboard/ (GitHub Pages). Every push to `main` is checked by `tests/run.mjs` and then published by `.github/workflows/pages.yml`, in about a minute.
- The repo is **public**. See "Rules for a public repo" and "Ebbe's data: Google Drive only".
- It began as a copy of Anna's Stratos family tracker (github.com/annakinz/tracking) with all its screens, its sync and its Gemini agent removed. Pieces worth borrowing back are under "Ready-made pieces".

## How requests reach you

1. **The Ask Claude box** on Today.
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
| `index.html` | Every screen (`.screen`): Today `#screen-home`, a page, a view, Pages, Search, Settings; the sidebar (computer), top bar and tab bar (phone), the item panel. |
| `style.css` | All styles. Colors are `:root` variables. Phone below 900px, computer from 900px; views adapt with container queries. |
| `js/app.js` | The shell: addresses (`#today`, `#p/<id>`, `#r/<id>`, `#v/<id>`, `#pages`, `#search`, `#settings`, `#ask`), the page tree, top bar, tab bar, sidebar, item panel, search. |
| `js/model.js` | The general building blocks: item kinds, block types, field types, view archetypes; making and finding pages, records and views; filters, sorting, search, backlinks. |
| `js/editor.js` | The page editor: blocks, Markdown shortcuts, the "/" menu, pasting lines as blocks, block and page menus. |
| `js/views.js` | View archetypes (table, board, list, gallery, checklist) and one-off `result` views; how values are shown. |
| `js/record.js` | One item: side panel (computer) or full screen (phone), with an editor per field type. |
| `js/home.js` | Today: greeting, daily brief, pinned pages and views, recent pages, Ask Claude box, "new version is online" note. |
| `js/sample.js` | The made-up sample page (Settings, "Try it out"). Neutral on purpose. |
| `js/settings.js` | Settings: version and Force update; Drive connection; Ask Claude connection; sample. |
| `js/ask.js` | Ask Claude: the message format, the relay calls, the Claude-app fallback link. |
| `js/update.js` | Service worker registration, online version check, Force update. |
| `js/store.js` | Small per-device state (`state`, recent Ask Claude messages) and `uid()`. localStorage key `dashboard.v1`. |
| `js/config.js` | Repo name, owner name, time zone. |
| `js/version.js` | `BUILD`, the version number. |
| `js/theme.js` | Light or dark colours (dark by default), set before the page draws. A plain script in `<head>`, per device. |
| `js/ui.js` | Helpers: `$`, `esc`, `safeHref`, time formats. |
| `sw.js` | Service worker: fresh files when online, saved copies when offline. |
| `manifest.webmanifest`, `icon.svg`, `icon-180.png`, `icon-512.png` | Home-screen app name and icons. |
| `fonts/` | Fraunces (titles) and Outfit (everything else), bundled so the app looks the same offline. |
| `js/data.js` | His data: items, the device copy (IndexedDB), the outbox and syncing through the gateway. |
| `gateway/gateway.gs`, `gateway/appsscript.json` | The gateway to his Drive data folder, mail (read) and calendars. Ebbe pastes both into Apps Script. |
| `tools/data.mjs` | Your door to the data, mail and calendars in a session (Claude key). |
| `ask-claude/relay.gs` | The relay. Ebbe pastes it into Apps Script; the app does not load it. |
| `ask-claude/routine-prompt.md` | The prompt of the scheduled task. Kept short; it points here. |
| `tests/run.mjs` | Required checks, plain Node. Also run by Actions before publishing. |
| `tests/fake-google.mjs` | A stand-in for Google, so the gateway can be tested in Node. |
| `tests/browser.mjs` | Optional browser checks (Playwright). |
| `tools/bump.mjs` | Raises `BUILD`. |
| `.github/workflows/pages.yml` | Check, then publish, on every push to `main`. |

## What must keep working

- **Force update.** It is how Ebbe gets your changes. `forceUpdate()` in `js/update.js` deletes the service worker's caches, fetches every file the page used again with `cache: 'reload'`, unregisters the service worker and reloads. Keep Settings and its Force update button reachable even if the home screen is broken.
- **Ask Claude.** It is how Ebbe reaches you. If you redesign Today, keep the box (or a button that opens it; the phone's Ask tab and `#ask` go to it) and keep the relay protocol in `js/ask.js` matching `ask-claude/relay.gs`.
- **Both layouts.** Check every change at phone size (390px) and computer size (1280px). `tests/browser.mjs` drives both.
- **Fresh files.** GitHub Pages sends `Cache-Control: max-age=600`, so a plain browser fetch can be 10 minutes stale. `sw.js` therefore fetches every file of this site with `cache: 'no-cache'` (a cheap revalidation). Requests with a query string, and other sites, bypass the cache. New files need no list: the service worker saves whatever loads.
- **Escaping.** Put values into `innerHTML` only through `esc()`, and links only through `safeHref()`.

## The workspace: kinds of items

All in `js/model.js`; this is the contract between the app and your background runs. Every item also has `id`, `kind`, `updatedAt` (see `js/data.js`).

- `page` `{ title, icon, parent, order, pinned, blocks: [{ id, type, text, checked, view, ref }] }`. Block types: `text h1 h2 h3 bullet number todo quote callout code divider`, plus `view` (shows view item `view`), `page` (links to page `ref`) and `record` (links to record `ref`).
- `type` `{ name, plural, icon, titleLabel, fields: [{ key, label, type, options, to, unit, currency }] }`. Field types: `text number quantity money date status select tags checkbox rating url link image`. `status`/`select` options are strings or `{ key, label, color }` (green, amber, red, blue, grey, purple). `link` fields point at records (of type `to`). Money is `{ amount, currency }`.
- `record` `{ type, title, values: { key: value }, links: [{ to, rel }], notes }`. Use `links` for relations that are not a field.
- `view` `{ title, archetype, source: { type, filter: [{ field, op, value }], sort: [{ field, dir }], group }, show: [keys], keep, page, pinned, result }`. Archetypes: `table board list gallery checklist`. Filter ops: `is not in has empty notEmpty lt gt contains`. A one-off view has `keep: false`; a researched one carries `result: { columns: [{ key, label, type }], rows: [{...}], note, sources: [{ title, url }], at }` instead of a record source (column type `url` links out, `ref` links to an item).
- `brief` `{ date: 'YYYY-MM-DD', title, summary, sections: [{ title, items: [{ text, url, source }] }] }`. Today shows the newest.
- `pinned: true` on a page or view puts it on Today.

When you organize his data: make a `type` per kind of thing, with the fields it needs and status options for its states; turn loose lines on his pages into `record`s (keep his words in `title` and `notes`); link related records; add `view`s and put `view` blocks on the pages where the items came from, so his page still reads well. Don't delete his writing unless it is now fully shown by a view on the same page.

## Saved data in the app

- His workspace (pages, records, types, views, briefs) goes through `js/data.js`: `get`, `all(kind)`, `put`, `patch`, `remove`. Screens listen for `dashboard:data` (changes) and `dashboard:sync` (sync status).
- Small per-device app state (recent Ask Claude messages) is `state` in `js/store.js`, in localStorage. Add new top-level fields to `DEFAULTS`, so older saved data still loads, and call `changed()` after edits; screens listen for `dashboard:changed`.
- Keys and passwords get their own localStorage key and a field in Settings, as `js/ask.js` (relay) and `js/data.js` (gateway) do. Never put them in `state` or in the workspace.

## Ebbe's data: Google Drive only

THIS IS CRITICAL. Everything Ebbe puts in the app, and everything you work out from it, lives in a private "Dashboard data" folder on his Google Drive. It never goes in this repo or on GitHub in any form: not in code, tests, sample data, file names, commit messages, pull requests or issues.

- **The gateway** (`gateway/gateway.gs`, a Google Apps Script in his account) is the only way in. Google enforces its permissions (`gateway/appsscript.json`): Drive files it created only (the data folder), Gmail read-only, all calendars read-only, and full control only of calendars it created (the "Dashboard" calendar). Do not widen these scopes or switch to `DriveApp`/`GmailApp`/`CalendarApp`; the tests fail if you do. Changing them needs Ebbe's agreement first.
- **Two keys.** The app key is on his devices and reaches the data only. The Claude key can also read mail and calendars and lives only in the Claude task's environment settings (`DASHBOARD_GATEWAY_URL`, `DASHBOARD_GATEWAY_KEY`).
- **The format.** One file, `workspace.json`: a flat set of items `{ id, kind, updatedAt, ... }`. The gateway adds `rev`, `by` (`app` or `claude`), `createdAt` and `createdBy`. The newer `updatedAt` wins. A delete is a tombstone `{ id, kind, deleted: true }`. The day's first write saves a backup in `backups/` (kept 30 days).
- **In your session**, use `node tools/data.mjs` (run it without arguments for help): `pull` writes everything to `~/dashboard-data/workspace.json`, outside the repo. Edit copies of items there and `push` them. `mail-search`, `mail-get`, `calendars` and `events` read. `event-put` and `event-delete` work on the Dashboard calendar only. Never copy data into the repo directory, and delete `~/dashboard-data` when you are done.
- **Not set up yet?** If `DASHBOARD_GATEWAY_URL` is missing, say so and point Ebbe to README, "Let Claude reach the data". If the gateway can't be reached, the task's cloud environment must allow `script.google.com` and `script.googleusercontent.com` (README, same section). Don't fall back to the claude.ai Google connectors: Ebbe chose not to give them access.
- **On each device**, the app keeps a copy in IndexedDB so it works offline, and syncs through the gateway (`js/data.js`).

## Generic code, private definitions

The code holds only general building blocks; everything specific is data on Drive.

- In the code: block types (text, heading, list, to-do, …), view archetypes (list, table, board, gallery, checklist, calendar, timeline, chart, comparison, brief, …), field types (text, number, date, money, quantity, status, link to another record, URL, tag, …), and the logic to show and edit them on phone and desktop.
- On Drive, as items: record types and their fields, records, links between them, pages, and view definitions (which records, filter, grouping, sort, archetype, and for a one-off view its result).
- When Ebbe asks for a view that no archetype covers, add a new general archetype with a neutral name, and test it with neutral sample data ("Sample item", "Type A"). Then make the specific view as a data item on Drive.
- Never name his hobbies, people, places, products or anything else from his data in code, tests, sample data, commit messages or PRs. Describe changes in general terms: "Add a comparison view", not what he compared.

## Rules for a public repo

- Never commit personal data: no family names, addresses, calendars, emails, money, health, photos, and nothing from his workspace. Personal data lives on his Drive (and in each device's copy). The code only knows how to show it.
- Never commit secrets: API keys, tokens, the relay address, the passphrase, the gateway address or keys. `tests/run.mjs` fails on the common kinds.
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
- His data, mail (read only) and calendars through `node tools/data.mjs` (see "Ebbe's data: Google Drive only"). Not the claude.ai Google connectors: Ebbe chose not to give those access.

Ready-made pieces in github.com/annakinz/tracking (public, same no-build style). Port only what Ebbe asks for, and adapt it: Stratos assumes two people and a household list.

- **Gemini** (free tier) called from the device: `js/agent.js`.
- **Automatic local backups** with restore: the backup functions in `js/store.js` and the "local backups" part of Settings in `js/views.js`.
- **Bubble UI** with pinch-to-size: `js/bubbles.js`. Visual rules of that app: `DESIGN.md`.

## Set-up status

- The data on Drive needs a one-time setup by Ebbe: README.md, "Set up the data on Google Drive". Until a device is connected, what he adds stays on that device.
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
- **Gateway errors:** "Wrong key": copy the key again (running `setup()` in the gateway prints both). "not set up yet": run `setup()`. "Google refused: no permission": the call needs a scope the gateway does not have, and that is on purpose; find another way or ask Ebbe.
- **You changed `gateway.gs` or `appsscript.json`:** Ebbe must paste the new file into Apps Script and deploy a new version of the same deployment, as with the relay. If the scopes changed, he also runs `setup()` once and approves the new permission screen.
- **You changed `relay.gs`:** Ebbe must paste the new file into Apps Script and publish it as a new version of the same deployment (Deploy, Manage deployments, edit, Version: New version). The address stays the same.
- **An Ask Claude run is waiting:** auto mode blocked an action three times in a row and now asks for approval. Ebbe answers in that session in the Claude app.
- **The fallback link opens Claude without the repo selected:** his Claude GitHub connection does not include `eloenborg/dashboard` (README, step 1).

## Writing to Ebbe

Short, plain sentences. Say what you did and what he does next. No jargon he did not use first.
