import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePendingSave } from './usePendingSave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePendingSave — autosave that cannot lose data', () => {
  it('debounces: only the latest value is saved after the delay', () => {
    const save = vi.fn()
    const { result } = renderHook(() => usePendingSave<string>(save, 800))
    act(() => {
      result.current.schedule('a')
      result.current.schedule('ab')
      result.current.schedule('abc')
    })
    expect(save).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(800))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('abc')
  })

  it('REGRESSION: unmounting right after typing flushes the pending value', () => {
    const save = vi.fn()
    const { result, unmount } = renderHook(() => usePendingSave<string>(save, 800))
    act(() => result.current.schedule('typed then navigated away'))
    unmount() // simulates switching tabs / navigating within the debounce window
    expect(save).toHaveBeenCalledWith('typed then navigated away')
  })

  it('flush() persists immediately and clears the pending state', () => {
    const save = vi.fn()
    const { result } = renderHook(() => usePendingSave<string>(save, 800))
    act(() => result.current.schedule('draft'))
    expect(result.current.hasPending()).toBe(true)
    act(() => result.current.flush())
    expect(save).toHaveBeenCalledWith('draft')
    expect(result.current.hasPending()).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(save).toHaveBeenCalledTimes(1) // no double save
  })

  it('flushes when the tab becomes hidden (app close / device sleep)', () => {
    const save = vi.fn()
    renderHook(() => usePendingSave<string>(save, 800))
    const { result } = renderHook(() => usePendingSave<string>(save, 800))
    act(() => result.current.schedule('background me'))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(save).toHaveBeenCalledWith('background me')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('always saves through the latest save callback (no stale closure)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ fn }) => usePendingSave<string>(fn, 800), {
      initialProps: { fn: first },
    })
    act(() => result.current.schedule('value'))
    rerender({ fn: second })
    act(() => vi.advanceTimersByTime(800))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('value')
  })
})
