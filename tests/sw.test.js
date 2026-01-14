// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { URL as NodeURL } from "url";

let sw;

describe("Service worker helpers", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // ensure a real URL implementation for parsing
    global.URL = NodeURL;
    // basic chrome mock used by sw.js top-level initialization
    global.chrome = {
      runtime: { sendMessage: jest.fn(), lastError: null, onMessage: { addListener: jest.fn(), removeListener: jest.fn() } },
      tabs: {
        sendMessage: jest.fn((tabId, message, callback) => {
          if (typeof callback === "function") callback();
        }),
        update: jest.fn(async () => {}),
        captureVisibleTab: jest.fn(),
        onUpdated: { addListener: jest.fn(), removeListener: jest.fn() }
      },
      action: { onClicked: { addListener: jest.fn() } },
      storage: {
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(),
          remove: jest.fn(),
          clear: jest.fn((cb) => {
            if (typeof cb === "function") cb();
          })
        }
      }
    };
    global.fetch = jest.fn();
    // Provide a minimal FormData mock to avoid jsdom Blob instance checks
    global.FormData = class {
      constructor() { this._pairs = []; }
      append(k, v, filename) { this._pairs.push([k, v, filename]); }
    };
    await import("../ext/sw.js");
    sw = globalThis.__swTestHooks__;
    if (!sw) throw new Error("Service worker test hooks were not registered");
    // reset state between tests
    if (sw.resetState) sw.resetState();
  });

  it("clamp keeps values inside bounds", () => {
    expect(sw.clamp(5, 0, 10)).toBe(5);
    expect(sw.clamp(-1, 0, 10)).toBe(0);
    expect(sw.clamp(11, 0, 10)).toBe(10);
  });

  describe("isAllowedTarget", () => {
    it("rejects malformed and unsupported protocols", () => {
      expect(sw.isAllowedTarget("not a url")).toBe(false);
      expect(sw.isAllowedTarget("ftp://ozon.ru")).toBe(false);
      expect(sw.isAllowedTarget("data:image/png;base64,AAAA")).toBe(false);
    });

    it("rejects unknown hosts and unrelated domains", () => {
      expect(sw.isAllowedTarget("https://example.com/test")).toBe(false);
      expect(sw.isAllowedTarget("http://someother.ozon.com")).toBe(false);
    });

    it("accepts exact allowed domains and their subdomains over http/https", () => {
      expect(sw.isAllowedTarget("https://ozon.ru/")).toBe(true);
      expect(sw.isAllowedTarget("http://ozon.ru/path")).toBe(true);
      expect(sw.isAllowedTarget("https://sub.wildberries.ru/shop")).toBe(true);
      expect(sw.isAllowedTarget("https://deep.sub.domain.ozon.ru/page")).toBe(true);
    });

    it("rejects similarly named but different TLDs or substrings", () => {
      expect(sw.isAllowedTarget("https://ozonru.ru")).toBe(false);
      expect(sw.isAllowedTarget("https://notwildberries.ru")).toBe(false);
    });
  });

  describe("isAllowedActivator", () => {
    it("accepts only exact origins listed in UI_ORIGINS and rejects others", () => {
      // origin must match exactly including scheme and port
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting/page")).toBe(true);
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting")).toBe(true);
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting:8080/page")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost/")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost:5177/some/path")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost:3000/" )).toBe(true);
      expect(sw.isAllowedActivator("https://evil.example.com" )).toBe(false);
    });

    it("returns false for malformed URLs", () => {
      expect(sw.isAllowedActivator(123)).toBe(false);
      expect(sw.isAllowedActivator("not-a-url")).toBe(false);
    });
  });

  it("sendMessageWithRetry retries on failure", async () => {
    let called = 0;
    global.chrome.runtime.lastError = null;
    global.chrome.tabs.sendMessage = jest.fn((tabId, message, cb) => { called += 1; cb(); });
    const ok = await sw.sendMessageWithRetry(1, { type: "X" }, 2);
    expect(ok).toBe(true);
    expect(called).toBeGreaterThanOrEqual(1);
  });

  it("apiUpload throws on non-ok response", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    await expect(sw.apiUpload("https://api.local/upload", { x: 0, y: 0, w: 10, h: 10 }, new Blob())).rejects.toThrow(
      /Ошибка POST/
    );
  });

  it("action icon click reopens selection UI on session tab", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 101;

    await sw.handleActionClick({ id: 101 });

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ isUiVisible: true });
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "SHOW_UI" }),
      expect.any(Function)
    );
  });

  it("action icon click focuses session tab when invoked elsewhere", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 202;

    await sw.handleActionClick({ id: 999 });

    expect(global.chrome.tabs.update).toHaveBeenCalledWith(202, { active: true });
  });

  it("syncUiState shows UI only when awaiting selection", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 777;
    await sw.syncUiState(777);

    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      777,
      expect.objectContaining({ type: "SHOW_UI" }),
      expect.any(Function)
    );

    global.chrome.tabs.sendMessage.mockClear();
    await sw.syncUiState(111);
    expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();

    global.chrome.tabs.sendMessage.mockClear();
    sw.state.status = "idle";
    sw.state.tabId = null;
    await sw.syncUiState(777);

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ isUiVisible: false });
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      777,
      expect.objectContaining({ type: "HIDE_UI" }),
      expect.any(Function)
    );
  });

  it("handleExtensionSuspend hides UI and resets state", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 321;
    sw.state.returnUrl = "http://example.com";

    await sw.handleExtensionSuspend();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ isUiVisible: false });
    expect(global.chrome.storage.local.clear).toHaveBeenCalled();
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      321,
      expect.objectContaining({ type: "HIDE_UI" }),
      expect.any(Function)
    );
    expect(sw.state.status).toBe("idle");
    expect(sw.state.tabId).toBeNull();
    expect(sw.state.returnUrl).toBeNull();
  });

  it("handleExtensionSuspend skips messaging when no tab", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = null;

    await sw.handleExtensionSuspend();

    expect(global.chrome.storage.local.clear).toHaveBeenCalled();
    expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "HIDE_UI" }),
      expect.any(Function)
    );
    expect(sw.state.status).toBe("idle");
  });

});
