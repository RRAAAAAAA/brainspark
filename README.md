# BrainSpark Studio

Interactive learning modules with real shareable links.

## Setup (one-time)

**Requirements:** Node.js 16+

No npm install needed — uses only Node.js built-ins.

## Run

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

## How sharing works

1. Author creates a module and clicks **🔗 Share**
2. The app POSTs the module to `POST /api/modules` → server saves it, returns a short URL like `http://localhost:3000/m/a3f9c2b1`
3. Author copies and shares that URL (via chat, email, etc.)
4. Student opens the link → server redirects to `/#play=a3f9c2b1`
5. App fetches `GET /api/modules/a3f9c2b1`, imports the module, and launches the player automatically

## Deploy to the web

To make links work publicly, host this on any Node.js platform:

- **Railway:** `railway up`
- **Render:** connect repo, set start command to `node server.js`
- **Fly.io:** `fly launch`
- **VPS:** run `node server.js` behind nginx

Once deployed, update `PORT` via environment variable if needed. The generated share URLs will automatically use the public hostname.

## Files

```
brainspark/
├── server.js     ← Express-style Node.js server (zero deps)
├── index.html    ← Full BrainSpark app (all-in-one HTML)
├── db.json       ← Auto-created; stores published modules
└── README.md
```
