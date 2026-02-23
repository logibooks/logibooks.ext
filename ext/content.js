// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 
//
// Content script for page-activated screenshot extension.
// See sw.js for architecture documentation and localStorage justification. 

let overlay;
let box;
let startX;
let startY;
let selecting = false;
let selectedRect = null;
let keydownHandler;
let mousedownHandler;
let mousemoveHandler;
let mouseupHandler;
let panel;
let saveButton;
let cancelButton;
let statusLabel;
let closeButton;
let selectionToggleButton;

// Allowed UI origins (prod + dev). Only these can activate the workflow.
const LOGIBOOKS_UI_ORIGINS = new Set([
  "https://logibooks.sw.consulting",
  "http://localhost"
]);

const SPA_NAV_EVENT = "logibooks:navigation";
let spaHooksInstalled = false;

installSpaNavigationHooks();

function setSaveDisabled(disabled) {
  if (!saveButton) return;
  saveButton.disabled = !!disabled;
  if (disabled) {
    saveButton.style.opacity = "0.2";
    saveButton.style.cursor = "not-allowed";
  } else {
    saveButton.style.opacity = "";
    saveButton.style.cursor = "pointer";
  }
}

function updateSelectionToggleButton() {
  if (!selectionToggleButton) return;
  selectionToggleButton.textContent = "Начать выбор";
  selectionToggleButton.style.opacity = "";
  selectionToggleButton.style.cursor = "pointer";
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  
  // Explicitly validate that x/y/w/h are present and not null/undefined/"" before conversion
  if (rect.x === null || rect.x === undefined || rect.x === "" || 
      rect.y === null || rect.y === undefined || rect.y === "" || 
      rect.w === null || rect.w === undefined || rect.w === "" || 
      rect.h === null || rect.h === undefined || rect.h === "") {
    return null;
  }
  
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

function activateSelectionMode({ forceRestart = false, preselectedRect = null } = {}) {
  startSelection({ forceRestart, preselectedRect });
  updateSelectionToggleButton();
}

function deactivateSelectionMode({ resetSelection = false } = {}) {
  cleanupOverlay();
  if (resetSelection) {
    selectedRect = null;
    setSaveDisabled(true);
  }
  updateSelectionToggleButton();
}

function requestUiSync() {
  // Show loading indicator while waiting for background response
  showLoadingIndicator();
  try {
    chrome.runtime.sendMessage({ type: "UI_READY" }, () => {
      // Hide loading if no response expected (e.g., not in active session)
      if (chrome.runtime.lastError) {
        hideLoadingIndicator();
      }
    });
  } catch {
    hideLoadingIndicator();
  }
}

function installSpaNavigationHooks() {
  if (spaHooksInstalled) return;
  spaHooksInstalled = true;

  const EventCtor = typeof globalThis.Event === "function" ? globalThis.Event : null;
  const historyRef = globalThis.history;

  const dispatchNavEvent = () => {
    if (!EventCtor) return;
    window.dispatchEvent(new EventCtor(SPA_NAV_EVENT));
  };

  if (!historyRef) return;

  ["pushState", "replaceState"].forEach((method) => {
    const original = historyRef[method];
    if (typeof original !== "function") return;
    historyRef[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      dispatchNavEvent();
      return result;
    };
  });

  window.addEventListener("popstate", dispatchNavEvent);
  window.addEventListener("hashchange", dispatchNavEvent);
  window.addEventListener(SPA_NAV_EVENT, () => {
    requestUiSync();
  });
}

// Handle messages from the page for presence queries and activation
window.addEventListener("message", (event) => {
  if (!event || event.source !== window || !event.data) return;
  try {
    const originUrl = new URL(event.origin);
    // allow exact origin match
    if (!LOGIBOOKS_UI_ORIGINS.has(event.origin)) {
      // allow scheme+hostname matches (ignore port) for configured origins
      const originNoPort = `${originUrl.protocol}//${originUrl.hostname}`;
      if (!LOGIBOOKS_UI_ORIGINS.has(originNoPort)) return;
    }
  } catch {
    return;
  }

  const payload = event.data;

  // Respond to presence queries from the page
  if (payload.type === "LOGIBOOKS_EXTENSION_QUERY") {
    window.postMessage(
      { type: "LOGIBOOKS_EXTENSION_ACTIVE", active: true },
      event.origin
    );
    return;
  }

  // Handle activation messages from the host webpage
  if (payload.type === "LOGIBOOKS_EXTENSION_ACTIVATE") {
    const target = typeof payload.target === "string" ? payload.target.trim() : "";
    const url = typeof payload.url === "string" ? payload.url.trim() : "";
    const token = typeof payload.token === "string" ? payload.token.trim() : "";

    // Basic validation to avoid forwarding arbitrary or malformed data
    if (!token || token.length > 256) return;
    if (!target || target.length > 2048) return;
    if (!url || url.length > 2048) return;
    try { new URL(url); } catch { return; }
    try { new URL(target); } catch { return; }

    // Forward to background script which will:
    // 1. Store these parameters in local storage using Chrome API 
    // 2. Navigate to the target URL
    // 3. Restore UI state on the target page to show screenshot interface
    chrome.runtime.sendMessage({ type: "PAGE_ACTIVATE", target, url, token });
  }
});

function togglePanel(visible) {
  if (panel) {
    panel.style.display = visible ? "flex" : "none";
  }
}

function ensurePanel() {
  if (panel) return;
  // Inject UI styles (ui-main copy + extension overrides)
  try {
      // no ui-main.css injection: we copy required rules into extension-ui.css
    } catch {
      // ignore
    }

  // No CSS injection: we use inline styles for all UI elements to avoid
  // loading external styles into the host page.

  panel = document.createElement("div");
  panel.id = "logibooks-panel";
  panel.style.cssText = (
    "position: fixed; top: 16px; right: 16px; z-index: 2147483647; " +
    "background: #fff; border: 1px solid #ccc; border-radius: 8px; " +
    "box-shadow: 0 2px 8px rgba(0,0,0,0.15); padding: 12px; display: none; " +
    "flex-direction: column; gap: 8px; min-width: 180px; color: #222; " +
    "font-family: system-ui, sans-serif; font-size: 14px;"
  );

  closeButton = document.createElement("button");
  closeButton.textContent = "✕";
  closeButton.type = "button";
  closeButton.title = "Скрыть панель";
  closeButton.style.cssText = (
    "position: absolute; top: 4px; right: 4px; padding: 2px 6px; " +
    "border: none; background: transparent; cursor: pointer; font-size: 16px; " +
    "line-height: 1; color: #666;"
  );
  closeButton.addEventListener("mouseover", () => { closeButton.style.color = "#000"; });
  closeButton.addEventListener("mouseout", () => { closeButton.style.color = "#666"; });
  closeButton.addEventListener("click", () => {
    // Hide locally to avoid UI being stuck if the message fails.
    togglePanel(false);
    deactivateSelectionMode({ resetSelection: true });

    try {
      chrome.runtime.sendMessage({ type: "UI_CANCEL" }, () => {
        if (chrome.runtime.lastError) {
          // Ensure the panel stays hidden locally on error.
          togglePanel(false);
        }
      });
    } catch {
      togglePanel(false);
    }
  });

  panel.appendChild(closeButton);

  statusLabel = document.createElement("div");
  statusLabel.style.cssText = "font-size: 14px; margin-top: 4px;";
  statusLabel.textContent = "";

  selectionToggleButton = document.createElement("button");
  selectionToggleButton.type = "button";
  selectionToggleButton.style.cssText = (
    "padding: 0.5rem 0.8rem; border: none; border-radius: 4px; " +
    "background-color: #1976d2; color: white; font-size: 13px; font-weight: 500; " +
    "cursor: pointer; transition: all 0.15s; min-width: 64px; display: inline-flex; " +
    "align-items: center; justify-content: center; text-align: center;"
  );
  selectionToggleButton.addEventListener("click", () => {
    activateSelectionMode({ forceRestart: true });
  });
  updateSelectionToggleButton();

  saveButton = document.createElement("button");
  saveButton.textContent = "Сохранить";
  saveButton.type = "button";
  saveButton.style.cssText = (
    "padding: 0.5rem 0.8rem; border: none; border-radius: 4px; " +
    "background-color: #1976d2; color: white; font-size: 13px; font-weight: 500; " +
    "cursor: pointer; transition: all 0.15s; min-width: 64px; display: inline-flex; " +
    "align-items: center; justify-content: center; text-align: center;"
  );
  saveButton.addEventListener("click", () => {
    if (!selectedRect) return;
    const rectToSend = selectedRect;
    // Hide overlay and panel first so the captured tab image does not
    // include selection UI artifacts. Use a short timeout to allow the
    // browser to repaint before the background captures the visible tab.
    try {
      cleanupOverlay();
    } catch {
      // best-effort
    }
    togglePanel(false);
    // Use two animation frames to ensure the browser repaints after we
    // removed the overlay and hid the panel. This is more reliable than
    // a fixed short timeout which may be too short on some systems.
    // Use guarded globalThis.requestAnimationFrame to satisfy linters
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame : null;
    if (raf) {
      raf(() => {
        raf(() => {
          try {
            chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
          } catch {
            // Save failed silently; user can retry
          }
        });
      });
    } else {
      // Fallback to timeout in environments without RAF
      setTimeout(() => {
        try {
          chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
        } catch {
          // Save failed silently; user can retry
        }
      }, 150);
    }
  });

  cancelButton = document.createElement("button");
  cancelButton.textContent = "Отменить";
  cancelButton.type = "button";
  cancelButton.style.cssText = (
    "padding: 0.5rem 0.8rem; border: none; border-radius: 4px; " +
    "background-color: #6c757d; color: white; font-size: 13px; font-weight: 500; " +
    "cursor: pointer; transition: all 0.15s; min-width: 120px; display: inline-flex; " +
    "align-items: center; justify-content: center; text-align: center;"
  );
  cancelButton.addEventListener("click", () => {
    deactivateSelectionMode({ resetSelection: true });
    togglePanel(false);
    try {
      chrome.runtime.sendMessage({ type: "UI_CANCEL" });
    } catch {
      // Cancel failed silently; UI is already hidden
    }
  });

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";
  actions.appendChild(selectionToggleButton);
  actions.appendChild(saveButton);
  actions.appendChild(cancelButton);
  panel.appendChild(statusLabel);
  panel.appendChild(actions);
  // Note: reselection is initiated by pressing mouse on the overlay;
  // no explicit "reselect" button is needed.
  document.documentElement.appendChild(panel);
}

function showSelectionUI(message, restoredRect = null) {
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Выберите область";
  saveButton.style.display = "inline-flex";
  cancelButton.style.display = "inline-flex";
  togglePanel(true);
  activateSelectionMode({ forceRestart: true, preselectedRect: restoredRect });
}



function showError(message) {
  if (!panel) ensurePanel();
  
  statusLabel.textContent = message || "Ошибка";
  saveButton.style.display = "none";
  cancelButton.style.display = "inline-flex";
  togglePanel(true);
  deactivateSelectionMode({ resetSelection: true });
}

function cleanupSelection() {
  deactivateSelectionMode({ resetSelection: true });
}

function cleanupOverlay() {
  if (overlay) {
    if (keydownHandler) overlay.removeEventListener("keydown", keydownHandler);
    if (mousedownHandler) overlay.removeEventListener("mousedown", mousedownHandler);
    if (mousemoveHandler) overlay.removeEventListener("mousemove", mousemoveHandler);
    if (mouseupHandler) document.removeEventListener("mouseup", mouseupHandler);
    overlay.remove();
  }
  overlay = null;
  box = null;
  keydownHandler = null;
  mousedownHandler = null;
  mousemoveHandler = null;
  mouseupHandler = null;
  selecting = false;
  updateSelectionToggleButton();
}

function startSelection({ forceRestart = false, preselectedRect = null } = {}) {
  if (forceRestart && overlay) {
    cleanupOverlay();
  }
  if (overlay) return;

  selectedRect = null;
  setSaveDisabled(true);

  overlay = document.createElement("div");
  overlay.style.cssText = "position: fixed; inset: 0; z-index: 2147483646; cursor: crosshair; background: rgba(0,0,0,0.02);";

  box = document.createElement("div");
  box.style.cssText = "position: absolute; border: 2px dashed #333; background: rgba(255,255,255,0.15); left: 0; top: 0; width: 0; height: 0;";

  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  overlay.tabIndex = -1;
  overlay.focus();

  keydownHandler = (e) => {
    if (e.key === "Escape") {
      chrome.runtime.sendMessage({ type: "UI_CANCEL" });
    }
  };

  overlay.addEventListener("keydown", keydownHandler);

  mousedownHandler = (e) => {
    // If a previous selection exists and the user presses again, drop
    // the old selection and start a fresh selection from the new point.
    if (selectedRect) {
      // Remove the persistent selection visuals.
      cleanupOverlay();
      // Restart selection on a clean overlay in a separate tick to avoid
      // stacking event handlers or recursively re-entering initialization.
      setTimeout(() => {
        startSelection();
      }, 0);
      return;
    }

    selecting = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = `${startX}px`;
    box.style.top = `${startY}px`;
    box.style.width = "0px";
    box.style.height = "0px";
    e.preventDefault();
  };

  overlay.addEventListener("mousedown", mousedownHandler);

  mousemoveHandler = (e) => {
    if (!selecting) return;
    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);
    box.style.left = `${x1}px`;
    box.style.top = `${y1}px`;
    box.style.width = `${x2 - x1}px`;
    box.style.height = `${y2 - y1}px`;
    e.preventDefault();
  };

  overlay.addEventListener("mousemove", mousemoveHandler);

  mouseupHandler = (e) => {
    if (!selecting) return;
    selecting = false;

    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);

    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 5 || h < 5) {
      selectedRect = null;
      setSaveDisabled(true);
      cleanupOverlay();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    selectedRect = {
      x: Math.round(x1 * dpr),
      y: Math.round(y1 * dpr),
      w: Math.round(w * dpr),
      h: Math.round(h * dpr)
    };
    setSaveDisabled(false);
    // Keep the overlay and selection box visible after mouseup so the user
    // can still see and confirm the selected area before saving.
    // Remove the overlay only when the user cancels or starts a new selection.
    // Make the box visually persistent but allow pointer-events through the
    // selection box so panel buttons remain clickable. Keep the overlay
    // cursor as crosshair per user's request; panel buttons will show pointer.
    box.style.pointerEvents = "none";
    // Ensure overlay remains crosshair (do not change to default)
    overlay.style.cursor = "crosshair";
  };

  document.addEventListener("mouseup", mouseupHandler);

  const normalizedPreselectedRect = normalizeRect(preselectedRect);
  if (normalizedPreselectedRect) {
    const dpr = window.devicePixelRatio || 1;
    const cssX = Math.round(normalizedPreselectedRect.x / dpr);
    const cssY = Math.round(normalizedPreselectedRect.y / dpr);
    const cssW = Math.round(normalizedPreselectedRect.w / dpr);
    const cssH = Math.round(normalizedPreselectedRect.h / dpr);

    const measuredViewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
    const measuredViewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
    const viewportWidth = measuredViewportWidth > 0 ? measuredViewportWidth : Math.max(cssX + cssW, 5);
    const viewportHeight = measuredViewportHeight > 0 ? measuredViewportHeight : Math.max(cssY + cssH, 5);

    const left = Math.max(0, Math.min(cssX, Math.max(0, viewportWidth - 1)));
    const top = Math.max(0, Math.min(cssY, Math.max(0, viewportHeight - 1)));
    const width = Math.max(0, Math.min(cssW, viewportWidth - left));
    const height = Math.max(0, Math.min(cssH, viewportHeight - top));

    if (width >= 5 && height >= 5) {
      selectedRect = {
        x: Math.round(left * dpr),
        y: Math.round(top * dpr),
        w: Math.round(width * dpr),
        h: Math.round(height * dpr)
      };
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.pointerEvents = "none";
      overlay.style.cursor = "crosshair";
      setSaveDisabled(false);
    }
  }

  updateSelectionToggleButton();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle ping for health check / readiness verification
  if (msg?.type === "PING") {
    sendResponse({ type: "PONG", ready: true });
    return true;
  }

  if (msg?.type === "SHOW_UI") {
    hideLoadingIndicator();
    showSelectionUI(msg.message, msg.rect);
  }

  if (msg?.type === "SHOW_ERROR") {
    hideLoadingIndicator();
    showError(msg.message);
  }
  
  if (msg?.type === "HIDE_UI") {
    hideLoadingIndicator();
  }

  // Explicitly indicate that no asynchronous response will be sent
  return false;
});

