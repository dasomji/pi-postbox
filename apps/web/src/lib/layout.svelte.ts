/**
 * Development-only question UI controls.
 *
 * The production question view is the spotlight layout. In Vite dev mode we keep
 * one small mock toggle so the UI can be exercised when no real question is
 * active, without carrying multiple layout variants in the app.
 */

const STORAGE_KEY = "postbox.devUi";
const LEGACY_STORAGE_KEY = "postbox.layout";

function readStoredMock(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return false;
    return Boolean((JSON.parse(raw) as { mock?: boolean }).mock);
  } catch {
    return false;
  }
}

class DevUiStore {
  /** When true, render a mock question whenever no real question is active. */
  mockQuestion = $state(false);

  constructor() {
    this.mockQuestion = readStoredMock();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mock: this.mockQuestion }));
    } catch {
      // localStorage may be unavailable (private mode); the UI still works.
    }
  }

  toggleMock(): void {
    this.mockQuestion = !this.mockQuestion;
    this.persist();
  }
}

export const layout = new DevUiStore();
