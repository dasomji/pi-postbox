<script lang="ts">
  import type { ProjectIcon as ProjectIconData } from "@pi-postbox/protocol";

  let { name, icon, size = "md" }: { name: string; icon?: ProjectIconData; size?: "sm" | "md" } = $props();

  const box = $derived(size === "sm" ? "h-5 w-5 text-[0.6rem]" : "h-11 w-11 text-sm");
</script>

{#if icon?.dataUrl}
  <img class="{box} shrink-0 rounded-md border border-postbox-border bg-postbox-elevated object-contain p-0.5" src={icon.dataUrl} alt="" />
{:else}
  <div
    class="{box} stamp-edge flex shrink-0 items-center justify-center rounded-sm border border-postbox-border-strong bg-postbox-elevated font-display font-bold text-attention-foreground"
  >
    {(name || "?").slice(0, 2).toUpperCase()}
  </div>
{/if}
