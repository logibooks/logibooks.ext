// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 
//
// ARCHITECTURE NOTE: Page-Activated Screenshot Extension
// =====================================================
// This extension is designed to be activated by host webpages, NOT by user clicks.
// The workflow requires persistent storage (via chrome.storage.local) because:
//
// 1. Page sends activation message with: target URL + upload endpoint + auth token
// 2. Extension navigates TO the target URL to capture screenshot
// 3. UI state must SURVIVE navigation to show screenshot interface on target page
// 4. Extension uploads screenshot and navigates BACK to original page
//
// Without persistent storage, the extension would lose UI state during navigation steps 2-4,
// making it impossible for the screenshot interface to appear on the target page.
// This service worker handles the persistent storage (chrome.storage.local) and navigation logic. 

const UI_HOST_SUFFIXES = ["sw.consulting", "gtc.express"];
const UI_LOCAL_ORIGINS = new Set(["http://localhost"]);

const ALLOWED_TARGET_SUFFIXES = ["ozon.ru", "wildberries.ru"];

// Activation reliability constants
// Total worst-case wait: (1000ms * 4) + (300ms * 3) = ~5 seconds
const CONTENT_SCRIPT_PING_TIMEOUT = 1000;  // 1 second per ping attempt
const CONTENT_SCRIPT_MAX_PING_ATTEMPTS = 4; // Try pinging up to 4 times
const CONTENT_SCRIPT_PING_DELAY = 300;     // Wait between ping attempts

function isAllowedTarget(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_TARGET_SUFFIXES.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

function isAllowedActivator(returnUrl) {
  try {
    const u = new URL(returnUrl);
    // allow matching scheme + hostname ignoring port for entries like http://localhost
    const originNoPort = `${u.protocol}//${u.hostname}`;
    if (UI_LOCAL_ORIGINS.has(u.origin) || UI_LOCAL_ORIGINS.has(originNoPort)) return true;
    if (u.protocol !== "https:") return false;

    const h = u.hostname.toLowerCase();
    return UI_HOST_SUFFIXES.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}


// STATE MACHINE DOCUMENTATION
// ===========================
// Extension state transitions:
//
// "idle" → "navigating" → "awaiting_selection" → "uploading" → "idle"
//                       ↘                      ↙
//                         "idle" (on cancel/error)
//
// State Details:
// - idle: Ready for new activation, no active session
// - navigating: Navigating to target URL for screenshot
// - awaiting_selection: On target page, waiting for user to select area
// - uploading: Processing and uploading the selected screenshot
// 
// All error conditions and cancellations reset to "idle" state
const state = {
  status: "idle",        // Current state: "idle" | "navigating" | "awaiting_selection" | "uploading"
  tabId: null,           // Active tab ID for the current session
  returnUrl: null,       // Original page URL to return to after screenshot
  targetUrl: null,       // Target page URL where screenshot will be taken
  target: null,          // Upload endpoint URL
  token: null            // Authentication token for upload
};

let isUiVisible = false;
const SESSION_STORAGE_KEY = "logibooksSelectionState";
const LAST_SELECTION_RECT_KEY = "lastSelectionRect";
const sessionStore = typeof chrome !== "undefined" ? chrome.storage?.session : undefined;
let lastSelectionRect = null;

function snapshotState() {
  return {
    status: state.status,
    tabId: state.tabId,
    returnUrl: state.returnUrl,
    targetUrl: state.targetUrl,
    target: state.target,
    token: state.token
  };
}

async function persistSessionState() {
  if (!sessionStore?.set) return;
  try {
    await sessionStore.set({ [SESSION_STORAGE_KEY]: snapshotState() });
  } catch {
    // Ignore storage persistence errors; in-memory state remains authoritative
  }
}

async function hydrateSessionState() {
  if (!sessionStore?.get) return;
  try {
    const stored = await sessionStore.get(SESSION_STORAGE_KEY);
    if (stored && stored[SESSION_STORAGE_KEY]) {
      Object.assign(state, stored[SESSION_STORAGE_KEY]);
    }
  } catch {
    // Ignore hydration errors; state stays at defaults
  }
}

async function setSessionState(partial) {
  Object.assign(state, partial);
  await persistSessionState();
}

// Initialize UI visibility state from storage
async function initializeUiVisibility() {
  try {
    const result = await chrome.storage.local.get(["isUiVisible"]);
    if (result.isUiVisible !== undefined) {
      isUiVisible = result.isUiVisible;
    }
  } catch {
    // Ignore storage errors; UI visibility defaults to false
  }
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const x = Math.round(Number(rect.x));
  const y = Math.round(Number(rect.y));
  const w = Math.round(Number(rect.w));
  const h = Math.round(Number(rect.h));

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }

  if (x < 0 || y < 0 || w < 5 || h < 5) {
    return null;
  }

  return { x, y, w, h };
}

async function initializeLastSelectionRect() {
  try {
    const result = await chrome.storage.local.get([LAST_SELECTION_RECT_KEY]);
    const normalized = normalizeRect(result?.[LAST_SELECTION_RECT_KEY]);
    lastSelectionRect = normalized;
    if (!normalized && result?.[LAST_SELECTION_RECT_KEY] != null) {
      await chrome.storage.local.remove([LAST_SELECTION_RECT_KEY]);
    }
  } catch {
    // Ignore storage errors; last selection remains in memory/default null
  }
}

async function saveLastSelectionRect(rect) {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;

  lastSelectionRect = normalized;
  try {
    await chrome.storage.local.set({ [LAST_SELECTION_RECT_KEY]: normalized });
  } catch {
    // Ignore persistence failures; in-memory fallback still works while SW lives
  }
  return normalized;
}

function buildShowUiMessage() {
  const message = { type: "SHOW_UI", message: "Выберите область" };
  if (lastSelectionRect) {
    message.rect = lastSelectionRect;
  }
  return message;
}

// Save UI visibility state to storage
async function saveUiVisibility(visible) {
  isUiVisible = visible;
  try {
    await chrome.storage.local.set({ isUiVisible: visible });
  } catch {
    // Ignore storage errors; isUiVisible is already updated in memory
  }
}

void (async () => {
  await initializeUiVisibility();
  await initializeLastSelectionRect();
  await hydrateSessionState();
  if (state.status === "awaiting_selection" && typeof state.tabId === "number") {
    await syncUiState(state.tabId);
  }
})();



chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg?.type) return;

  if (msg.type === "PAGE_ACTIVATE") {
    // STATE: idle → navigating
    // Only accept new activations when idle to prevent concurrent sessions
    if (state.status !== "idle") return;
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    void handleActivation(tabId, sender.tab?.url, msg);
  }

  if (msg.type === "UI_SAVE") {
    // STATE: awaiting_selection → uploading
    // Only process save when waiting for selection on the correct tab
    if (state.status !== "awaiting_selection") return;
    if (sender.tab?.id !== state.tabId) return;
    void handleSave(msg.rect);
  }

  if (msg.type === "UI_CANCEL") {
    // STATE: any → idle
    // Cancel can happen from any state, always return to idle
    if (sender.tab?.id !== state.tabId) return;
    void handleCancel();
  }

  if (msg.type === "UI_READY") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    void syncUiState(tabId);
  }
});

