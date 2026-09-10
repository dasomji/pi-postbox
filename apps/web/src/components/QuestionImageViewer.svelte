<script lang="ts">
  import type { QuestionImage as ImageMetadata } from "@pi-postbox/protocol";
  import { modalFocus } from "../lib/modalFocus";
  import QuestionImage from "./QuestionImage.svelte";
  let { images, initialIndex, opener, onclose }: { images: ImageMetadata[]; initialIndex: number; opener: HTMLElement | null; onclose: () => void } = $props();
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  let zoom = $state(1);
  let x = $state(0);
  let y = $state(0);
  let dialog: HTMLDialogElement;
  const pointers = new Map<number, { x: number; y: number }>();
  let startX = 0; let startY = 0; let lastTap = 0; let moved = false; let pinched = false;
  function change(delta: number) {
    index = Math.max(0, Math.min(images.length - 1, index + delta));
    zoom = 1; x = 0; y = 0;
  }
  function scale(value: number) { zoom = Math.max(1, Math.min(6, value)); if (zoom === 1) { x = 0; y = 0; } }
  function toggleZoom() { scale(zoom === 1 ? 2.5 : 1); }
  function keydown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") { event.preventDefault(); change(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); change(1); }
    if (event.key === "+" || event.key === "=") scale(zoom * 1.3);
    if (event.key === "-") scale(zoom / 1.3);
  }
  function down(event: PointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) { startX = event.clientX; startY = event.clientY; moved = false; pinched = false; }
    else pinched = true;
  }
  function move(event: PointerEvent) {
    const previous = pointers.get(event.pointerId); if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      if (before > 0) scale(zoom * Math.hypot(next.x - other.x, next.y - other.y) / before);
    } else if (zoom > 1) {
      const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
      x = Math.max(-bounds.width * (zoom - 1) / 2, Math.min(bounds.width * (zoom - 1) / 2, x + next.x - previous.x));
      y = Math.max(-bounds.height * (zoom - 1) / 2, Math.min(bounds.height * (zoom - 1) / 2, y + next.y - previous.y));
    }
    if (Math.hypot(next.x - startX, next.y - startY) > 12) moved = true;
    pointers.set(event.pointerId, next);
  }
  function up(event: PointerEvent) {
    if (!pointers.delete(event.pointerId)) return;
    if (!pointers.size && !pinched) {
      const dx = event.clientX - startX, dy = event.clientY - startY;
      if (zoom === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) change(dx > 0 ? -1 : 1);
      else if (!moved && event.pointerType === "touch") { const now = Date.now(); if (now - lastTap < 300) { toggleZoom(); lastTap = 0; } else lastTap = now; }
    }
  }
  $effect(() => { dialog.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = overflow; }; });
</script>

<dialog bind:this={dialog} use:modalFocus={opener} aria-label="Question image viewer" oncancel={(event) => { event.preventDefault(); onclose(); }} onkeydown={keydown}>
  <header>
    <button type="button" data-modal-initial-focus onclick={onclose}>Close image viewer</button>
    <span aria-live="polite">Image {index + 1} of {images.length}</span>
    <button type="button" onclick={() => scale(zoom / 1.3)} disabled={zoom === 1} aria-label="Zoom out">−</button>
    <button type="button" onclick={() => scale(zoom * 1.3)} disabled={zoom === 6} aria-label="Zoom in">+</button>
    <span aria-live="polite">{Math.round(zoom * 100)}%</span>
  </header>
  <div class="stage" role="group" aria-label="Image inspection" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => { pointers.clear(); pinched = true; }}
    ondblclick={toggleZoom} onwheel={(event) => { event.preventDefault(); scale(zoom * Math.exp(-event.deltaY * .002)); }}>
    {#key images[index].imageId + ':' + index}
      <div class="transform" style:transform="translate({x}px, {y}px) scale({zoom})"><QuestionImage image={images[index]} eager /></div>
    {/key}
  </div>
  <footer>
    <button type="button" onclick={() => change(-1)} disabled={index === 0}>Previous image</button>
    <p>{images[index].caption ?? images[index].alt}</p>
    <button type="button" onclick={() => change(1)} disabled={index === images.length - 1}>Next image</button>
  </footer>
</dialog>

<style>
  dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 1rem; border: 0; background: #111; color: white; }
  dialog[open] { display: flex; flex-direction: column; gap: .75rem; }
  dialog::backdrop { background: #000e; }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
  footer { max-height: 25vh; overflow: auto; } footer p { flex: 1; min-width: 8rem; white-space: pre-wrap; }
  button { border: 1px solid #888; padding: .65rem; border-radius: .4rem; } button:disabled { opacity: .4; }
  button:focus-visible { outline: 3px solid #80cfff; }
  .stage { flex: 1; min-height: 0; overflow: hidden; touch-action: none; }
  .transform { width: 100%; height: 100%; }
</style>
