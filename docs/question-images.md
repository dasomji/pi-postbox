# Question image galleries

`write_question` accepts agent-authored local images on `create`, each draft in
`create_batch`, and `revise`:

```json
{
  "action": "create",
  "requestId": "review-layout-1",
  "question": "Which layout should we ship?",
  "ambiguity": "Compare the spacing in the two screenshots.",
  "options": [{ "value": "first", "label": "First layout" }],
  "images": [
    { "path": "artifacts/first.png", "alt": "Compact settings panel", "caption": "First layout" },
    { "path": "/tmp/second.webp", "alt": "Settings panel with more spacing" }
  ]
}
```

Relative paths resolve from the originating registered Pi Session's working
directory; absolute paths also work. Every path must identify a readable regular
file. Alt text must contain non-whitespace content. Captions are optional.

Create accepts an omitted or empty gallery. Revise preserves images when `images`
is omitted, removes the current gallery when it is `[]`, and replaces the entire
ordered gallery when non-empty. Revise still requires the current `expectedRevision`
and `expectedOwnerRevision`, question and ambiguity. Old revisions retain their
exact gallery, descriptions and captions. Chat-suggested options preserve images.

Limits apply to each Question independently:

| Constraint | Limit |
| --- | --- |
| Images | 8 |
| Source bytes per image | 8 MiB |
| Total source bytes | 24 MiB |
| Width or height | 8,192 pixels |
| Decoded pixels | 25 million |
| Alt text and caption | 2,000 characters each |
| Uncommitted staging lifetime | One hour |

JPEG, PNG and static WebP are supported. The file extension must match the actual
content. GIF, SVG, animated PNG/WebP, malformed files and other formats are rejected.
The server checks signatures and decoded content, applies orientation and strips
metadata before storing re-encoded bytes. Remote URLs, human uploads, Answer
attachments and Markdown images are not supported.

Preparation or validation failure never commits part of a gallery. Batch receipts
retain input order and report typed rejection codes for failed items; independent
valid items can succeed. A failed parent still follows the existing hierarchy
rules. Retry a temporary staging failure using the same request ID. A create
replay checks for the existing Question before opening local files. For a stale
revision, read the current tokens and revise again. A target/connection change
requires restaging against the newly verified target. Cancelling preparation
stops before mutation; uploads already staged expire automatically.

Local attachment paths and original filenames are never sent, stored in Question
content, or returned in receipts. Binary uploads use the health-verified server
and a token issued to the registered Pi connection. Public metadata contains only
opaque image IDs, authoritative media type/size/dimensions, alt text and caption.
Compact discovery, status, ownership and Answer receipts do not expand galleries.
Notifications and protocol messages never contain image bytes.

The filesystem store is adjacent to the database at `<database-path>.images`.
Back up that directory together with SQLite. SQLite owns blob metadata, claims
and ordered revision references; identical sanitized content is deduplicated.
Cleanup runs with the lifecycle sweep and preserves every retained revision and
unexpired staging claim. Interrupted temporary files age out after one hour.
Missing or corrupt media produces `image_storage_unavailable` with an opaque-ID
operator diagnostic; Question JSON and Answer controls remain usable. Restore
missing media from a matching backup. Do not manually delete referenced blobs.

`GET /media/images/<opaque-image-id>` serves only committed, retained images with
private immutable caching, ETag, authoritative content headers and `nosniff`.
Media uses the existing Tailnet-private/external-authenticated-proxy boundary:
there is no new application authentication or public sharing model. Browser
origin checks still cover mutations, including image staging. Media redirects
are not followed by staging or the Android HTTP loader.

Web displays galleries before options, with a shared viewer for current and
historical revisions. Use Escape, arrows, Tab, zoom buttons, wheel/double-click,
or touch pinch/double-tap/swipe; swipe navigation is disabled during zoomed pan.
Android provides Back, close/navigation controls, pinch/double-tap and pan, with
saved viewer position and zoom across configuration changes. Both clients offer
independent retry states. Android verifies health before fetching media, derives
URLs from the current base URL and IDs, downsamples to display constraints, and
limits its shared cache to 32 MiB memory and 128 MiB disk.

Implementation references: [Sharp bounded decoding](https://sharp.pixelplumbing.com/api-constructor/)
and [metadata handling](https://sharp.pixelplumbing.com/api-output/).
Android uses Coil 3.2.0 with OkHttp because its
[Kotlin 2.1.20 / Compose 1.8 dependency baseline](https://coil-kt.github.io/coil/changelog/#320---may-13-2025)
matches this repository; caching follows the [upstream loader documentation](https://coil-kt.github.io/coil/image_loaders/).

After updating, rebuild and restart the checkout server. Compare `/healthz`'s
application/protocol/profile/instance/build identity with the built runtime and
confirm its start time is newer than the build. Fully restart existing Pi sessions
to replace retained protocol modules and register the new `write_question` schema.
The Android build and generated contract must match the server protocol exactly.
