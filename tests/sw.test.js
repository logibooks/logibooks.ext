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
    it("accepts trusted UI host suffixes and localhost while rejecting others", () => {
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting/page")).toBe(true);
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting")).toBe(true);
      expect(sw.isAllowedActivator("https://logibooks.sw.consulting:8080/page")).toBe(true);
      expect(sw.isAllowedActivator("https://support.sw.consulting/page")).toBe(true);
      expect(sw.isAllowedActivator("https://app.gtc.express/page")).toBe(true);
      expect(sw.isAllowedActivator("https://app.gtc.express:8443/page")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost/")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost:5177/some/path")).toBe(true);
      expect(sw.isAllowedActivator("http://localhost:3000/" )).toBe(true);
      expect(sw.isAllowedActivator("http://app.gtc.express/page")).toBe(false);
      expect(sw.isAllowedActivator("https://app.gtc.express.evil.example")).toBe(false);
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

  it("syncUiState includes the last saved selection rect", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 555;
    await sw.saveLastSelectionRect({ x: 11, y: 22, w: 333, h: 444 });

    global.chrome.tabs.sendMessage.mockClear();
    await sw.syncUiState(555);

    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      555,
      expect.objectContaining({
        type: "SHOW_UI",
        rect: { x: 11, y: 22, w: 333, h: 444 }
      }),
      expect.any(Function)
    );
  });

  it("handleExtensionSuspend hides UI and resets state", async () => {
    sw.state.status = "awaiting_selection";
    sw.state.tabId = 321;
    sw.state.returnUrl = "http://example.com";

    await sw.handleExtensionSuspend();

    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ isUiVisible: false });
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

    expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "HIDE_UI" }),
      expect.any(Function)
    );
    expect(sw.state.status).toBe("idle");
  });

  describe("Content script health checking", () => {
    describe("pingContentScript", () => {
      it("returns true when content script responds with PONG", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          // Simulate immediate response
          callback({ type: "PONG" });
        });

        const result = await sw.pingContentScript(123);

        expect(result).toBe(true);
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          123,
          { type: "PING" },
          expect.any(Function)
        );
      });

      it("returns false when content script does not respond within timeout", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((_tabId, _message, _callback) => {
          // Never call callback to simulate timeout
          // The promise should resolve after CONTENT_SCRIPT_PING_TIMEOUT
        });

        const start = Date.now();
        const result = await sw.pingContentScript(456);
        const elapsed = Date.now() - start;

        expect(result).toBe(false);
        // Should have waited approximately CONTENT_SCRIPT_PING_TIMEOUT (with some tolerance)
        expect(elapsed).toBeGreaterThanOrEqual(sw.CONTENT_SCRIPT_PING_TIMEOUT - 100);
        expect(elapsed).toBeLessThan(sw.CONTENT_SCRIPT_PING_TIMEOUT + 500);
      });

      it("returns false when chrome.runtime.lastError is set", async () => {
        global.chrome.runtime.lastError = { message: "Could not establish connection" };
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback({ type: "PONG" });
        });

        const result = await sw.pingContentScript(789);

        expect(result).toBe(false);
      });

      it("returns false when response type is not PONG", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback({ type: "SOMETHING_ELSE" });
        });

        const result = await sw.pingContentScript(111);

        expect(result).toBe(false);
      });

      it("returns false when response is null or undefined", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback(null);
        });

        const result = await sw.pingContentScript(222);

        expect(result).toBe(false);
      });
    });

    describe("waitForContentScriptReady", () => {
      it("returns true on first attempt when content script is ready", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback({ type: "PONG" });
        });

        const result = await sw.waitForContentScriptReady(333);

        expect(result).toBe(true);
        // Should only call once if successful on first attempt
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
      });

      it("retries up to MAX_PING_ATTEMPTS times before giving up", async () => {
        global.chrome.runtime.lastError = null;
        let callCount = 0;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callCount++;
          // Never respond with PONG to force all retries
          callback({ type: "NOPE" });
        });

        const result = await sw.waitForContentScriptReady(444);

        expect(result).toBe(false);
        // Should attempt exactly CONTENT_SCRIPT_MAX_PING_ATTEMPTS times
        expect(callCount).toBe(sw.CONTENT_SCRIPT_MAX_PING_ATTEMPTS);
      });

      it("returns true on second attempt after initial failure", async () => {
        global.chrome.runtime.lastError = null;
        let callCount = 0;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callCount++;
          if (callCount === 1) {
            // First attempt fails
            callback(null);
          } else {
            // Second attempt succeeds
            callback({ type: "PONG" });
          }
        });

        const result = await sw.waitForContentScriptReady(555);

        expect(result).toBe(true);
        expect(callCount).toBe(2);
      });

      it("returns true on last attempt when content script finally responds", async () => {
        global.chrome.runtime.lastError = null;
        let callCount = 0;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callCount++;
          if (callCount < sw.CONTENT_SCRIPT_MAX_PING_ATTEMPTS) {
            // First (MAX-1) attempts fail
            callback(null);
          } else {
            // Last attempt succeeds
            callback({ type: "PONG" });
          }
        });

        const result = await sw.waitForContentScriptReady(666);

        expect(result).toBe(true);
        expect(callCount).toBe(sw.CONTENT_SCRIPT_MAX_PING_ATTEMPTS);
      });

      it("waits between retry attempts", async () => {
        global.chrome.runtime.lastError = null;
        let callCount = 0;
        
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callCount++;
          if (callCount < 3) {
            callback(null);
          } else {
            callback({ type: "PONG" });
          }
        });

        const start = Date.now();
        await sw.waitForContentScriptReady(777);
        const elapsed = Date.now() - start;

        // Should have 2 delays of CONTENT_SCRIPT_PING_DELAY between 3 attempts
        // Total time should be roughly 2 * CONTENT_SCRIPT_PING_DELAY (allowing some tolerance)
        expect(callCount).toBe(3);
        const expectedDelay = 2 * sw.CONTENT_SCRIPT_PING_DELAY;
        expect(elapsed).toBeGreaterThanOrEqual(expectedDelay - 100);
        expect(elapsed).toBeLessThan(expectedDelay + 500);
      });
    });

    describe("injectContentScript", () => {
      it("successfully injects content script and waits for initialization", async () => {
        global.chrome.scripting = {
          executeScript: jest.fn(async () => {})
        };

        const start = Date.now();
        await sw.injectContentScript(888);
        const elapsed = Date.now();

        expect(global.chrome.scripting.executeScript).toHaveBeenCalledWith({
          target: { tabId: 888 },
          files: ["content.js"]
        });
        
        // Production code has a hardcoded 300ms delay for content script initialization
        // Verify the delay is approximately 300ms (with reasonable tolerance for test execution time)
        expect(elapsed - start).toBeGreaterThanOrEqual(290);
        expect(elapsed - start).toBeLessThan(500);
      });

      it("silently handles injection failure without throwing", async () => {
        global.chrome.scripting = {
          executeScript: jest.fn(async () => {
            throw new Error("Injection failed: insufficient permissions");
          })
        };

        // Should not throw
        await expect(sw.injectContentScript(999)).resolves.toBeUndefined();
      });

      it("silently handles CSP restriction errors", async () => {
        global.chrome.scripting = {
          executeScript: jest.fn(async () => {
            throw new Error("Refused to execute inline script");
          })
        };

        await expect(sw.injectContentScript(1001)).resolves.toBeUndefined();
      });
    });

    describe("handleActivation integration", () => {
      beforeEach(() => {
        // Mock chrome.scripting for injection tests
        global.chrome.scripting = {
          executeScript: jest.fn(async () => {})
        };
        
        // Mock chrome.tabs.update for navigation
        global.chrome.tabs.update = jest.fn(async () => {});
        
        // Mock chrome.tabs.onUpdated for navigation completion
        global.chrome.tabs.onUpdated = {
          addListener: jest.fn((listener) => {
            // Immediately simulate tab load complete
            setTimeout(() => {
              listener(1234, { status: "complete" });
              listener(2345, { status: "complete" });
              listener(3456, { status: "complete" });
            }, 10);
          }),
          removeListener: jest.fn()
        };
        
        // Mock chrome.storage for state persistence
        global.chrome.storage.local.set = jest.fn(async () => {});
        
        // Reset state
        if (sw.resetState) sw.resetState();
      });

      it("shows UI when content script is ready on first check", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          if (message.type === "PING") {
            callback({ type: "PONG" });
          } else if (message.type === "SHOW_UI") {
            callback();
          } else {
            callback();
          }
        });

        const payload = {
          url: "https://ozon.ru/product/123",
          target: "https://api.local/upload",
          token: "test-token"
        };

        await sw.handleActivation(1234, "https://logibooks.sw.consulting/page", payload);

        // Should navigate
        expect(global.chrome.tabs.update).toHaveBeenCalledWith(1234, expect.objectContaining({
          url: payload.url,
          active: true
        }));
        
        // Should NOT inject (content script was ready)
        expect(global.chrome.scripting.executeScript).not.toHaveBeenCalled();
        
        // Should send SHOW_UI message
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          1234,
          expect.objectContaining({ type: "SHOW_UI" }),
          expect.any(Function)
        );
      }, 10000);

      it("injects content script when initial ping fails and retry succeeds", async () => {
        let pingCallCount = 0;
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          if (message.type === "PING") {
            pingCallCount++;
            if (pingCallCount <= sw.CONTENT_SCRIPT_MAX_PING_ATTEMPTS) {
              // First MAX_PING_ATTEMPTS pings fail (first waitForContentScriptReady)
              callback(null);
            } else {
              // After injection, pings succeed
              callback({ type: "PONG" });
            }
          } else if (message.type === "SHOW_UI") {
            callback();
          } else {
            callback();
          }
        });

        const payload = {
          url: "https://wildberries.ru/catalog/12345",
          target: "https://api.local/upload",
          token: "test-token-2"
        };

        await sw.handleActivation(2345, "http://localhost:3000/", payload);

        // Should try to inject after initial failure
        expect(global.chrome.scripting.executeScript).toHaveBeenCalledWith({
          target: { tabId: 2345 },
          files: ["content.js"]
        });
        
        // Should eventually show UI after successful injection
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          2345,
          expect.objectContaining({ type: "SHOW_UI" }),
          expect.any(Function)
        );
      }, 15000);

      it("reports error when content script never becomes ready", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          if (message.type === "PING") {
            // Always fail PING
            callback(null);
          } else if (message.type === "SHOW_ERROR") {
            callback();
          } else {
            callback();
          }
        });

        const payload = {
          url: "https://ozon.ru/category/test",
          target: "https://api.local/upload",
          token: "test-token-3"
        };

        await sw.handleActivation(3456, "https://logibooks.sw.consulting", payload);

        // Should try to inject
        expect(global.chrome.scripting.executeScript).toHaveBeenCalled();
        
        // Should NOT show UI (content script never ready)
        expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
          3456,
          expect.objectContaining({ type: "SHOW_UI" }),
          expect.any(Function)
        );
        
        // Should report error with appropriate message
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          3456,
          expect.objectContaining({
            type: "SHOW_ERROR",
            message: expect.stringContaining("Не удалось активировать расширение")
          }),
          expect.any(Function)
        );
      }, 25000);

      it("validates payload and reports errors for missing url", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback();
        });

        const payload = {
          target: "https://api.local/upload",
          token: "test-token"
        };

        await sw.handleActivation(4567, "https://logibooks.sw.consulting", payload);

        // Should report error with appropriate message
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          4567,
          expect.objectContaining({
            type: "SHOW_ERROR",
            message: expect.stringContaining("Ошибка выбора страницы (1)")
          }),
          expect.any(Function)
        );
        
        // Should NOT navigate
        expect(global.chrome.tabs.update).not.toHaveBeenCalled();
      });

      it("validates payload and reports errors for disallowed target URL", async () => {
        global.chrome.runtime.lastError = null;
        global.chrome.tabs.sendMessage = jest.fn((tabId, message, callback) => {
          callback();
        });

        const payload = {
          url: "https://evil.example.com/page",
          target: "https://api.local/upload",
          token: "test-token"
        };

        await sw.handleActivation(5678, "https://logibooks.sw.consulting", payload);

        // Should report error with appropriate message
        expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
          5678,
          expect.objectContaining({
            type: "SHOW_ERROR",
            message: expect.stringContaining("URL не разрешен")
          }),
          expect.any(Function)
        );
        
        // Should NOT navigate
        expect(global.chrome.tabs.update).not.toHaveBeenCalled();
      });
    });
  });

});
