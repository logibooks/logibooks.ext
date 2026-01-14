# Permission Justification for Logibooks Techdoc Helper

This document describes why each permission requested by the extension is required and how it is used. Include a link to this file in your Chrome Web Store listing "Additional details" or host it as the privacy/permission reference.

## Permissions

- `tabs`
  - Purpose: Identify and operate on the active tab when the extension navigates or captures the visible page.
  - Usage: The extension uses `tabs` to read the active tab, update its URL for navigation to the requested `target`, and to capture the visible tab image via Chrome APIs.

- `scripting`
  - Purpose: Inject and execute the selection UI script (`content.js`) into target pages.
  - Usage: Used to programmatically insert the selection overlay UI when the extension activates on target pages where automatic content script injection is not available.

- `storage`
  - Purpose: Persist UI/session state across navigation so the selection UI survives page navigation.
  - Usage: We store minimal, non-sensitive state such as `isUiVisible`, `status`, `tabId`, and transient session parameters to rehydrate the UI after the extension navigates the tab.

- `webNavigation`
  - Purpose: Detect navigation events (commits, reloads) to correctly finish or restore UX flows after navigation.
  - Usage: The extension listens for navigation events to know when to re-sync UI or finalize/abort a session.

## Host Permissions

- `https://logibooks.sw.consulting/*`
- `http://localhost/*`
- `https://*.ozon.ru/*`
- `https://*.wildberries.ru/*`

Purpose: These host patterns allow the extension to inject UI and perform programmatic actions on pages that are part of the workflow. We request only the needed host patterns to minimize access scope. If broader coverage is required, we will explain it in the store listing and request explicit runtime permission when necessary.

## Additional Notes

- The extension captures page pixels only after explicit user activation and after the user confirms a selection. It does not autonomously capture or transmit browsing data.
- Tokens sent by the activating page are used only to authenticate the image upload to the specified target endpoint; they are not retained beyond the active session.

If you need a single-paragraph justification for the Chrome Web Store "Additional details" field, use:

> The extension needs `tabs`, `scripting`, `storage`, and `webNavigation` to implement a workflow where a trusted host page asks the extension to navigate to a target page, show an in-page selection UI, capture the selected area, and upload it to the host-provided endpoint. Host permissions are restricted to the host UI and partner domains required for the workflow.