if (chrome?.runtime?.onSuspend?.addListener) {
  chrome.runtime.onSuspend.addListener(() => {
    void handleExtensionSuspend();
  });
}

if (chrome?.action?.onClicked?.addListener) {
  chrome.action.onClicked.addListener((tab) => {
    void handleActionClick(tab);
  });
}

if (chrome?.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    if (state.status !== "awaiting_selection") return;
    if (tabId !== state.tabId) return;
    void syncUiState(tabId);
  });
}

if (chrome?.webNavigation?.onCommitted?.addListener) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (state.status !== "awaiting_selection") return;
    if (details.tabId !== state.tabId) return;
    if (details.transitionType !== "reload") return;
    void finishSession({ skipReturnNavigation: true });
  });
}

async function handleActivation(tabId, returnUrl, payload) { 
  if (!payload?.url || typeof payload.url !== "string") { 
    await reportError(new Error("Ошибка выбора страницы (1)"), tabId); 
    return; 
  } 
  
  if (!payload?.target || typeof payload.target !== "string") { 
    await reportError(new Error("Ошибка выбора страницы (2)"), tabId); 
    return; 
  } 
  
  if (!returnUrl) { 
    await reportError(new Error("Ошибка выбора страницы (3)"), tabId); 
    return; 
  } 
  
  if (!isAllowedActivator(returnUrl)) { 
    await reportError(new Error("Forbidden activator origin"), tabId); 
    return; 
  } 
  
  if (!isAllowedTarget(payload.url)) { 
    await reportError(new Error(`URL не разрешен: ${payload.url}`), tabId); 
    return; 
  } 
  
  const trimmedToken = typeof payload.token === "string" ? payload.token.trim() : null; 
  await setSessionState({ status: "navigating", tabId, returnUrl, targetUrl: payload.url, target: payload.target, token: trimmedToken }); 
  try { 
    // Show loading badge while navigating and waiting for content script
    await setBadgeLoading();
    
    await navigate(tabId, payload.url); 
    
    // Wait for content script to be ready before showing UI
    const isReady = await waitForContentScriptReady(tabId);
    if (!isReady) {
      // Try re-injecting content script as fallback
      await injectContentScript(tabId);
      const isReadyAfterInject = await waitForContentScriptReady(tabId);
      if (!isReadyAfterInject) {
        await setBadgeError();
        throw new Error("Не удалось активировать расширение. Попробуйте обновить страницу.");
      }
    }
    
    // Clear badge on success
    await clearBadge();
    
    await saveUiVisibility(true); 
    await setSessionState({ status: "awaiting_selection" }); 
    await sendMessageWithRetry(tabId, buildShowUiMessage()); 
  } catch (error) { 
    await setBadgeError();
    await reportError(error, tabId); 
  } 
}

