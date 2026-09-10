/**
 * Node >= 22 ships an experimental global `localStorage` that resolves to
 * undefined unless --localstorage-file is passed, and it shadows jsdom's
 * implementation inside vitest. Install a spec-shaped in-memory Storage so
 * app code and tests behave like a browser.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  }
}

let existing: Storage | undefined
try {
  existing = typeof window !== 'undefined' ? window.localStorage : undefined
} catch {
  existing = undefined
}
const store = existing ?? memoryStorage()

Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true, writable: true })
}
