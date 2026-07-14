import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const srcDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(srcDir, "..");
const repoRoot = resolve(webRoot, "..", "..");
const publicDir = resolve(webRoot, "public");

type WebManifest = {
  name?: unknown;
  short_name?: unknown;
  start_url?: unknown;
  scope?: unknown;
  display?: unknown;
  theme_color?: unknown;
  background_color?: unknown;
  icons?: unknown;
};

type ManifestIcon = {
  src?: unknown;
  sizes?: unknown;
  type?: unknown;
  purpose?: unknown;
};

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonIfExists(path: string): Promise<WebManifest | null> {
  const text = await readTextIfExists(path);
  return text ? (JSON.parse(text) as WebManifest) : null;
}

function hasManifestLink(indexHtml: string | null): boolean {
  return /<link\b(?=[^>]*\brel=["'][^"']*\bmanifest\b[^"']*["'])(?=[^>]*\bhref=["']\/?manifest\.webmanifest["'])[^>]*>/i.test(
    indexHtml ?? ""
  );
}

function hasThemeColorMeta(indexHtml: string | null): boolean {
  return /<meta\b(?=[^>]*\bname=["']theme-color["'])(?=[^>]*\bcontent=["']#[0-9a-f]{6}["'])[^>]*>/i.test(
    indexHtml ?? ""
  );
}

function manifestIcons(manifest: WebManifest | null): ManifestIcon[] {
  return Array.isArray(manifest?.icons) ? (manifest.icons as ManifestIcon[]) : [];
}

function iconHasSize(icon: ManifestIcon, size: string): boolean {
  return String(icon.sizes ?? "")
    .split(/\s+/)
    .includes(size);
}

