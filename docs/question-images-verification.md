# Question image implementation verification

Recorded 2026-09-07 for #106 and #107–#115. This is implementation evidence,
not a claim that a package has been published or every manual release gate passed.

## Build and process freshness

- Root, workspace packages and lock metadata: `0.5.0`.
- Protocol: `0.1.11`; Android version name `0.5.0`, code `12`.
- Generated Android fingerprint: `4a78469f13be58ffd412e963ca875214d1298a760a87d7b1bf85649d6197aa4f`.
- Final Web build copied into the server at `2026-09-07 16:53:32 UTC`.
- Both existing checkout development listeners were restarted after that build:
  PID `1876204` (port `45795`) at `16:54:08 UTC`, and PID `1876280`
  (port `33109`) at `16:54:09 UTC`.
- `/healthz` on `33109`, observed at `16:54:19 UTC`, reported version `0.5.0`,
  protocol `0.1.11`, profile `development:79522f2660390417`, instance
  `ed31c271-a89c-43a7-b7bf-d68bf9a11391`, and build
  `0.5.0+sha256.d62d47f75ab4b09c`. A fresh import of the built runtime computed
  the identical build ID. Production was not restarted.
- Acceptance tests import the newly built extension in fresh processes.
  Existing interactive Pi sessions still require a **full restart** to replace
  retained modules and register the changed tool schema; this was not forced.

## Automated evidence

- `npm test`: 107 files, 632 tests passed.
- `npm run build`, `npm run typecheck`, Web `check`, Android contract check and
  `git diff --check`: passed; Svelte reported no errors or warnings.
- Clean-install package checks include the native Sharp runtime and every new
  runtime module. The packaged smoke passes image create, image-bearing ordered
  batch/deduplication, removal, immutable history/media, and replay after deleting
  the original local fixture, alongside the pre-existing complete workflow.
- Real-client/server image integration tests additionally cover JPEG/PNG/WebP,
  orientation/metadata stripping, animation/malformed inputs, byte/dimension
  limits, batch isolation, revision replacement/preservation, restart durability,
  interrupted staging, stale targets, expiry, deduplication and missing blobs.
- Android unit suite: 214 tests passed; APK and instrumented APK builds passed.
- Targeted Android emulator suite: all 13 gallery/workflow tests passed, including
  viewer restoration, Back, double-tap zoom, zoomed pan and unzoomed swipe.
- Final full Android instrumented suite completed successfully at `16:58:34 UTC`:
  33 reported cases, zero failures, with six existing opt-in Chat/IME evidence
  checks skipped (27 passed).

## Browser and native interaction evidence

An isolated temporary server used the same final build ID and deterministic,
locally generated fixtures. Chrome was checked at desktop and 390-pixel widths.
Real input events confirmed wheel zoom, touch swipe, arrow-key navigation,
Escape and thumbnail focus restoration. The accessibility tree exposed required
alt text; mobile layout had no horizontal overflow. DOM tests cover independent
missing-media retry, ordering before Answer options and historical rendering.
Temporary screenshots: `/tmp/postbox-gallery-web.png`,
`/tmp/postbox-gallery-mobile.png`, `/tmp/postbox-gallery-viewer-mobile.png`.

Android gesture and restoration evidence comes from an API 26 software emulator,
not a physical device or a human TalkBack session. Physical-device TalkBack,
large-image memory inspection and the full manual Android checklist remain
release checks. No publishing, PR creation or issue closure was performed.
