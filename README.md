# Dashboard

Ebbe's personal everything app: pages and lists like Notion, with Claude doing the organizing in the background. Claude builds the app one request at a time, from the Ask Claude box inside it.

The app's code is here, in public. Ebbe's data is not: it lives in a private folder on his Google Drive, reached only through his own gateway script. A visitor to the live app without his key sees an empty app.

Live app: https://eloenborg.github.io/dashboard/
On a phone, open it in the browser and add it to the home screen (Safari: Share, Add to Home Screen).

## How it works

1. In the app, type what you want in **Ask Claude**: "add a clock", "show today's weather", "what could go here?".
2. Claude starts at once, in your Claude account. You read the answer in the Claude app on your phone or computer (the app also links to it).
3. If you asked for a change, Claude publishes it. About a minute later, tap **Force update** in Settings, or **Update now** when the app says a new version is online.

Until "Set up Ask Claude" below is done, the box opens the Claude app with your message filled in, and you tap send there. After setup, it sends by itself.

## Set up the data on Google Drive

About 10 minutes, once. This makes a small script in your own Google account, the **gateway**. It is the only way into your data, for the app and for Claude. Google itself limits what it can do:

- **Drive:** only the files and folders the gateway makes itself, which means the "Dashboard data" folder and what is in it. The rest of your Drive is invisible to it. (Files you drop into that folder by hand are invisible too; give those to Claude in chat or through the app.)
- **Gmail:** read only. It can't send, delete, label or move anything.
- **Calendar:** it can see your calendars. It can add or change events only on a new "Dashboard" calendar that it makes itself.

### 1. Make the gateway

1. Go to https://script.google.com and click **New project**. Name it `Dashboard gateway`.
2. Click **Project Settings** (the gear on the left) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the **Editor**:
   - Click `appsscript.json`. Replace everything in it with [gateway/appsscript.json](gateway/appsscript.json) (open it, click **Raw**, copy everything).
   - Click `Code.gs`. Replace everything in it with [gateway/gateway.gs](gateway/gateway.gs), the same way.
   - Click **Save**.
4. Choose `setup` in the function menu at the top and click **Run**. Google asks for permission: **Review permissions**, pick your account, then on "Google hasn't verified this app" click **Advanced** and **Go to Dashboard gateway**.
   - **Check the list Google shows.** It should ask only for these (the wording may differ a little), and nothing broader such as "see, edit and delete all your Google Drive files": the Drive files you use with this app only; reading your email; seeing your calendars; making secondary calendars and managing their events; connecting to an external service. Then click **Allow**.
5. The log at the bottom shows the **APP KEY** and the **CLAUDE KEY**. You need the app key in step 3. You don't need to copy the Claude key now: running `setup` again shows both keys any time.
6. Click **Deploy**, **New deployment**, the gear next to "Select type", **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" means anyone can knock; only someone with a key gets an answer.

### 2. Check it

Optional: choose `testData` and click **Run**. The log says "Revision 0" until the app has saved something.

### 3. Connect the app

On each device you use (phone, computer): open the dashboard, tap the gear for **Settings**, and under **Data on Google Drive** paste the Web app URL and the **APP KEY**. Tap **Save and test**. It should say "Connected. Your data is saved on Google Drive." What the device had before is sent up at once.

Use the app key here, never the Claude key: the app refuses the Claude key.

## Let Claude reach the data

So that Claude's background runs (Ask Claude, the daily brief, tidying your data) can read and organize your data, give them their own cloud environment with the Claude key.

1. Open https://claude.ai/code. Open the environment menu and choose **Add cloud environment**.
2. Name: `Dashboard`.
3. **Network access:** **Custom**. In **Allowed domains**, put these two lines:
   ```
   script.google.com
   script.googleusercontent.com
   ```
   and tick **Also include default list of common package managers**.
4. **Environment variables:**
   ```
   DASHBOARD_GATEWAY_URL=<the Web app URL from step 1>
   DASHBOARD_GATEWAY_KEY=<the CLAUDE KEY from step 1>
   ```
   Only sessions in this environment can read these values, and only you can start sessions in your own environment. Keep using another environment for anything not related to the dashboard.
5. Click **Create environment**. Then use **Dashboard** as the cloud environment of the "Dashboard: Ask Claude" task (below) and of the other dashboard tasks.

