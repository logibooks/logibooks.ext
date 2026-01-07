import { jest, describe, it, expect, beforeEach } from "@jest/globals";

describe("Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

    it("should send a message to the background script", async () => {
    const message = { type: "TEST_MESSAGE" };
    chrome.runtime.sendMessage(message);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(message);
  })

});