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

The app stores data in SQLite, so it needs a host with a **persistent disk**. Vercel will not work
without migrating to Postgres first — its filesystem is ephemeral, and every request would vanish
on redeploy.

**Render** is the shortest path:

1. render.com → New → Web Service → connect this GitHub repo, branch `claude/happy-knuth-hg1or1`.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Add a **Disk**: mount path `/data`, size 1 GB.
5. Environment variables:

   ```
   RELIEFRELAY_DB_PATH=/data/reliefrelay.db
   NODE_ENV=production
   EMERGENCY_NUMBER=112
   EMERGENCY_LABEL=Local emergency services (fictional demonstration)
   ```

6. Deploy.

**You do not need to run a seed step.** The app detects an empty database on first boot and seeds
the fictional dataset itself, logging `empty database detected — seeded the fictional
demonstration data`. Set `RELIEFRELAY_NO_AUTOSEED=true` to turn that off.

Railway and Fly.io work the same way; the only thing that matters is a mounted volume and
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