/**
 * Badge helpers for user feedback during activation.
 * Shows visual indicator on extension icon.
 */
async function setBadgeLoading() {
  try {
    await chrome.action.setBadgeText({ text: "..." });
    await chrome.action.setBadgeBackgroundColor({ color: "#1976d2" });
  } catch {
    // Badge API may not be available in all contexts
  }
}

async function setBadgeError() {
  try {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d32f2f" });
    // Auto-clear error badge after 5 seconds
    setTimeout(() => clearBadge(), 5000);
  } catch {
    // Badge API may not be available in all contexts
  }
}

async function clearBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    // Badge API may not be available in all contexts
  }
}

/**
 * Ping the content script to verify it's loaded and responsive.
 * Returns true if content script responds, false otherwise.
 */
function pingContentScript(tabId) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(false), CONTENT_SCRIPT_PING_TIMEOUT);
    
    chrome.tabs.sendMessage(tabId, { type: "PING" }, (response) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(response?.type === "PONG");
      }
    });
  });
}

/**
 * Wait for content script to become ready with multiple ping attempts.
 * Returns true if content script is ready, false if all attempts fail.
 */
async function waitForContentScriptReady(tabId) {
  for (let attempt = 0; attempt < CONTENT_SCRIPT_MAX_PING_ATTEMPTS; attempt++) {
    const isReady = await pingContentScript(tabId);
    if (isReady) {
      return true;
    }
    if (attempt < CONTENT_SCRIPT_MAX_PING_ATTEMPTS - 1) {
      await delay(CONTENT_SCRIPT_PING_DELAY);
    }
  }
  return false;
}

/**
 * Attempt to inject content script programmatically.
 * Used as fallback when content script wasn't auto-injected.
 */
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    // Give content script time to initialize
    await delay(300);
  } catch {
    // Injection may fail due to permissions; ignore and let caller handle
  }
}

async function handleSave(rect) {
  try {
    // STATE: awaiting_selection → uploading
    // User selected area, now processing and uploading screenshot
    await setSessionState({ status: "uploading" });

    const normalizedRect = await saveLastSelectionRect(rect);
    if (!normalizedRect) {
      throw new Error("Некорректная область выделения");
    }
    
    if (!state.tabId || !state.target) {
      throw new Error("Активная сессия не найдена");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" });
    const blob = await cropDataUrl(dataUrl, normalizedRect);
    await apiUpload(state.target, normalizedRect, blob);
    
    // STATE: uploading → idle (via finishSession)
    await finishSession();
  } catch (error) {
    // STATE: uploading → idle (via reportError)
    await reportError(error, state.tabId);
  }
}

async function handleCancel() {
  // STATE: any → idle (via finishSession)
  // User cancelled, return to original page and reset
  await finishSession();
}

async function handleExtensionSuspend() {
  await saveUiVisibility(false);

  try {
    if (sessionStore?.clear) {
      await sessionStore.clear();
    }
  } catch {
    // Ignore storage clearing errors; suspension cleanup will continue
  }

  const tabId = state.tabId;
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "HIDE_UI" });
  }

  await resetState();
}

async function handleActionClick(tab) {
  if (state.status !== "awaiting_selection" || state.tabId == null) {
    return;
  }

  const targetTabId = state.tabId;

  if (!tab || tab.id !== targetTabId) {
    try {
      await chrome.tabs.update(targetTabId, { active: true });
    } catch {
      // Tab may no longer exist; ignore focus errors
    }
  }

  await saveUiVisibility(true);
  await sendMessageWithRetry(targetTabId, {
    ...buildShowUiMessage()
  });
}

async function finishSession(options = {}) {
  // STATE: any → idle (via resetState)
  // Clean up UI and navigate back to original page
  const { skipReturnNavigation = false } = options;
  const { tabId, returnUrl } = state;
  await saveUiVisibility(false);
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "HIDE_UI" });
  }
  await resetState();  // → idle state
  if (!skipReturnNavigation && tabId !== null && tabId !== undefined && returnUrl) {
    try {
      await navigate(tabId, returnUrl);
    } catch {
      // Navigation back to returnUrl may fail if tab was closed; ignore errors
    }
  }
}

