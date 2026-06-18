<script lang="ts">
  import { badgeToneClass, type BadgeTone } from "../lib/statusStyles";

  let { tone = "neutral", children }: { tone?: BadgeTone; children: import("svelte").Snippet } = $props();
</script>

<span class="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 {badgeToneClass(tone)}">
  {@render children()}
</span>
