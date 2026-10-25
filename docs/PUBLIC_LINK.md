# Getting a public URL

Two routes. Pick by how much time you have.

---

## Route A — a public URL in about 90 seconds (do this first)

A Cloudflare quick tunnel. No account, no signup, no card.

```bash
brew install cloudflared          # one time, ~30s

# terminal 1 — the app, in production mode so it is fast
cd ReliefRelay
npm run build
npm start

# terminal 2
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://something-random-words.trycloudflare.com`. **That is your public
link.** Paste it into Devpost's "Try it out" field and open it on your phone to check.

**The honest caveat, which you should know before you rely on it:** this tunnel lives only as long
as that terminal is open and your laptop is awake. If a judge opens the link tomorrow with your
machine asleep, it will be dead. For the submission deadline it is the fastest thing that works.
For judging afterwards, do Route B as well.

Keep your laptop plugged in and awake (`caffeinate -d` in a third terminal on macOS) while judging
is open.

---

## Route B — a durable deployment (do this after you have submitted)

**Render** is the shortest path, and the **Free** instance type is enough. Free instances have no
persistent disk, which sounds fatal for a SQLite app — it is not, because the app seeds itself. Every
cold start comes up as a clean, fully populated district. For a fictional demonstration dataset that
is the correct behaviour, not a compromise.

1. render.com → New → Web Service → connect this GitHub repo, branch `claude/happy-knuth-hg1or1`.
2. Instance type: **Free**.
3. Build command: `npm ci --include=dev && npm run build`
4. Start command: `npm run start`
5. **Do not add a Disk.** Free instances do not support one, and the app does not need one.
6. Environment variables:

   ```
   NODE_VERSION=22
   RELIEFRELAY_DB_PATH=/tmp/reliefrelay.db
   EMERGENCY_NUMBER=112
   EMERGENCY_LABEL=Local emergency services (fictional demonstration)
   ```

   Two of these settings are not cosmetic:

   - **`--include=dev` in the build command.** `typescript`, `tailwindcss` and `postcss` are
     devDependencies, and `next build` needs all three. Any host that installs with
     `NODE_ENV=production` set will skip them and the build dies with
     `Cannot find module 'typescript'`.
   - **Do not set `NODE_ENV` yourself.** Render already sets it to `production` for the running
     service. Setting it as a build-time variable is what makes `npm install` drop the
     devDependencies in the first place.

   `NODE_VERSION=22` matters for a different reason: `better-sqlite3` ships prebuilt binaries for
   it, so the build does not fall back to compiling from source inside a 512 MB container.

7. Deploy.

**You do not need to run a seed step.** The app detects an empty database on first boot and seeds the
fictional dataset itself, logging `empty database detected — seeded the fictional demonstration data`.
Set `RELIEFRELAY_NO_AUTOSEED=true` to turn that off.

### What the free tier costs you, stated plainly

- **Cold starts take roughly 50 seconds.** Free instances spin down after about 15 minutes idle. Open
  the link yourself a minute before anyone judges it, and leave a tab open so it stays warm.
- **Data resets when it spins down.** Requests submitted by a judge will not be there an hour later.
  The seeded district always will be. Say so on the Devpost page rather than letting someone discover
  it: *"hosted on a free instance; the demonstration dataset reseeds on each cold start."*
- **Build memory is tight** (512 MB). If the build is killed by the OOM killer, add
  `NODE_OPTIONS=--max-old-space-size=460` and redeploy.
- No SSH, no scaling, no one-off jobs. None of these are needed — the seed runs in-process.

If you want data to survive, that is the one thing worth paying for: a Starter instance plus a 1 GB
disk at mount path `/data`, with `RELIEFRELAY_DB_PATH=/data/reliefrelay.db` instead of the `/tmp`
path above. Railway and Fly.io work the same way; the only thing that matters is a mounted volume and
`RELIEFRELAY_DB_PATH` pointing into it.

### What will *not* be live on a deployment

Unless you add the keys, and the `/about` page will say so:

- speech-to-text (the browser's own recogniser still works on the deployed site)
- Claude extraction — the built-in extractor runs instead, in all five languages
- the blockchain — attestations show as **Pending**, which is a feature worth demoing
- the advisory feed — the labelled scenario feed runs

---

## What I could not do for you

I could not create the public link myself. Deploying needs your hosting account, and a tunnel has
to originate from a machine that stays up — my container is ephemeral and would take the URL down
with it. Route A is ninety seconds of your time and is the right answer under deadline.
