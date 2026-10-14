# QuickShare Pro ✨

> Real-time peer sharing bridge between laptop and phone with Liquid Glass aesthetics.

QuickShare Pro lets you instantly transfer photos, videos, files, links, and text between your laptop and mobile devices in real time with a chat-style feed. It runs on your local Wi-Fi without needing external services, or can be deployed to the cloud.

---

## 🚀 Quick Start (Local Wi-Fi Mode)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
Specify your preferred 6-digit access PIN (or let it default to `123456`):

**On Windows (PowerShell):**
```powershell
$env:PIN="123456"; npm start
```

**On macOS / Linux:**
```bash
PIN=123456 npm start
```

### 3. Connect Devices
- **Laptop**: Open `http://localhost:3000` (or click the URL printed in the terminal).
- **Phone**: Click the **📲 Pair** button on your laptop to display the QR code, or scan the QR code to open `http://<YOUR_LOCAL_IP>:3000?pin=123456`.
- Both devices will instantly pair and the green presence indicator will pulse!

---

## ☁️ Cloud Deployment Mode (MongoDB + Cloudinary)

When deploying to platforms such as Railway, Render, Fly.io, or Heroku, configure the following environment variables:

| Variable | Description |
|---|---|
| `PORT` | Web server port (e.g. `3000` or assigned by host) |
| `PIN` | 6-digit security PIN for device authorization |
| `MONGO_URI` | *(Optional)* MongoDB connection string for cloud metadata storage |
| `CLOUDINARY_URL` | *(Optional)* Cloudinary URI for CDN-backed media hosting |

When `MONGO_URI` and `CLOUDINARY_URL` are not set, QuickShare Pro automatically runs in **Local Mode**, persisting files to the `./uploads` directory and tracking metadata in `data.json`.

---

## ✨ Features & Architecture

- **Visual Design**: "Liquid Glass" frosted refractive glass with 4 organic gooey blobs drifting in the background, specular pointer highlights, and animated flowing gradient progress bars.
- **Motion Spec**: Spring overshoot message pop (`cubic-bezier(0.34, 1.56, 0.64, 1)`), smooth 280ms delete transitions, button click ripples, and gentle empty-state bobbing.
- **Bi-Directional Real-Time Sync**: Socket.io broadcasts new items, deletions, and active presence counters.
- **Image Lightbox**: Click any shared image to view in a full-screen frosted glass lightbox with quick download or `Esc`/backdrop dismiss.
- **Save All as ZIP**: One-click bulk download of all shared media and files as a ZIP archive.
- **Security Hardening**:
  - Zero `innerHTML` for user content (safe DOM nodes & `textContent`).
  - Strict URL linkification for `http(s)://` with `rel="noopener noreferrer"`.
  - Inline serving restricted to safe `image/*` (excluding SVG), `video/*`, and `audio/*`. All other file types (SVG, HTML, executables) forced to attachment download.
  - Rate-limited PIN verification (5 attempts per minute per IP).
