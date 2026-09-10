<script lang="ts">
  import type { QuestionImage as ImageMetadata } from "@pi-postbox/protocol";
  import QuestionImage from "./QuestionImage.svelte";
  import QuestionImageViewer from "./QuestionImageViewer.svelte";
  let { images = [] }: { images?: ImageMetadata[] } = $props();
  let selected = $state<number | null>(null);
  let opener = $state<HTMLElement | null>(null);
  const galleryIdentity = $derived(JSON.stringify(images));
  $effect(() => { galleryIdentity; selected = null; });
</script>

{#if images.length}
  <section aria-label="Question images" class:multiple={images.length > 1}>
    {#each images as image, index}
      <figure>
        <div class="preview" style:aspect-ratio="{image.width} / {image.height}">{#key image.imageId}<QuestionImage {image} onopen={(event) => { opener = event.currentTarget as HTMLElement; selected = index; }} />{/key}</div>
        <button type="button" aria-label="Open image {index + 1}: {image.alt}" onclick={(event) => { opener = event.currentTarget; selected = index; }}>Inspect image {index + 1}</button>
        {#if image.caption}<figcaption>{image.caption}</figcaption>{/if}
      </figure>
    {/each}
  </section>
  {#if selected !== null}<QuestionImageViewer {images} initialIndex={selected} {opener} onclose={() => selected = null} />{/if}
{/if}

<style>
  section { display: grid; align-items: start; gap: 1rem; margin: 1.25rem 0; }
  figure { position: relative; min-width: 0; border: 1px solid #8886; border-radius: .5rem; overflow: hidden; }
  .preview { max-height: 24rem; overflow: hidden; }
  button { display: block; width: 100%; padding: .65rem; text-decoration: underline; }
  button:focus-visible { outline: 3px solid #3289be; outline-offset: -3px; }
  figcaption { padding: .6rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (min-width: 480px) { .multiple { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
