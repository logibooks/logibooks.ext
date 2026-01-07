# Extension Testing

This directory contains comprehensive unit and integration tests for the Logibooks browser extension.

## Test Structure

```
tests/
├── setup.js          # Jest setup and Chrome API mocks
├── content.test.js    # Content script unit tests
├── sw.test.js        # Service worker unit tests  
└── integration.test.js # End-to-end integration tests
```

## Running Tests

### Locally

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run linting
npm run lint
```

### GitHub Actions

Tests automatically run on:
- Push to `main` or `develop` branches
- Pull requests to `main`

The CI pipeline includes:
- ✅ **Multi-Node testing** (18.x, 20.x, 22.x)
- ✅ **Linting** with ESLint
- ✅ **Coverage reporting** to Codecov
- ✅ **Security scanning** for vulnerabilities
- ✅ **Extension packaging** validation

## Test Coverage

### Content Script Tests (`content.test.js`)
- ✅ Message handling (presence queries, activation)
- ✅ URL validation and parameter checking  
- ✅ UI state management (show/hide panels)
- ✅ Selection rectangle calculation
- ✅ Panel creation and interaction
- ✅ Keyboard shortcuts (Escape key)
- ✅ Mouse selection workflow

### Service Worker Tests (`sw.test.js`)
- ✅ Message routing and validation
- ✅ State machine transitions
- ✅ Activation payload validation
- ✅ Screenshot capture and processing
- ✅ Upload error handling
- ✅ Session management
- ✅ UI visibility persistence
- ✅ Navigation handling

### Integration Tests (`integration.test.js`)
- ✅ End-to-end workflow completion
- ✅ Cancellation scenarios (button, Escape, X button)
- ✅ Error recovery workflows  
- ✅ Cross-browser compatibility
- ✅ Security validation (untrusted sources, URL schemes)

## Mocking Strategy

### Chrome Extension APIs
All Chrome APIs are mocked in `setup.js`:
- `chrome.runtime` (messaging, onMessage)
- `chrome.tabs` (navigation, capture)
- `chrome.storage` (local storage)
- `chrome.action` (toolbar button)

### DOM and Browser APIs
- `document` createElement, event handling
- `window` messaging, devicePixelRatio
- `URL` constructor validation
- `fetch` for API calls
- Canvas/Blob for image processing

## State Machine Testing

The tests validate all state transitions:

```
"idle" → "navigating" → "awaiting_selection" → "uploading" → "idle"
                 ↘                      ↙
                   "idle" (cancel/error)
```

## Security Testing

- ✅ Malicious message source rejection
- ✅ URL scheme validation (javascript: blocking)
- ✅ Parameter size limits
- ✅ Input sanitization

## Coverage Goals

- **Statements**: >90%
- **Branches**: >85% 
- **Functions**: >90%
- **Lines**: >90%

## Adding New Tests

1. **Unit tests**: Add to appropriate `*.test.js` file
2. **Integration tests**: Add to `integration.test.js`
3. **New mocks**: Update `setup.js`
4. **Coverage**: Verify with `npm run test:coverage`

## Debugging Tests

```bash
# Run specific test file
npx jest tests/content.test.js

# Run specific test case
npx jest -t "should handle activation messages"

# Debug mode
npx jest --detectOpenHandles --verbose
```