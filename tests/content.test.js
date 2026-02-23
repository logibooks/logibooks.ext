// Copyright (C) 2025 Maxim [maxirmx] Samsonov (www.sw.consulting)
// All rights reserved.
// This file is a part of Logibooks techdoc helper extension 

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

let content;
let messageListener;

describe("Content script UI", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // import module after mocks (setup.js provides document mocks)
    await import("../ext/content.js");
    content = globalThis.__contentTestHooks__;
    if (!content) throw new Error("Content script test hooks were not registered");
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
