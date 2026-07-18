export function normalizeProposedOptionLabel(label: string): string {
  return label.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}
