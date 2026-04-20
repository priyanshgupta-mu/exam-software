# Deploying the Proctoring Server

The backend + admin panel + mobile page ship as one Node service. Two options below: **Render** (recommended if you're already logged in) or **Railway**. Either one takes ~5 minutes.

---

# Option A — Render

## 1. Push the repo to GitHub

Render deploys from Git. Make sure your repo is pushed.

## 2. From the Render dashboard

You already have the **Exam Proctet** project open. Now:

1. Click **Create new service**.
2. Choose **Web Service**.
3. Connect your GitHub account if you haven't, then pick this repo.
4. Render reads [render.yaml](render.yaml) and auto-fills:
   - Runtime: Node
   - Build command: `npm --prefix server install --omit=dev && npm --prefix admin install && npm --prefix admin run build`
   - Start command: `node server/index.js`
   - Health check: `/api/health`
5. In the **Environment** section, set:
   - `ADMIN_USER` — e.g. `admin`
   - `ADMIN_PASS` — **a strong password** (this controls who can see every candidate's camera)
6. Plan: **Free** is fine for testing.
7. Click **Create Web Service**.

First build takes ~3–4 min. When it finishes, Render gives you a URL like `https://examapp-proctor.onrender.com`.

## 3. Verify the deploy

Open these in a browser:
- `https://<your-render-url>/api/health` → returns `{"ok":true, ...}`
- `https://<your-render-url>/admin/` → admin login screen
- Sign in with the creds from step 5.

## 4. Point the Electron app at Render

Edit [proctor.config.json](proctor.config.json):

```json
{
  "serverUrl": "https://examapp-proctor.onrender.com"
}
```

Replace with your actual URL. Then locally:

```bash
npm start
```

The Electron candidate app now connects to Render for sessions + QR + admin control.

## Render free-tier notes

- **Idle sleep.** Free Web Services spin down after 15 min of no traffic. First request after a sleep takes ~30s to cold-start. Keep a browser tab open on the admin panel while running exams.
- **Outbound WebSocket.** Render supports persistent WebSockets on all plans including free — no extra config needed.

---

# Option B — Railway

## 1. Prepare the repo

Push this repo to GitHub (Railway deploys from Git).

Files that configure the deploy:
- [railway.json](railway.json) — Railway project settings
- [nixpacks.toml](nixpacks.toml) — build plan
- [.railwayignore](.railwayignore) — excludes Electron-only files

## 2. Create the Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**.
2. Select this repo.
3. Railway auto-detects the Node service. First build takes ~2–3 min.
4. Once deployed, Railway assigns a domain like `proctorexam-production.up.railway.app`.
   - Under the service → **Settings** → **Networking** → **Generate Domain** if not auto-created.

## 3. Set environment variables

In Railway → service → **Variables**:

| Var | Value | Notes |
|---|---|---|
| `ADMIN_USER` | e.g. `admin` | Change from the default |
| `ADMIN_PASS` | a strong password | **Required for production** |
| `PUBLIC_URL` | `https://your-domain.up.railway.app` | Optional. Falls back to `RAILWAY_PUBLIC_DOMAIN` which Railway injects automatically |

`PORT` is injected by Railway automatically — don't set it.

## 4. Verify the deploy

Open these URLs in a browser:
- `https://<your-domain>/api/health` → returns `{"ok":true, ...}`
- `https://<your-domain>/admin/` → shows the admin login
- Sign in with the admin creds you set in step 3.

## 5. Point the Electron exam app at Railway

Edit [proctor.config.json](proctor.config.json) locally:

```json
{
  "serverUrl": "https://your-domain.up.railway.app"
}
```

This file controls:
- The URL socket.io connects to
- Which remote host the Electron security sandbox allows
- Which host the WebSocket override inside the exam allows

## 6. Run the exam app locally

```bash
npm start
```

The backend on `localhost:4000` will still spin up locally but the candidate Electron app will connect to Railway instead. You can kill the local server — you don't need it.

If you want the candidate app to **only** connect to Railway and not start the local server:

```bash
npm run dev      # Vite only
npm run electron # in a second terminal
```

## 7. Test the full flow

1. Launch Electron on your exam PC (the machine under test).
2. Log in as a student.
3. The SessionGate shows a QR code → scan it with your phone.
   - Phone loads `https://<your-domain>/m/?t=...` and asks for camera permission.
   - Over HTTPS, iOS Safari and Chrome both allow the camera.
4. From any device, open `https://<your-domain>/admin/` and sign in.
5. You should see the candidate tile with desktop + mobile feeds.
6. Click **Start Exam**. The candidate's exam flow begins and both feeds appear live.

---

## Gotchas

- **WebRTC NAT traversal.** Across different networks (candidate at home, admin elsewhere), STUN alone may fail. If live feeds stay black, you'll need a TURN server (Twilio, Xirsys, Metered — free tiers exist). Add its URL to the `iceServers` list in [src/lib/proctoringClient.js](src/lib/proctoringClient.js), [admin/src/components/CandidateTile.jsx](admin/src/components/CandidateTile.jsx), and [server/public/mobile/mobile.js](server/public/mobile/mobile.js).
- **Cold starts.** Railway's free tier sleeps idle services. First request after a sleep may take 5–15s.
- **Session state is in-memory.** If the Railway service restarts, all active sessions are lost. For production, back sessions with Redis.
- **Rebuild Electron after changing `proctor.config.json`.** The file is imported by the Vite bundle, so run `npm run build` (or restart `npm run dev`) after editing.
