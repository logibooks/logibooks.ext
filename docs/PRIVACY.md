# Privacy Policy — Logibooks Techdoc Helper

Effective date: [2026-14-01]

## 1. Introduction

This Privacy Policy explains what information the Logibooks Techdoc Helper extension ("Extension") collects, how it is used, stored, and shared. The Extension is published by [Your Name / Organization] (contact: [support@sw.consulting]).

## 2. What the Extension Does

The Extension helps authorized host pages create screenshots of a user-selected rectangular area on a webpage and upload the resulting PNG to a server endpoint provided by the host page.

## 3. Data Collected

- **Screenshot images (visual content)**: Captured only when the user explicitly activates the Extension via a trusted host page and confirms the selection. The image data is sent to the target upload endpoint specified in the activation request.
- **Target URLs & upload endpoint**: The Extension temporarily holds the `target` and `url` values provided by the activating host page to perform navigation and upload.
- **Authentication token**: If provided by the host page, a token is temporarily stored to authenticate the upload. Tokens are not shared with third parties by the Extension except to the upload endpoint specified by the activating host page.
- **Local extension state**: Non-sensitive state (UI visibility, session status) stored locally in the browser (Chrome `storage.session` / `storage.local`) to survive navigation while the workflow is in progress.
- **No analytics by default**: The Extension does not collect telemetry or analytics unless explicitly added and declared.

## 4. How Data Is Used

- Screenshots and provided data are forwarded only to the upload endpoint specified by the activating host page. The Extension does not forward screenshots to any other servers or external services by itself.
- Local state is only used to restore and maintain the selection UI and session across navigation.

## 5. Sharing & Third Parties

- The Extension itself does not share captured images or tokens with third parties except by uploading to the endpoint the host page provided. The operator of that endpoint will then process/store the upload according to their own policies. Users should verify the privacy practices of the host service before uploading sensitive content.

## 6. Retention

- The Extension does not retain uploaded images. Any retention is handled by the server you uploaded the image to. Local session state is cleared after the workflow finishes or on extension suspension. Tokens are not stored persistently beyond the active session.

## 7. Security

- Data is sent to the specified upload endpoint using the browser's `fetch` API. The extension uses HTTPS for its own UI host origins and recommends host pages use HTTPS for upload endpoints. Do not provide the extension with upload endpoints you do not trust.

## 8. User Controls

- The user may cancel the workflow at any time. To remove all local data, uninstall the extension or clear extension storage via the browser.
- The extension respects user action: screenshots are made only after explicit activation and user selection.

## 9. Permissions Explanation

- The extension requests `tabs`, `scripting`, `storage`, and `webNavigation` to support the features described above. Host permissions (e.g., `http://localhost/*`, `https://logibooks.sw.consulting/*`, `https://*.ozon.ru/*`, `https://*.wildberries.ru/*`) are required for the extension to inject UI into target pages and perform uploads.

## 10. Children

- The Extension is not intended for use by children under the age of 13. Parents should not allow kids to upload images without supervision.

## 11. Changes to the Policy

- We may update this policy; changes will be posted with an updated effective date.

## 12. Contact

For questions, data removal requests, or privacy inquiries contact: [support@sw.consulting].

---

### Minimal Data Use Statement (for Chrome Web Store listing)

This extension captures a screenshot only when you explicitly activate it and confirm a selection. The image and activation parameters are uploaded only to the endpoint supplied by the activating host page. Local storage is used only to persist UI/session state during the operation.

---

**Hosting guidance**

- Preferred: Add this file to your repository and publish via GitHub Pages or your website over HTTPS, then provide the resulting URL in the Chrome Web Store "Privacy Policy" field.
- Quick example (PowerShell):

```powershell
Set-Content -Path privacy.html -Value (Get-Content docs\PRIVACY.md -Raw)
# commit & push to repo, enable GitHub Pages
```
