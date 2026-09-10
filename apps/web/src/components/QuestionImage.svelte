<script lang="ts">
  import { questionImagePath, type QuestionImage } from "@pi-postbox/protocol";
  let { image, eager = false, onopen }: { image: QuestionImage; eager?: boolean; onopen?: (event: MouseEvent) => void } = $props();
  let failed = $state(false);
  let loaded = $state(false);
  let attempt = $state(0);
</script>

<div class="image" style:aspect-ratio="{image.width} / {image.height}" aria-busy={!failed && !loaded}>
  {#if failed}
    <div class="placeholder" role="status">
      <p>{image.alt}</p><p>Image unavailable</p>
      <button type="button" onclick={(event) => { event.stopPropagation(); failed = false; loaded = false; attempt++; }}>Retry image</button>
    </div>
  {:else}
    {#key attempt}
      {#if onopen}
      <button type="button" class="thumbnail" aria-label="Open image: {image.alt}" onclick={onopen}>
        <img src={questionImagePath(image.imageId)} alt={image.alt} width={image.width} height={image.height}
          loading="lazy" decoding="async" draggable="false" onload={() => loaded = true} onerror={() => failed = true} />
      </button>
      {:else}
      <img src={questionImagePath(image.imageId)} alt={image.alt} width={image.width} height={image.height}
        loading={eager ? "eager" : "lazy"} decoding="async" draggable="false"
        onload={() => loaded = true} onerror={() => failed = true} />
      {/if}
    {/key}
    {#if !loaded}<span class="loading" role="status">Loading image…</span>{/if}
  {/if}
</div>

<style>
  .image { position: relative; width: 100%; height: 100%; max-height: 100%; min-height: 3rem; }
  img { display: block; width: 100%; height: 100%; max-height: 100%; object-fit: contain; }
  .placeholder { display: grid; place-content: center; padding: 1rem; min-height: 8rem; max-height: 100%; overflow: auto; background: #333; color: white; }
  button { text-decoration: underline; padding: .6rem; }
  .thumbnail { display: block; width: 100%; height: 100%; padding: 0; }
  .loading { position: absolute; left: .5rem; bottom: .5rem; background: #222; color: white; padding: .25rem; }
</style>
