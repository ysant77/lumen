import { create } from 'zustand'
import { useData } from './data'

interface TimerState {
  mode: 'focus' | 'break'
  running: boolean
  secondsLeft: number
  focusMinutes: number
  breakMinutes: number
  itemId?: string
  startedAt?: number

  start(itemId?: string): void
  pause(): void
  resume(): void
  reset(): void
  skip(): void
  setDurations(focus: number, brk: number): void
  attach(itemId?: string): void
}

let interval: ReturnType<typeof setInterval> | null = null

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

  const complete = () => {
    stopInterval()
    const s = get()
    beep()
    if (s.startedAt) {
      useData.getState().addSession({
        id: crypto.randomUUID(),
        itemId: s.mode === 'focus' ? s.itemId : undefined,
        kind: s.mode,
        minutes: s.mode === 'focus' ? s.focusMinutes : s.breakMinutes,
        startedAt: new Date(s.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
      })
    }
    const nextMode = s.mode === 'focus' ? 'break' : 'focus'
    set({
      mode: nextMode,
      running: false,
      startedAt: undefined,
      secondsLeft: (nextMode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
    })
  }

  const startInterval = () => {
    stopInterval()
    interval = setInterval(() => {
      const { secondsLeft, running } = get()
      if (!running) return
      if (secondsLeft <= 1) complete()
      else set({ secondsLeft: secondsLeft - 1 })
    }, 1000)
  }

  return {
    mode: 'focus',
    running: false,
    secondsLeft: 25 * 60,
    focusMinutes: 25,
    breakMinutes: 5,
    itemId: undefined,
    startedAt: undefined,

    start(itemId) {
      const s = get()
      set({
        running: true,
        itemId: itemId ?? s.itemId,
        startedAt: Date.now(),
        secondsLeft: (s.mode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
      })
      startInterval()
    },
    pause() {
      set({ running: false })
    },
    resume() {
      if (get().secondsLeft > 0) {
        set({ running: true })
        startInterval()
      }
    },
    reset() {
      stopInterval()
      const s = get()
      set({
        running: false,
        startedAt: undefined,
        secondsLeft: (s.mode === 'focus' ? s.focusMinutes : s.breakMinutes) * 60,
      })
    },
    skip() {
      complete()
    },
    setDurations(focus, brk) {
      const s = get()
      set({
        focusMinutes: focus,
        breakMinutes: brk,
        secondsLeft: s.running ? s.secondsLeft : (s.mode === 'focus' ? focus : brk) * 60,
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
