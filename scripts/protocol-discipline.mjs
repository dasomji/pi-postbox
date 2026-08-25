export function assertAndroidFixtureServerVersion(fixtureText, serverManifestText) {
  const fixture = JSON.parse(fixtureText);
  const serverManifest = JSON.parse(serverManifestText);
  const fixtureVersion = fixture?.fixtures?.health?.version;
  const serverVersion = serverManifest?.version;
  if (typeof fixtureVersion !== "string" || typeof serverVersion !== "string" || fixtureVersion !== serverVersion) {
    throw new Error(`Android health fixture/server package version mismatch: fixture ${String(fixtureVersion)}, server ${String(serverVersion)}.`);
  }
}
