export function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-postbox-muted">{label}</dt>
      <dd className="break-all text-postbox-subtle">{value}</dd>
    </div>
  );
}
