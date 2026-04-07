/**
 * Lightweight mock-override state for UI development.
 * Active only when `?mock=true` is in the URL.
 *
 * Overrides are stored in sessionStorage and read once at page load.
 * Mock buttons call `setMockOverride()` which writes to sessionStorage
 * and reloads the page — no observables, no reactive plumbing.
 */

const STORAGE_KEY = "grist-mock-overrides";

const _enabled = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("mock");

/** True when the page was loaded with `?mock=true`. */
export function isMockMode(): boolean { return _enabled; }

// Read overrides once at startup.
const _overrides: Record<string, unknown> = _enabled ? _readOverrides() : {};

/**
 * Get a mock override value, or `undefined` if not set / not in mock mode.
 * Called at construction time by components that want to support mocking.
 */
export function getMockOverride<T = unknown>(key: string): T | undefined {
  if (!_enabled) { return undefined; }
  return _overrides[key] as T | undefined;
}

/**
 * Set a mock override and reload the page so it takes effect.
 * Pass `undefined` to clear an override.
 */
export function setMockOverride(key: string, value: unknown): void {
  if (value === undefined) {
    delete _overrides[key];
  } else {
    _overrides[key] = value;
  }
  _writeOverrides(_overrides);
  window.location.reload();
}

function _readOverrides(): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function _writeOverrides(overrides: Record<string, unknown>): void {
  try {
    if (Object.keys(overrides).length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {
    // sessionStorage may be unavailable; silently ignore.
  }
}