// Visual loading indicator for user feedback during activation
let loadingIndicator = null;

function showLoadingIndicator() {
  if (loadingIndicator) return;
  
  loadingIndicator = document.createElement("div");
  loadingIndicator.id = "logibooks-loading";
  loadingIndicator.style.cssText = (
    "position: fixed; top: 20px; right: 20px; z-index: 2147483647; " +
    "background: #1976d2; color: white; padding: 12px 20px; " +
    "border-radius: 8px; font-family: system-ui, sans-serif; font-size: 14px; " +
    "box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 10px;"
  );
  
  const spinner = document.createElement("div");
  spinner.style.cssText = (
    "width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); " +
    "border-top-color: white; border-radius: 50%; " +
    "animation: logibooks-spin 0.8s linear infinite;"
  );
  
  const style = document.createElement("style");
  style.textContent = "@keyframes logibooks-spin { to { transform: rotate(360deg); } }";
  
  const text = document.createElement("span");
  text.textContent = "Logibooks загрузка...";
  
  loadingIndicator.appendChild(style);
  loadingIndicator.appendChild(spinner);
  loadingIndicator.appendChild(text);
  document.documentElement.appendChild(loadingIndicator);
}

function hideLoadingIndicator() {
  if (loadingIndicator) {
    loadingIndicator.remove();
    loadingIndicator = null;
  }
}

