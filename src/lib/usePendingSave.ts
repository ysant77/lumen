import { useCallback, useEffect, useRef } from 'react'

/**
 * Debounced save that can never lose the pending value:
 *  - flushes on unmount (tab switch, navigation)
 *  - flushes on pagehide / tab-hidden (app close, device sleep)
 *  - flush() lets callers force-persist before acting on the value (e.g. Run)
 *
 * Regression guard for: "note autosave loss when switching tabs/navigating
 * immediately after typing" and "Run using stale saved source".
 */
export function usePendingSave<T>(save: (value: T) => void, delay = 800) {
  const saveRef = useRef(save)
  saveRef.current = save
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current) {
      const { value } = pending.current
      pending.current = null
      saveRef.current(value)
    }
  }, [])

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [delay, flush],
  )

  const hasPending = useCallback(() => pending.current !== null, [])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush() // unmount: persist whatever is pending
    }
  }, [flush])

  return { schedule, flush, hasPending }
}
