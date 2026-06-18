<script lang="ts">
  import { dotClass, type DotColor } from "../lib/status";

  let { color }: { color: DotColor } = $props();
</script>

<span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {dotClass[color]}"></span>
