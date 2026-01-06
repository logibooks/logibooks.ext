# logibooks.ext

Chrome extension to support documentation generator

A Chrome Manifest V3 extension that:
- navigates to URLs from a server-controlled job queue,
- asks the user to select a rectangle in the visible viewport,
- captures and crops the selected area,
- uploads the resulting image back to the server,
- repeats until an end marker is received.

The repository includes a **local simulation server** for development and testing.

---

## Components

### 1. Chrome Extension (`/ext`)
- Manifest V3
- Visible-area capture using `chrome.tabs.captureVisibleTab`
- User-driven rectangle selection (drag overlay)
- Cropping via `OffscreenCanvas`
- Upload via `fetch` + `multipart/form-data`

### 2. Simulation Server (`/sim-server`)
- Node.js + Express
- Serves a queue of URLs from an allow-list
- Accepts uploaded screenshots
- Stores images and metadata locally

---

## Prerequisites

- Chrome (latest stable)
- Node.js ≥ 18

---

## Running the simulation server

```bash
cd sim-server
npm install
npm start
```

The server will:
- Listen on `http://localhost:5177` by default
- Serve a `/jobs` endpoint returning the next URL to visit
- Accept uploads at `/upload/:key`

---

## Extension Architecture

### Key Files
- Extension manifest: [ext/manifest.json](ext/manifest.json)
- UI / page interaction: [ext/content.js](ext/content.js#L1)
- Background (service worker): [ext/sw.js](ext/sw.js#L1)

### Design
- `content.js` is responsible only for DOM/UI (panel, selection overlay, Save/Cancel buttons). It contains no upload business logic or direct access to extension APIs.
- `sw.js` (service worker) is the single source of truth for workflow state (navigation, awaiting selection, upload). It sends `SHOW_UI`, `HIDE_UI`, and `SHOW_ERROR` commands to the content script.

### Why a service worker is required
- APIs like `chrome.tabs.captureVisibleTab`, `chrome.tabs.update`, and others are only available in the extension background context. They cannot be called from a content script.

---

## Installation (local developer mode)

1. Open Chrome/Chromium/Edge
2. Navigate to `chrome://extensions` (or `edge://extensions`)
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `ext` folder (the folder containing `manifest.json`)

---

## Quick test

After loading the extension:
- Click the extension icon or use the page activation mechanism (if implemented)
- The UI will appear and prompt you to select an area

---

## Development commands

The project has no build step by default — files are plain JS. Just edit files in `ext/`.

### Running the simulation server (optional)

```bash
cd sim-server
npm install
npm start
```

### Reloading the extension after changes

In Chrome:
1. Open `chrome://extensions`
2. Click "Reload" next to the extension


