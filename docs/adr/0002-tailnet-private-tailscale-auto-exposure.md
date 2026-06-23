# Tailnet-private Tailscale Auto-exposure

Pi Postbox allows `pi-postbox-server` to best-effort expose the dashboard through Tailnet-private Tailscale Serve during startup, even though the original v1 deployment model treated Tailscale/lizardtail exposure as external. This favors the core Postbox workflow — opening attention cards from another device and copying a correct `PI_POSTBOX_URL` for remote Pi machines — while constraining the side effect: startup must still work locally if Tailscale is missing or broken, must never enable Funnel/public exposure, must never clobber an existing non-Postbox Serve mapping, and can be disabled with an explicit operator/CI opt-out.

## Consequences

Postbox now owns a narrow Tailscale Serve integration rather than requiring an external wrapper for the common Tailnet-private case. The integration must stay idempotent, inspect existing Serve state before mutation, and treat every Tailscale failure as an operator diagnostic instead of a server startup failure. Remote Pi machines still opt in explicitly by setting `PI_POSTBOX_URL` from startup/status output; Postbox does not push configuration or perform cross-machine discovery.
