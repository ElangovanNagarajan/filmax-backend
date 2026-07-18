# 70 mm Filmax — GitHub Actions hosting (free forever, no card)

The watcher runs as a self-looping GitHub Actions job. A GitHub **Gist** is the
shared mailbox between your phone app and the runner.

```
 PHONE APP ──write──▶ Gist watches.json ──read──▶ Actions runner (checks every 60s,
 PHONE APP ◀─read─── Gist state.json   ◀─write── loops ~5.5h, relaunches itself)
                                │
                                └──▶ TELEGRAM alert on new show
```

## One-time setup

### 1. Create a GitHub account
https://github.com/signup — free, no card.

### 2. Create the Gist (the mailbox)
1. Go to https://gist.github.com
2. Filename: `watches.json`  — content: `[]`
3. Add a second file (button "Add file"): `state.json` — content: `{}`
4. Create **secret** gist.
5. Copy the **Gist ID** from the URL: `https://gist.github.com/<user>/THIS_PART`

### 3. Create a token for the Gist (GH_GIST_TOKEN)
1. https://github.com/settings/tokens?type=beta  → **Generate new token** (fine-grained)
2. Expiration: **No expiration** (or max)
3. Account permissions → **Gists: Read and write**
4. Generate, copy the `github_pat_...` value.

### 4. Push this repo to GitHub
```bash
cd ~/Desktop/ticket-sniper
git init && git add -A && git commit -m "ticket sniper"
# create an EMPTY repo on github.com first, then:
git remote add origin https://github.com/<user>/ticket-sniper.git
git branch -M main && git push -u origin main
```
Repo can be **public** (unlimited free Actions minutes) — no secrets live in the
code; they go in Actions secrets below.

### 5. Add Actions secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add these five:
| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | your bot token |
| `TELEGRAM_CHAT_ID` | your chat id |
| `GIST_ID` | from step 2 |
| `GH_GIST_TOKEN` | from step 3 |

(`GITHUB_TOKEN` is provided automatically — no need to add it.)

### 6. Start it
Repo → **Actions** tab → enable workflows → select **ticket-watch** → **Run workflow**.
It will now loop and relaunch itself forever.

## Notes
- Interval is 60s by default (keeps the workload light per GitHub's terms). Change
  `INTERVAL_SEC` in `.github/workflows/watch.yml`.
- The phone app talks to the Gist directly (GIST_ID + a read/write gist token
  baked into the app config), so no always-on web server is needed.
- To pause everything: Actions tab → disable the `ticket-watch` workflow.
