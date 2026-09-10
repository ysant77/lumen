import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { useTimer } from './timer'
import { useData } from './data'
import type { FocusSession } from '../types'

let logged: FocusSession[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-10T10:00:00Z'))
  logged = []
  useData.setState({ addSession: (s: FocusSession) => void logged.push(s) } as any)
  useTimer.setState({
    mode: 'focus',
    running: false,
    focusMinutes: 25,
    breakMinutes: 5,
    secondsLeft: 25 * 60,
    startedAt: undefined,
    activeMs: 0,
    lastResumeAt: undefined,
    itemId: undefined,
  })
  // silence WebAudio in jsdom
  ;(window as any).AudioContext = class {
    createOscillator() {
      return { connect: () => ({}), frequency: {}, start: () => {}, stop: () => {} }
    }
    createGain() {
      return {
        connect: () => ({}),
        gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      }
    }
    get destination() {
      return {}
    }
    get currentTime() {
      return 0
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('focus timer records ACTUAL active duration', () => {
  it('early finish logs elapsed active minutes, not the configured target', () => {
    useTimer.getState().start('llm-01')
    vi.advanceTimersByTime(7 * 60_000) // 7 real minutes of running
    useTimer.getState().skip()
    expect(logged).toHaveLength(1)
    expect(logged[0].minutes).toBeCloseTo(7, 0)
    expect(logged[0].itemId).toBe('llm-01')
  })

  it('excludes paused time from the recorded duration', () => {
    useTimer.getState().start()
    vi.advanceTimersByTime(5 * 60_000) // 5 min active
    useTimer.getState().pause()
    vi.advanceTimersByTime(30 * 60_000) // 30 min paused (wall clock passes)
    useTimer.getState().resume()
    vi.advanceTimersByTime(2 * 60_000) // 2 min active
    useTimer.getState().skip()
    expect(logged[0].minutes).toBeCloseTo(7, 0)
  })

  it('completes with capped duration after a background suspension', () => {
    useTimer.getState().start()
    // simulate device sleep: wall clock jumps 40 min with no interval ticks
    vi.setSystemTime(new Date('2026-09-10T10:40:00Z'))
    useTimer.getState().tick() // visibilitychange-style catch-up
    expect(logged).toHaveLength(1)
    expect(logged[0].minutes).toBe(25) // capped at configured duration
    expect(useTimer.getState().mode).toBe('break')
    expect(useTimer.getState().running).toBe(false)
  })

  it('does not log sessions shorter than 30 seconds', () => {
    useTimer.getState().start()
    vi.advanceTimersByTime(10_000)
    useTimer.getState().skip()
    expect(logged).toHaveLength(0)
  })

  it('pause stops the countdown; resume continues from the same point', () => {
    useTimer.getState().start()
    vi.advanceTimersByTime(60_000)
    useTimer.getState().pause()
    const frozen = useTimer.getState().secondsLeft
    vi.advanceTimersByTime(10 * 60_000)
    expect(useTimer.getState().secondsLeft).toBe(frozen)
    useTimer.getState().resume()
    vi.advanceTimersByTime(1000)
    expect(useTimer.getState().secondsLeft).toBeLessThan(frozen)
  })
})