requestUiSync();

// Expose internal helpers for unit testing
const isTestEnv =
  typeof globalThis !== "undefined" &&
  (
    globalThis.__CONTENT_TEST_ENV__ === true ||
    globalThis.process?.env?.NODE_ENV === "test"
  );
if (isTestEnv) {
  globalThis.__contentTestHooks__ = {
    togglePanel,
    ensurePanel,
    showSelectionUI,
    showError,
    cleanupSelection,
    cleanupOverlay,
    showLoadingIndicator,
    hideLoadingIndicator
  };

  // Expose selectedRect accessors for tests
  globalThis.__contentTestHooks__.getSelectedRect = () => selectedRect;
  globalThis.__contentTestHooks__.setSelectedRect = (r) => { selectedRect = r; };

  // Expose loadingIndicator accessor for tests
  globalThis.__contentTestHooks__.getLoadingIndicator = () => loadingIndicator;

  // Test helper: trigger save flow (as if user clicked Save)
  globalThis.__contentTestHooks__.triggerSave = (rect) => {
    if (rect) selectedRect = rect;
    // run the same steps as saveButton click
    const rectToSend = selectedRect;
    try { cleanupOverlay(); } catch {}
    togglePanel(false);
    const raf = typeof globalThis.requestAnimationFrame === "function" ? globalThis.requestAnimationFrame : null;
    if (raf) {
      raf(() => {
        raf(() => {
          try {
            chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend });
          } catch {}
        });
      });
    } else {
      setTimeout(() => {
        try { chrome.runtime.sendMessage({ type: "UI_SAVE", rect: rectToSend }); } catch {}
      }, 150);
    }
  };
}
