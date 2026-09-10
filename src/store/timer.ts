import { create } from 'zustand'
import { useData } from './data'

/**
 * Focus timer that records ACTUAL active duration.
 *
 * Time accounting is wall-clock based (`activeMs` + `lastResumeAt`), not
 * tick-count based, so paused stretches are excluded and background-tab /
 * device-sleep suspensions cannot inflate or lose time: on wake the elapsed
 * active time is recomputed from timestamps and capped at the configured
 * duration. Early finish ("finish") logs the real minutes, not the target.
 */
interface TimerState {
  mode: 'focus' | 'break'
  running: boolean
  /** derived every tick for the UI */
  secondsLeft: number
  focusMinutes: number
  breakMinutes: number
  itemId?: string
  startedAt?: number
  /** active milliseconds accumulated across pauses (excludes paused time) */
  activeMs: number
  /** wall-clock timestamp of the last resume, when running */
  lastResumeAt?: number

  start(itemId?: string): void
  pause(): void
  resume(): void
  reset(): void
  skip(): void
  tick(): void
  setDurations(focus: number, brk: number): void
  attach(itemId?: string): void
}

let interval: ReturnType<typeof setInterval> | null = null
let visListener = false

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    const ctx = new Ctx()
    const play = (t: number, freq: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.08, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.3)
    }
    play(0, 880)
    play(0.35, 1174.66)
  } catch {
    /* audio unavailable */
  }
}

export const useTimer = create<TimerState>((set, get) => {
  const stopInterval = () => {
    if (interval) clearInterval(interval)
    interval = null
  }

  const durationMs = () => {
    const s = get()
    return (s.mode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60_000
  }

  const currentActiveMs = () => {
    const s = get()
    const runningPart = s.running && s.lastResumeAt ? Date.now() - s.lastResumeAt : 0
    return s.activeMs + runningPart
  }

  const complete = (actualMs: number) => {
    stopInterval()
    const s = get()
    beep()
    const cappedMs = Math.min(actualMs, durationMs())
    const minutes = Math.round((cappedMs / 60_000) * 10) / 10
    if (s.startedAt && minutes >= 0.5) {
      useData.getState().addSession({
        id: crypto.randomUUID(),
        itemId: s.mode === 'focus' ? s.itemId : undefined,
        kind: s.mode,
        minutes,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
      })
    }
    const nextMode = s.mode === 'focus' ? 'break' : 'focus'
    set({
      mode: nextMode,
      running: false,
      startedAt: undefined,
      activeMs: 0,
      lastResumeAt: undefined,
      secondsLeft: (nextMode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
    })
  }

  const tick = () => {
    const s = get()
    if (!s.running) return
    const remaining = durationMs() - currentActiveMs()
    if (remaining <= 0) complete(currentActiveMs())
    else set({ secondsLeft: Math.ceil(remaining / 1000) })
  }

  const startInterval = () => {
    stopInterval()
    interval = setInterval(tick, 1000)
    // recompute immediately after suspension / tab switch
    if (!visListener && typeof document !== 'undefined') {
      visListener = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') get().tick()
      })
    }
  }

  return {
    mode: 'focus',
    running: false,
    secondsLeft: 25 * 60,
    focusMinutes: 25,
    breakMinutes: 5,
    itemId: undefined,
    startedAt: undefined,
    activeMs: 0,
    lastResumeAt: undefined,

    start(itemId) {
      const s = get()
      set({
        running: true,
        itemId: itemId ?? s.itemId,
        startedAt: Date.now(),
        activeMs: 0,
        lastResumeAt: Date.now(),
        secondsLeft: (s.mode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
      })
      startInterval()
    },
    pause() {
      const s = get()
      if (!s.running) return
      set({
        running: false,
        activeMs: s.activeMs + (s.lastResumeAt ? Date.now() - s.lastResumeAt : 0),
        lastResumeAt: undefined,
      })
    },
    resume() {
      const s = get()
      if (s.running || s.startedAt == null) return
      set({ running: true, lastResumeAt: Date.now() })
      startInterval()
    },
    reset() {
      stopInterval()
      const s = get()
      set({
        running: false,
        startedAt: undefined,
        activeMs: 0,
        lastResumeAt: undefined,
        secondsLeft: (s.mode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
      })
    },
    skip() {
      complete(currentActiveMs())
    },
    tick,
    setDurations(focus, brk) {
      const s = get()
      set({
        focusMinutes: focus,
        breakMinutes: brk,
        secondsLeft: s.startedAt
          ? s.secondsLeft
          : (s.mode === 'focus' ? focus : brk) * 60,
      })
    },
    attach(itemId) {
      set({ itemId })
    },
  }
})

export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