If the key ever leaks: in the gateway, run `newKeysAndForgetOld`, then put the new app key on your devices and the new Claude key in this environment.

## Set up Ask Claude

About 10 minutes, once. You need a Claude plan with Claude Code (Pro or Max), a Google account, and this repo in your GitHub account.

### 1. Let Claude work on this repo

1. Open https://github.com/apps/claude, click **Configure** (or **Install**), choose **eloenborg**, pick **Only select repositories**, add **dashboard**, and save.
2. Open https://claude.ai/code (or the **Code** tab in the Claude app). Connect GitHub if it asks. Check that **eloenborg/dashboard** is in the repository list.

### 2. Make the Claude task

1. Go to https://claude.ai/code/routines and click **New task** (it may say **New routine**; if it offers **Set up manually**, choose that).
2. Name: `Dashboard: Ask Claude`.
3. Prompt: copy the text between the two lines in [ask-claude/routine-prompt.md](ask-claude/routine-prompt.md).
4. Trigger: **API**.
5. Under **Advanced settings**: repository **eloenborg/dashboard**, cloud environment **Dashboard** (from "Let Claude reach the data"; **Default** works too, but then Claude can't reach your data). On the **Connectors** tab, keep only connectors you want Claude to use when answering you (for example Google Calendar).
6. Click **Create**. A box shows the **token once**: copy it now and keep it for step 3.
7. On the task's page, open the menu next to its name, choose **Edit**, and copy the **Fire URL** from the API trigger panel.

### 3. Make the relay (Google Apps Script)

The app cannot call Claude's task directly: Anthropic does not accept those calls from web pages, and the token must not sit on your phone or in this public repo. A small script in your own Google account passes your messages on.

1. Go to https://script.google.com and click **New project**. Name it `Dashboard relay`.
2. Delete the sample code. Paste all of [ask-claude/relay.gs](ask-claude/relay.gs) (open it, click **Raw**, copy everything). Click **Save**.
3. Click **Project Settings** (the gear on the left). Under **Script properties**, add two:
   - `FIRE_URL`: the Fire URL from step 2
   - `FIRE_TOKEN`: the token from step 2

   Save.
4. Back in the **Editor**, choose `setup` in the function menu at the top and click **Run**. Google asks for permission: **Review permissions**, pick your account, then on "Google hasn't verified this app" click **Advanced** and **Go to Dashboard relay**, then **Allow**. It is your own script. The log at the bottom shows the **passphrase**. Copy it.
5. Optional check: choose `testFire` and click **Run**. A Claude session starts and answers "The relay works." in the Claude app.
6. Click **Deploy**, **New deployment**, the gear next to "Select type", **Web app**. Execute as: **Me**. Who has access: **Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 4. Connect the app

On each device you use (phone, computer): open the dashboard, tap the gear for **Settings**, and under **Ask Claude connection** paste the Web app URL and the passphrase. Tap **Save and test**. It should say "Connected. Messages go straight to Claude."

## Safety

- The token stays in your Google account (Script properties). The relay address and passphrase stay on your devices. None of them are in this public repo, and the app never puts them in its saved data.
- Anyone with both the relay address and the passphrase could start Claude tasks on your account and change this app. If either leaks: in Apps Script run `newPassphraseAndForgetOld`, then connect your devices again with the new passphrase. To cut the link to Claude completely: claude.ai/code/routines, the task, Edit, delete the API token.
- The relay sends at most 20 messages an hour.
- The code is public. Claude is told never to put personal details or keys in it, and the checks refuse data files. Your data stays on your Google Drive, with a copy on each connected device so the app works offline.
- The gateway can only do what Google lets it (see "Set up the data on Google Drive"). The app key on your devices reaches the data folder only; the Claude key, which can also read mail and calendars, is kept in the Claude environment only.
- Every day's first change saves a backup of your data in the folder's `backups` (kept 30 days).

## For Claude

[CLAUDE.md](CLAUDE.md) holds everything Claude needs: how your requests arrive, how it publishes, the file map, what the app can do, and the rules.

## Where it came from

A copy of Anna's Stratos family tracker ([annakinz/tracking](https://github.com/annakinz/tracking)) made on 23 November 2026, with its screens, its sync and its Gemini agent removed. What is left: the home-screen app setup, offline support, Force update, saved data on the device, and Ask Claude.
