<script lang="ts">
  import { onMount } from "svelte";
  import { CHAT_EFFORTS, type AvailableChatModels, type ChatEffort, type PostboxSettings } from "@pi-postbox/protocol";
  import { fetchChatModels, fetchSettings, saveSettings } from "../api/postboxApi";

  let saved = $state<PostboxSettings>();
  let model = $state("");
  let effort = $state<ChatEffort>("medium");
  let saving = $state(false);
  let error = $state("");
  let notice = $state("");
  let remoteChanged = $state(false);
  let active = true;
  let loading = $state(false);
  let models = $state<AvailableChatModels["models"]>();
  let modelsLoading = $state(false);
  let modelsError = $state("");
  const legacyModels = $derived([...new Set([saved?.chat.model, model])].filter((id): id is string => !!id && models !== undefined && !models.some(option => option.id === id)));
  const unavailable = $derived(legacyModels.includes(model));
  const dirty = $derived(saved !== undefined && (model.trim() !== (saved.chat.model ?? "") || effort !== saved.chat.effort));

  async function refreshModels() {
    if (modelsLoading) return;
    modelsLoading = true;
    modelsError = "";
    try { const result = await fetchChatModels(); if (active) models = result.models; }
    catch (cause) {
      if (active) { models = undefined; modelsError = cause instanceof Error ? cause.message : "Could not load models."; }
    } finally { modelsLoading = false; }
  }

  function adopt(value: PostboxSettings) {
    saved = value;
    model = value.chat.model ?? "";
    effort = value.chat.effort;
    remoteChanged = false;
  }

  async function refresh(discardDraft = false) {
    if (saving || loading) return;
    loading = true;
    try {
      const latest = await fetchSettings();
      if (!active) return;
      if (discardDraft || !saved || !dirty) adopt(latest);
      else if (latest.revision !== saved.revision) remoteChanged = true;
      error = "";
    } catch (cause) {
      if (active) error = cause instanceof Error ? cause.message : "Could not load settings.";
    } finally { loading = false; }
  }

  async function save() {
    if (!saved || saving || loading) return;
    saving = true;
    error = "";
    notice = "";
    try {
      const result = await saveSettings({ revision: saved.revision, chat: { model: model.trim() || null, effort } });
      if (active) { adopt(result); notice = "Saved. These defaults apply to new chats on all your devices."; }
    } catch (cause) {
      if (active) error = cause instanceof Error ? cause.message : "Could not save settings.";
    } finally { saving = false; }
  }

  onMount(() => {
    active = true;
    void refresh();
    void refreshModels();
    const reload = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(reload, 5000);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); };
  });
</script>

<section class="mx-auto max-w-2xl px-6 py-10 md:px-10" aria-labelledby="settings-title">
  <h1 id="settings-title" class="font-display text-2xl font-bold">Settings</h1>
  <p class="mt-2 text-sm text-postbox-subtle">Saved on this Postbox server and shared between the web and Android app.</p>
  <form class="mt-8 space-y-6 rounded-lg border border-postbox-border bg-postbox-surface p-6" onsubmit={(event) => { event.preventDefault(); void save(); }}>
    <div>
      <h2 class="font-display text-lg font-semibold">Question chat</h2>
      <p class="mt-2 text-sm text-postbox-subtle">Start a fresh conversation to understand a question and its options. New chats use these defaults; existing chats keep their settings.</p>
    </div>
    {#if !saved && !error}<p role="status">Loading settings…</p>{/if}
    <fieldset disabled={!saved || saving} class="space-y-5">
      <div>
        <label for="chat-model" class="block text-sm font-medium">Default model</label>
        {#if unavailable}<p role="alert" class="mt-2 text-sm text-warning-foreground">The selected model is not available anymore. Choose an available model or Pi’s configured default.</p>{/if}
        {#if modelsError}<p role="alert" class="mt-2 text-sm text-danger-foreground">{modelsError}</p>{/if}
        <select id="chat-model" bind:value={model} disabled={modelsLoading || models === undefined} aria-describedby="chat-model-help"
          class="mt-2 w-full rounded-md border border-postbox-border bg-postbox-canvas px-3 py-2">
          <option value="">Use Pi’s configured default</option>
          {#each legacyModels as id}<option value={id} disabled>{id} (legacy)</option>{/each}
          {#if models === undefined && model}<option value={model} disabled>{model}</option>{/if}
          {#each models ?? [] as option}<option value={option.id}>{option.name} — {option.id}</option>{/each}
        </select>
        <p id="chat-model-help" class="mt-2 text-xs text-postbox-muted">{modelsLoading ? "Loading available models…" : "Available models from the server’s Pi configuration. Pi’s default follows its configured model."}</p>
        <button type="button" disabled={modelsLoading} onclick={() => void refreshModels()} class="mt-2 text-sm underline">Reload models</button>
      </div>
      <div>
        <label for="chat-effort" class="block text-sm font-medium">Default effort</label>
        <select id="chat-effort" bind:value={effort} class="mt-2 w-full rounded-md border border-postbox-border bg-postbox-canvas px-3 py-2">
          {#each CHAT_EFFORTS as value}<option value={value}>{value === "xhigh" ? "Extra high" : value === "max" ? "Maximum" : value[0].toUpperCase() + value.slice(1)}</option>{/each}
        </select>
        <p class="mt-2 text-xs text-postbox-muted">Higher effort can take longer. Pi adjusts effort to what the selected model supports; the chat shows the effective setting.</p>
      </div>
    </fieldset>
    {#if remoteChanged}<p role="status" class="text-sm text-warning-foreground">Settings changed on another device. Reload the saved settings before editing again.</p>{/if}
    {#if error}<p role="alert" class="text-sm text-danger-foreground">{error}</p>{/if}
    {#if notice && !dirty}<p role="status" class="text-sm">{notice}</p>{/if}
    <div class="flex flex-wrap gap-3">
      <button type="submit" disabled={!saved || !dirty || saving || loading || remoteChanged} class="rounded-md bg-attention px-4 py-2 text-sm font-semibold text-attention-contrast disabled:opacity-50">{saving ? "Saving…" : "Save settings"}</button>
      <button type="button" disabled={saving || loading} onclick={() => { notice = ""; void refresh(true); }} class="rounded-md border border-postbox-border px-4 py-2 text-sm">Reload saved settings</button>
    </div>
  </form>
</section>
