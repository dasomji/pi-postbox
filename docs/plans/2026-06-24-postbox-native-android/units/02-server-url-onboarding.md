# Unit 02 — Server URL onboarding and health verification

## Goal
Let the developer configure the Postbox server URL on first launch and verify it before the app uses it.

## Scope
- First-run screen with server URL input.
- Optional QR scan/deep-link can be deferred unless the user asks for it now.
- Normalize and validate explicit URLs; prefer Tailnet HTTPS URLs.
- Call `GET /healthz` and show service/version/connection result.
- Persist the verified base URL in app preferences.
- Allow editing/replacing the saved URL from settings.

## Test scenarios
- Invalid URL is rejected before network call.
- Unreachable URL shows a clear retryable error.
- Non-Postbox JSON at `/healthz` is rejected.
- Valid Postbox `/healthz` saves the URL and enters the app.
- Saved URL is loaded on app restart.

## Notes
Do not implement automatic discovery, port scanning, package-local autostart, or local metadata fallback on Android. Android should consume the explicit Tailnet URL the operator provides.
