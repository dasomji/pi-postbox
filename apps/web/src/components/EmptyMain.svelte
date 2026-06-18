<script lang="ts">
  let { title, message }: { title: string; message: string } = $props();
</script>

<div class="flex h-full flex-col items-center justify-center px-6 text-center">
  <h2 class="text-2xl font-semibold text-postbox-text">{title}</h2>
  <p class="mt-2 max-w-md text-postbox-subtle">{message}</p>
</div>