function iconPublicPath(src: unknown): string | null {
  if (typeof src !== "string" || src.length === 0 || /^(?:https?:|data:)/i.test(src)) return null;
  return resolve(publicDir, src.replace(/^\//, ""));
}

function serviceWorkerHasListener(source: string | null, eventName: string): boolean {
  return new RegExp(`(?:self\\.)?addEventListener\\(\\s*["']${eventName}["']`).test(source ?? "");
}

describe("Unit 03 PWA shell and service worker installability", () => {
  it("advertises the web app manifest and browser theme color from index.html", async () => {
    const indexHtml = await readTextIfExists(resolve(webRoot, "index.html"));

    expect({
      linksManifest: hasManifestLink(indexHtml),
      declaresThemeColor: hasThemeColorMeta(indexHtml)
    }).toEqual({
      linksManifest: true,
      declaresThemeColor: true
    });
  });

  it("publishes an installable manifest with Pi Postbox identity, standalone display, and real icons", async () => {
    const manifest = await readJsonIfExists(resolve(publicDir, "manifest.webmanifest"));
    const icons = manifestIcons(manifest);
    const iconFiles = icons.map((icon) => iconPublicPath(icon.src));

    expect({
      hasPiPostboxName: manifest?.name === "Pi Postbox",
      hasPostboxShortName: typeof manifest?.short_name === "string" && /postbox/i.test(manifest.short_name),
      startsAtAppRoot: manifest?.start_url === "/" || manifest?.start_url === "./",
      scopesToAppRoot: manifest?.scope === "/" || manifest?.scope === "./",
      usesInstallableDisplay: ["standalone", "fullscreen", "minimal-ui"].includes(String(manifest?.display)),
      declaresThemeColor: typeof manifest?.theme_color === "string" && /^#[0-9a-f]{6}$/i.test(manifest.theme_color),
      declaresBackgroundColor:
        typeof manifest?.background_color === "string" && /^#[0-9a-f]{6}$/i.test(manifest.background_color),
      has192Icon: icons.some((icon) => iconHasSize(icon, "192x192") && String(icon.type ?? "").startsWith("image/")),
      has512Icon: icons.some((icon) => iconHasSize(icon, "512x512") && String(icon.type ?? "").startsWith("image/")),
      iconsAreBundledFiles: iconFiles.length > 0 && iconFiles.every((path) => path !== null && existsSync(path))
    }).toEqual({
      hasPiPostboxName: true,
      hasPostboxShortName: true,
      startsAtAppRoot: true,
      scopesToAppRoot: true,
      usesInstallableDisplay: true,
      declaresThemeColor: true,
      declaresBackgroundColor: true,
      has192Icon: true,
      has512Icon: true,
      iconsAreBundledFiles: true
    });
  });

  it("publishes a service worker that handles lifecycle, fetch, push, and notification clicks", async () => {
    const serviceWorker = await readTextIfExists(resolve(publicDir, "sw.js"));

    expect({
      hasInstallHandler: serviceWorkerHasListener(serviceWorker, "install"),
      installActivatesWaitingWorker: /skipWaiting\s*\(/.test(serviceWorker ?? ""),
      hasActivateHandler: serviceWorkerHasListener(serviceWorker, "activate"),
      activateClaimsClients: /clients\.claim\s*\(/.test(serviceWorker ?? ""),
      hasFetchHandler: serviceWorkerHasListener(serviceWorker, "fetch"),
      fetchHandlerIsSafePassthrough:
        !/caches\.(?:open|match)|cache\.put/.test(serviceWorker ?? "") &&
        (/fetch\s*\(\s*(?:event\.)?request/.test(serviceWorker ?? "") || !/respondWith\s*\(/.test(serviceWorker ?? "")),
      hasPushHandler: serviceWorkerHasListener(serviceWorker, "push"),
      pushShowsNotification: /showNotification\s*\(/.test(serviceWorker ?? ""),
      pushDismissesResolvedQuestionNotifications:
        /ask\.resolved/.test(serviceWorker ?? "") && /getNotifications\s*\(\s*\{\s*tag/.test(serviceWorker ?? ""),
      hasNotificationClickHandler: serviceWorkerHasListener(serviceWorker, "notificationclick"),
      notificationClickClosesNotification: /notification\.close\s*\(/.test(serviceWorker ?? ""),
      notificationClickOpensOrFocusesApp: /clients\.matchAll\s*\(|clients\.openWindow\s*\(/.test(serviceWorker ?? "")
    }).toEqual({
      hasInstallHandler: true,
      installActivatesWaitingWorker: true,
      hasActivateHandler: true,
      activateClaimsClients: true,
      hasFetchHandler: true,
      fetchHandlerIsSafePassthrough: true,
      hasPushHandler: true,
      pushShowsNotification: true,
      pushDismissesResolvedQuestionNotifications: true,
      hasNotificationClickHandler: true,
      notificationClickClosesNotification: true,
      notificationClickOpensOrFocusesApp: true
    });
  });

  it("registers the service worker from the main app without asking notification permission", async () => {
    const mainSource = await readTextIfExists(resolve(srcDir, "main.ts"));

    expect({
      guardsForServiceWorkerSupport: /["']serviceWorker["']\s+in\s+navigator/.test(mainSource ?? ""),
      registersPublicServiceWorker: /navigator\.serviceWorker\.register\s*\(\s*["']\/sw\.js["']/.test(mainSource ?? ""),
      doesNotRequestNotificationPermission: !/Notification\s*\.\s*requestPermission\s*\(/.test(mainSource ?? "")
    }).toEqual({
      guardsForServiceWorkerSupport: true,
      registersPublicServiceWorker: true,
      doesNotRequestNotificationPermission: true
    });
  });

  it("emits the manifest and service worker in the web production build", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "pi-postbox-web-build-"));

    try {
      await execFileAsync("npm", ["run", "build", "-w", "@pi-postbox/web", "--", "--outDir", outDir, "--emptyOutDir"], {
        cwd: repoRoot,
        env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false" },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000
      });

      const builtIndex = await readTextIfExists(resolve(outDir, "index.html"));

      expect({
        indexLinksManifest: hasManifestLink(builtIndex),
        indexDeclaresThemeColor: hasThemeColorMeta(builtIndex),
        emitsManifest: existsSync(resolve(outDir, "manifest.webmanifest")),
        emitsServiceWorker: existsSync(resolve(outDir, "sw.js"))
      }).toEqual({
        indexLinksManifest: true,
        indexDeclaresThemeColor: true,
        emitsManifest: true,
        emitsServiceWorker: true
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("copies built PWA assets into the server public bundle", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pi-postbox-copy-web-"));
    const webDist = join(workspace, "apps", "web", "dist");
    const serverPublic = join(workspace, "packages", "server", "dist", "public");

    try {
      await mkdir(webDist, { recursive: true });
      await writeFile(join(webDist, "index.html"), '<link rel="manifest" href="/manifest.webmanifest">');
      await writeFile(join(webDist, "manifest.webmanifest"), '{"name":"Pi Postbox"}');
      await writeFile(join(webDist, "sw.js"), "self.addEventListener('install', () => {});");

      await execFileAsync(process.execPath, [resolve(repoRoot, "scripts", "copy-web-to-server.mjs")], {
        cwd: workspace,
        maxBuffer: 1024 * 1024,
        timeout: 30_000
      });

      expect({
        copiedIndex: existsSync(join(serverPublic, "index.html")),
        copiedManifest: await readTextIfExists(join(serverPublic, "manifest.webmanifest")),
        copiedServiceWorker: await readTextIfExists(join(serverPublic, "sw.js"))
      }).toEqual({
        copiedIndex: true,
        copiedManifest: '{"name":"Pi Postbox"}',
        copiedServiceWorker: "self.addEventListener('install', () => {});"
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