async function resetState() {
  // STATE: any → idle
  // Reset all session data to initial state
  await setSessionState({
    status: "idle",
    tabId: null,
    returnUrl: null,
    targetUrl: null,
    target: null,
    token: null
  });
}

async function reportError(error, tabId) {
  // STATE: any → idle (via resetState)
  // Error occurred, show error message and reset all session data
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  if (tabId !== null && tabId !== undefined) {
    await sendMessageWithRetry(tabId, { type: "SHOW_ERROR", message });
  }
  await resetState();  // → idle state
}

async function syncUiState(tabId) {
  const isSessionTab = tabId === state.tabId;

  if (state.status === "awaiting_selection") {
    if (!isSessionTab) {
      return;
    }
    if (!isUiVisible) {
      await saveUiVisibility(true);
    }
    await sendMessageWithRetry(tabId, buildShowUiMessage());
    return;
  }

  if (isUiVisible) {
    await saveUiVisibility(false);
    await sendMessageWithRetry(tabId, { type: "HIDE_UI" });
  }
}

async function sendMessageWithRetry(tabId, message, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const success = await sendMessageOnce(tabId, message);
    if (success) {
      return true;
    }
    await delay(200);
  }
  return false;
}

function sendMessageOnce(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiUpload(target, rect, blob) {
  const fd = new FormData();
  fd.append("rect", JSON.stringify(rect));
  // Backend expects an IFormFile named 'file'
  fd.append("file", blob, `snap-${Date.now()}.png`);
  const headers = {};
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const r = await fetch(target, { method: "POST", body: fd, headers });
  if (!r.ok) throw new Error(`Ошибка POST ${target}: ${r.status}`);
}

function navigate(tabId, url) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Navigation timeout"));
    }, 60000);

    function listener(updatedTabId, info) {
      if (settled) return;
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 250);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url, active: true });
  });
}

async function cropDataUrl(dataUrl, rect) {
  const img = await loadImage(dataUrl);

  const sx = clamp(rect.x, 0, img.width - 1);
  const sy = clamp(rect.y, 0, img.height - 1);
  const sw = clamp(rect.w, 1, img.width - sx);
  const sh = clamp(rect.h, 1, img.height - sy);

  if (sw < 5 || sh < 5) {
    throw new Error("Слишком маленький размер изображения (минимум 5px)");
  }

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return await canvas.convertToBlob({ type: "image/png" });
}

async function loadImage(dataUrl) {
  let blob;
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
    const comma = dataUrl.indexOf(",");
    const header = dataUrl.substring(0, comma);
    const data = dataUrl.substring(comma + 1);
    const isBase64 = header.indexOf("base64") !== -1;
    const mimeMatch = header.match(/data:([^;]+)[;]?/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    if (isBase64) {
      const binary = atob(data);
      const len = binary.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) u8[i] = binary.charCodeAt(i);
      blob = new Blob([u8], { type: mime });
    } else {
      blob = new Blob([decodeURIComponent(data)], { type: mime });
    }
  } else {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Не удалось загрузить изображение: ${res.status}`);
    blob = await res.blob();
  }

  return await createImageBitmap(blob);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Expose helpers for Jest / browser-like tests without emitting real exports in production code.
const isTestEnv =
  typeof globalThis !== "undefined" &&
  (
    // Explicit test flag for browser / extension test environments
    globalThis.__swTestEnv__ === true ||
    // Fallback for Node-based test runners like Jest
    (typeof globalThis.process !== "undefined" &&
      globalThis.process.env &&
      globalThis.process.env.NODE_ENV === "test")
  );
if (isTestEnv && typeof globalThis !== "undefined") {
  globalThis.__swTestHooks__ = {
    isAllowedTarget,
    isAllowedActivator,
    clamp,
    delay,
    sendMessageWithRetry,
    sendMessageOnce,
    loadImage,
    cropDataUrl,
    apiUpload,
    navigate,
    reportError,
    resetState,
    state,
    handleActionClick,
    handleExtensionSuspend,
    syncUiState,
    normalizeRect,
    saveLastSelectionRect,
    pingContentScript,
    waitForContentScriptReady,
    injectContentScript,
    handleActivation,
    // Constants for test assertions
    CONTENT_SCRIPT_PING_TIMEOUT,
    CONTENT_SCRIPT_MAX_PING_ATTEMPTS,
    CONTENT_SCRIPT_PING_DELAY
  };
}
