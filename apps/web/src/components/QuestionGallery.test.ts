import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuestionGallery from "./QuestionGallery.svelte";
import QuestionDetail from "./QuestionDetail.svelte";
import QuestionRevisionHistory from "./QuestionRevisionHistory.svelte";
import { AskRequestSnapshotSchema, PROTOCOL_VERSION, type QuestionImage } from "@pi-postbox/protocol";

const images: QuestionImage[] = [
  { imageId: "12345678-1234-4123-8123-123456789abc", mediaType: "image/png", byteSize: 128, width: 32, height: 16, alt: "First screenshot", caption: "Before change" },
  { imageId: "12345678-1234-4123-8123-123456789abd", mediaType: "image/webp", byteSize: 96, width: 16, height: 32, alt: "Second screenshot", caption: "After change" }
];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Question gallery and inspection", () => {
  it("opens the chosen image, navigates, zooms, traps focus and restores the opener", async () => {
    render(QuestionGallery, { images });
    const opener = screen.getByRole("button", { name: "Open image 2: Second screenshot" });
    opener.focus(); await fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Question image viewer" });
    expect(dialog.textContent).toContain("Image 2 of 2");
    expect(dialog.textContent).toContain("After change");
    await fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(dialog.textContent).toContain("Image 1 of 2");
    await fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(dialog.textContent).toContain("130%");
    await fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(dialog.textContent).toContain("100%");
    const close = screen.getByRole("button", { name: "Close image viewer" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("offers independent thumbnail retry and keeps inspection available", async () => {
    render(QuestionGallery, { images });
    await fireEvent.error(screen.getByAltText("First screenshot"));
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(screen.getByAltText("Second screenshot")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
    expect(screen.getByAltText("First screenshot")).toBeTruthy();
  });
  it("loads a replacement image without inheriting the previous image's error state", async () => {
    const view = render(QuestionGallery, { images: [images[0]] });
    await fireEvent.error(screen.getByAltText("First screenshot"));
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    await view.rerender({ images: [images[1]] });
    expect(screen.queryByText("Image unavailable")).toBeNull();
    expect(screen.getByAltText("Second screenshot")).toBeTruthy();
  });
  it("places active gallery content before options and renders retained revisions", async () => {
    const request = AskRequestSnapshotSchema.parse({ requestId: "q", sessionId: "s", revision: 1, creator: { harness: "pi", ownerId: "test" }, owner: { harness: "pi", ownerId: "test" }, mode: "single", question: { prompt: "Review", ambiguity: "Compare images" }, images, options: [{ value: "yes", label: "Accept design" }], status: "pending", createdAt: "2026-09-07T00:00:00.000Z" });
    render(QuestionDetail, { request, isMock: true, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList });
    expect(screen.getByRole("region", { name: "Question images" }).compareDocumentPosition(screen.getAllByRole("radio")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ protocolVersion: PROTOCOL_VERSION, revisions: [{ revision: 1, actor: request.owner, at: request.createdAt, question: request.question, options: request.options, images }] }) }));
    render(QuestionRevisionHistory, { questionId: "q" });
    await fireEvent.click(screen.getByRole("button", { name: "Show immutable revisions" }));
    await waitFor(() => expect(screen.getByText("Revision 1")).toBeTruthy());
    expect(screen.getByAltText("First screenshot")).toBeTruthy();
  });
});
