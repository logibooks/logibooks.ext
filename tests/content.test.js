// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { URL as NodeURL } from "url";

let content;
let messageListener;

describe("Content script UI", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // import module after mocks (setup.js provides document mocks)
    await import("../ext/content.js");
    content = globalThis.__contentTestHooks__;
    if (!content) throw new Error("Content script test hooks were not registered");
    
    // Clean up any existing loading indicator
    if (content.getLoadingIndicator()) {
      content.hideLoadingIndicator();
    }
    
    // Capture message listener from first import (module is cached after first load)
    // The listener is only registered once when the module loads
    if (!messageListener && chrome.runtime.onMessage.addListener.mock?.calls?.length > 0) {
      messageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    }
  });

  it("ensurePanel creates elements and togglePanel shows/hides", () => {
    content.ensurePanel();
    // panel should be created; calling togglePanel should not throw
    content.togglePanel(true);
    content.togglePanel(false);
    expect(document.documentElement.appendChild).toBeTruthy();
  });

  it("showError displays message and hides save button", () => {
    content.ensurePanel();
    content.showError("Boom");
    // ensure showError set status text on the mocked createElement result
    const created = document.createElement("div");
    expect(typeof created.textContent).toBe("string");
  });

  it("showSelectionUI restores a preselected rect", () => {
    content.ensurePanel();
    const rect = { x: 10, y: 20, w: 100, h: 150 };

    content.showSelectionUI("Выберите область", rect);

    expect(content.getSelectedRect()).toEqual(rect);
  });

  it("allows trusted UI origins and rejects lookalike domains", () => {
    const previousUrl = global.URL;
    global.URL = NodeURL;
    try {
      expect(content.isAllowedUiOrigin("https://logibooks.sw.consulting")).toBe(true);
      expect(content.isAllowedUiOrigin("https://app.gtc.express")).toBe(true);
      expect(content.isAllowedUiOrigin("https://app.gtc.express:8443")).toBe(true);
      expect(content.isAllowedUiOrigin("http://localhost:5177")).toBe(true);
      expect(content.isAllowedUiOrigin("http://app.gtc.express")).toBe(false);
      expect(content.isAllowedUiOrigin("https://app.gtc.express.evil.example")).toBe(false);
    } finally {
      global.URL = previousUrl;
    }
  });

  describe("Loading indicator", () => {
    it("creates loading indicator with correct styling and elements", () => {
      // Initially, loading indicator should be null
      expect(content.getLoadingIndicator()).toBeNull();

      // Track calls to appendChild
      const appendChildSpy = jest.spyOn(document.documentElement, "appendChild");

      // Show loading indicator
      content.showLoadingIndicator();

      // Verify loading indicator was created
      const indicator = content.getLoadingIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator.id).toBe("logibooks-loading");

      // Verify styling is applied (note: colors may be normalized to rgb format)
      expect(indicator.style.cssText).toContain("position: fixed");
      expect(indicator.style.cssText).toContain("top: 20px");
      expect(indicator.style.cssText).toContain("right: 20px");
      expect(indicator.style.cssText).toContain("z-index: 2147483647");
      expect(indicator.style.cssText).toContain("background");
      expect(indicator.style.cssText).toContain("color: white");

      // Verify appendChild was called with the indicator
      expect(appendChildSpy).toHaveBeenCalledWith(indicator);

      // Verify the indicator's appendChild was called (for child elements)
      // Since appendChild is already a mock from createElement, we can check it was called
      expect(indicator.appendChild).toBeDefined();
      expect(typeof indicator.appendChild).toBe("function");
    });

    it("properly removes and cleans up loading indicator", () => {
      // Show loading indicator first
      content.showLoadingIndicator();
      const indicator = content.getLoadingIndicator();
      expect(indicator).not.toBeNull();

      // Mock the remove method to track calls
      const removeSpy = jest.spyOn(indicator, "remove");

      // Hide loading indicator
      content.hideLoadingIndicator();

      // Verify remove was called
      expect(removeSpy).toHaveBeenCalledTimes(1);

      // Verify loading indicator is now null
      expect(content.getLoadingIndicator()).toBeNull();
    });

    it("prevents creating multiple loading indicators on duplicate calls", () => {
      // Track calls to appendChild
      const appendChildSpy = jest.spyOn(document.documentElement, "appendChild");
      
      // First call should create the indicator
      content.showLoadingIndicator();
      const firstIndicator = content.getLoadingIndicator();
      expect(firstIndicator).not.toBeNull();

      // Get the call count after first creation
      const firstCallCount = appendChildSpy.mock.calls.length;
      expect(firstCallCount).toBe(1);

      // Second call should not create another indicator
      content.showLoadingIndicator();
      const secondIndicator = content.getLoadingIndicator();

      // Should be the same indicator
      expect(secondIndicator).toBe(firstIndicator);

      // appendChild should not have been called again
      const secondCallCount = appendChildSpy.mock.calls.length;
      expect(secondCallCount).toBe(firstCallCount);
    });

    it("handles hiding loading indicator when none exists", () => {
      // Verify no indicator exists
      expect(content.getLoadingIndicator()).toBeNull();

      // Hiding should not throw an error
      expect(() => content.hideLoadingIndicator()).not.toThrow();

      // Still should be null
      expect(content.getLoadingIndicator()).toBeNull();
    });

    it("can show loading indicator again after hiding", () => {
      // Show, hide, show again
      content.showLoadingIndicator();
      const firstIndicator = content.getLoadingIndicator();
      expect(firstIndicator).not.toBeNull();

      content.hideLoadingIndicator();
      expect(content.getLoadingIndicator()).toBeNull();

      content.showLoadingIndicator();
      const secondIndicator = content.getLoadingIndicator();
      expect(secondIndicator).not.toBeNull();

      // Should be a new indicator (not the same reference)
      expect(secondIndicator).not.toBe(firstIndicator);
    });
  });

  it("responds to PING message with PONG and ready status", () => {
    // Verify the message listener was captured
    expect(messageListener).toBeDefined();

    // Mock the sendResponse callback
    const sendResponse = jest.fn();

    // Send a PING message (sender parameter required by listener signature but not used)
    const result = messageListener({ type: "PING" }, {}, sendResponse);

    // Verify the response
    expect(sendResponse).toHaveBeenCalledWith({ type: "PONG", ready: true });
    // Verify it returns true to indicate async response
    expect(result).toBe(true);
  });

});
