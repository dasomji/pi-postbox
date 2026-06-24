import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

type SourceFile = {
  exists: boolean;
  text: string;
};

function readSource(relativePath: string): SourceFile {
  const path = resolve(srcDir, relativePath);
  if (!existsSync(path)) return { exists: false, text: "" };
  return { exists: true, text: readFileSync(path, "utf8") };
}

function readInstallPromptSources(): string {
  return [
    readSource("components/PwaInstallButton.svelte").text,
    readSource("lib/pwaInstallPrompt.ts").text,
    readSource("lib/pwaInstall.ts").text,
    readSource("lib/installPrompt.ts").text
  ].join("\n");
}

function footerBlock(source: string): string {
  return source.match(/<footer\b[\s\S]*?<\/footer>/)?.[0] ?? "";
}

function installButtonBlock(source: string): string {
  return (
    source
      .match(/<button\b[\s\S]*?(?:Install(?:\s+(?:Pi Postbox|app))?|Add to home screen)[\s\S]*?<\/button>/i)?.[0] ?? ""
  );
}

describe("PWA install prompt sidebar button static contract", () => {
  it("mounts a PWA install button control in the bottom sidebar chrome", () => {
    const sidebar = readSource("components/Sidebar.svelte").text;
    const installButton = readSource("components/PwaInstallButton.svelte");
    const footer = footerBlock(sidebar);

    expect({
      installButtonComponentExists: installButton.exists,
      installButtonImportedInSidebar: /import\s+PwaInstallButton\s+from\s+["'][^"']*PwaInstallButton\.svelte["']/.test(
        sidebar
      ),
      installButtonRenderedInSidebarFooter: /<PwaInstallButton\b/.test(footer),
      footerRemainsBottomChrome: /<footer\b/.test(footer) && /NotificationSubscriptionControl/.test(footer) && /Decision history/.test(footer)
    }).toEqual({
      installButtonComponentExists: true,
      installButtonImportedInSidebar: true,
      installButtonRenderedInSidebarFooter: true,
      footerRemainsBottomChrome: true
    });
  });

  it("captures beforeinstallprompt and only exposes install UI when the app is not standalone", () => {
    const source = readInstallPromptSources();

    expect({
      listensForBeforeInstallPrompt: /addEventListener\s*\(\s*["']beforeinstallprompt["']/.test(source),
      preventsBrowserMiniInfobarAndSavesPrompt: /beforeinstallprompt[\s\S]*?\.preventDefault\s*\(\s*\)/.test(source),
      detectsStandaloneDisplayMode: /matchMedia\s*\(\s*["']\(display-mode:\s*standalone\)["']\s*\)/.test(source),
      detectsIosStandaloneMode: /navigator[\s\S]*standalone/.test(source),
      rendersOnlyWhenPromptAvailableAndNotStandalone:
        /\{#if\s+[^}]*\b(?:installPrompt|deferredPrompt|promptEvent|canInstall)\b[^}]*&&[^}]*!\s*\b(?:isStandalone|standalone|runningStandalone)\b[^}]*\}/i.test(
          source
        ) ||
        /\{#if\s+[^}]*!\s*\b(?:isStandalone|standalone|runningStandalone)\b[^}]*&&[^}]*\b(?:installPrompt|deferredPrompt|promptEvent|canInstall)\b[^}]*\}/i.test(
          source
        )
    }).toEqual({
      listensForBeforeInstallPrompt: true,
      preventsBrowserMiniInfobarAndSavesPrompt: true,
      detectsStandaloneDisplayMode: true,
      detectsIosStandaloneMode: true,
      rendersOnlyWhenPromptAvailableAndNotStandalone: true
    });
  });

  it("installs from an explicit sidebar button click and records whether the prompt was accepted or dismissed", () => {
    const source = readInstallPromptSources();
    const button = installButtonBlock(source);

    expect({
      rendersExplicitInstallButton:
        /<button\b/.test(button) && /type=["']button["']/.test(button) && /(?:Install(?:\s+(?:Pi Postbox|app))?|Add to home screen)/i.test(button),
      clickIsUserInitiated: /onclick=\{[^}]+\}/.test(button),
      clickCallsSavedPrompt: /\.prompt\s*\(\s*\)/.test(source),
      waitsForUserChoice: /(?:await\s+[^;\n]+\.userChoice|\.userChoice\s*\.\s*then\s*\()/.test(source),
      recordsAcceptedOrDismissedOutcome: /\boutcome\b/.test(source) && /\baccepted\b/.test(source) && /\bdismissed\b/.test(source)
    }).toEqual({
      rendersExplicitInstallButton: true,
      clickIsUserInitiated: true,
      clickCallsSavedPrompt: true,
      waitsForUserChoice: true,
      recordsAcceptedOrDismissedOutcome: true
    });
  });
});
