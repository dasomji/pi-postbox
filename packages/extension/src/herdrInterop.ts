interface HerdrEventApi {
  events?: {
    emit?: (eventName: string, data: unknown) => void;
  };
}

export function emitHerdrBlocked(pi: HerdrEventApi | undefined, active: boolean, label?: string): void {
  try {
    pi?.events?.emit?.("herdr:blocked", active ? { active: true, label } : { active: false });
  } catch {
    // Herdr compatibility is best-effort. Postbox state must keep working when
    // Herdr is absent or a third-party event listener throws.
  }
}
