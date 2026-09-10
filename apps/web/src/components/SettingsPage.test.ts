import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SettingsPage from "./SettingsPage.svelte";
import { fetchChatModels, fetchSettings, saveSettings } from "../api/postboxApi";

vi.mock("../api/postboxApi", () => ({ fetchChatModels: vi.fn(), fetchSettings: vi.fn(), saveSettings: vi.fn() }));
beforeEach(() => { vi.mocked(fetchChatModels).mockResolvedValue({models: ["test/model", "other/model", "my/draft"].map(id => ({id, name: id}))}); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("loads server defaults, saves edits, and refreshes changes from another device", async () => {
  vi.mocked(fetchSettings).mockResolvedValue({revision: 0, chat: {model: null, effort: "medium"}});
  vi.mocked(saveSettings).mockResolvedValue({revision: 1, chat: {model: "test/model", effort: "high"}});
  render(SettingsPage);
  const model = await screen.findByLabelText("Default model");
  await waitFor(() => expect((model as HTMLInputElement).disabled).toBe(false));
  await fireEvent.change(model, {target: {value: "test/model"}});
  await fireEvent.change(screen.getByLabelText("Default effort"), {target: {value: "high"}});
  await fireEvent.click(screen.getByRole("button", {name: "Save settings"}));
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({revision: 0, chat: {model: "test/model", effort: "high"}}));
  await screen.findByText(/Saved\. These defaults/);
  vi.mocked(fetchSettings).mockResolvedValue({revision: 2, chat: {model: "other/model", effort: "low"}});
  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect((model as HTMLInputElement).value).toBe("other/model"));
});

it("preserves a local draft when another device edits settings and requires reload", async () => {
  vi.mocked(fetchSettings).mockResolvedValue({revision: 0, chat: {model: null, effort: "medium"}});
  render(SettingsPage);
  const model = await screen.findByLabelText("Default model");
  await waitFor(() => expect((model as HTMLInputElement).disabled).toBe(false));
  await fireEvent.change(model, {target: {value: "my/draft"}});
  vi.mocked(fetchSettings).mockResolvedValue({revision: 1, chat: {model: "other/model", effort: "low"}});
  window.dispatchEvent(new Event("focus"));
  await screen.findByText(/Settings changed on another device/);
  expect((model as HTMLInputElement).value).toBe("my/draft");
  expect((screen.getByRole("button", {name: "Save settings"}) as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.click(screen.getByRole("button", {name: "Reload saved settings"}));
  await waitFor(() => expect((model as HTMLInputElement).value).toBe("other/model"));
});

it("retains an unavailable saved model as a disabled legacy option until replaced", async () => {
  vi.mocked(fetchSettings).mockResolvedValue({revision: 1, chat: {model: "old/model", effort: "medium"}});
  render(SettingsPage);
  await screen.findByText(/The selected model is not available anymore/);
  const legacy = screen.getByRole("option", {name: "old/model (legacy)"}) as HTMLOptionElement;
  expect(legacy.disabled).toBe(true);
  expect((screen.getByLabelText("Default model") as HTMLSelectElement).value).toBe("old/model");
  await fireEvent.change(screen.getByLabelText("Default model"), {target: {value: "test/model"}});
  expect(screen.queryByText(/The selected model is not available anymore/)).toBeNull();
  expect(legacy.disabled).toBe(true);
});

it("does not label a model legacy when the catalog fails, and supports retry", async () => {
  vi.mocked(fetchSettings).mockResolvedValue({revision: 1, chat: {model: "test/model", effort: "medium"}});
  vi.mocked(fetchChatModels).mockRejectedValueOnce(new Error("Could not load available models from Pi. Try again."));
  render(SettingsPage);
  await screen.findByText(/Could not load available models/);
  expect(screen.queryByText(/legacy/)).toBeNull();
  expect((screen.getByLabelText("Default model") as HTMLSelectElement).disabled).toBe(true);
  await fireEvent.click(screen.getByRole("button", {name: "Reload models"}));
  await waitFor(() => expect((screen.getByLabelText("Default model") as HTMLSelectElement).disabled).toBe(false));
  expect((screen.getByLabelText("Default model") as HTMLSelectElement).value).toBe("test/model");
});

it("reloads the catalog when settings is reopened and recognizes a removed model", async () => {
  vi.mocked(fetchSettings).mockResolvedValue({revision: 1, chat: {model: "test/model", effort: "medium"}});
  const view = render(SettingsPage);
  await waitFor(() => expect((screen.getByLabelText("Default model") as HTMLSelectElement).disabled).toBe(false));
  view.unmount();
  vi.mocked(fetchChatModels).mockResolvedValue({models: []});
  render(SettingsPage);
  await screen.findByText(/The selected model is not available anymore/);
  expect(fetchChatModels).toHaveBeenCalledTimes(2);
});
