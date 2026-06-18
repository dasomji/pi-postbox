<script lang="ts">
  let { label, value }: { label: string; value: string } = $props();
</script>

<div class="grid grid-cols-[7rem_1fr] gap-3">
  <dt class="text-postbox-muted">{label}</dt>
  <dd class="break-all text-postbox-subtle">{value}</dd>
</div>
