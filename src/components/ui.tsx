import type { ReactNode } from 'react'
import type { ItemStatus } from '../types'

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        className ?? 'border-neutral-700 text-neutral-400',
      )}
    >
      {children}
    </span>
  )
}

export const STATUS_META: Record<ItemStatus, { label: string; chip: string; dot: string }> = {
  'not-started': { label: 'Not started', chip: 'border-neutral-700 text-neutral-500', dot: 'bg-neutral-600' },
  reading: { label: 'Reading', chip: 'border-amber-700 text-amber-400', dot: 'bg-amber-400' },
  implementing: { label: 'Implementing', chip: 'border-sky-700 text-sky-400', dot: 'bg-sky-400' },
  done: { label: 'Done', chip: 'border-emerald-700 text-emerald-400', dot: 'bg-emerald-400' },
  skipped: { label: 'Skipped', chip: 'border-neutral-800 text-neutral-600', dot: 'bg-neutral-700' },
}

export function StatusSelect({
  value,
  onChange,
  compact,
}: {
  value: ItemStatus
  onChange: (s: ItemStatus) => void
  compact?: boolean
}) {
  const meta = STATUS_META[value]
  return (
    <span className={cn('relative inline-flex items-center', compact ? '' : 'w-[9.5rem]')}>
      <span className={cn('pointer-events-none absolute left-2 h-2 w-2 rounded-full', meta.dot)} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ItemStatus)}
        className={cn(
          'w-full appearance-none rounded-md border bg-neutral-900 py-1 pr-2 pl-6 text-xs',
          'cursor-pointer focus:ring-1 focus:ring-amber-500 focus:outline-none',
          meta.chip,
        )}
      >
        {Object.entries(STATUS_META).map(([k, m]) => (
          <option key={k} value={k}>
            {m.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-neutral-800', className)}>
      <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  className,
  title,
  type,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  const styles = {
    default: 'border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200',
    primary: 'border-amber-600 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300',
    danger: 'border-red-900 bg-red-950/40 hover:bg-red-950 text-red-400',
    ghost: 'border-transparent hover:bg-neutral-800 text-neutral-400',
  }[variant]
  return (
    <button
      type={type ?? 'button'}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        styles,
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin text-amber-400', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-800 p-8 text-center">
      <p className="text-sm font-medium text-neutral-400">{title}</p>
      {children && <div className="text-xs text-neutral-500">{children}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
      {children}
    </kbd>
  )
}

const ICON_PATHS: Record<string, string> = {
  brain:
    'M12 2a4 4 0 00-4 4v.1A5 5 0 004 11a5 5 0 001.7 3.8A4.5 4.5 0 0010 22h4a4.5 4.5 0 004.3-7.2A5 5 0 0020 11a5 5 0 00-4-4.9V6a4 4 0 00-4-4z',
  satellite:
    'M13 7l4-4 4 4-4 4zM3 17l4-4 4 4-4 4zM10.5 10.5l3 3M17.5 11.5l-2 2a2 2 0 01-2.8 0l-2.2-2.2a2 2 0 010-2.8l2-2',
  scale:
    'M12 3v18M5 7l7-4 7 4M5 7l-3 7a4 4 0 006 0zM19 7l-3 7a4 4 0 006 0zM8 21h8',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20V4a2 2 0 00-2-2H6.5A2.5 2.5 0 004 4.5v15zM4 19.5A2.5 2.5 0 006.5 22H20v-5',
  home: 'M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-7h-6v7H4a1 1 0 01-1-1v-10.5z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM17.2 5l3.8 15-3.9 1-3.8-15z',
  cards: 'M3 7h13v13H3zM7 7V4h13v13h-3',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  sync: 'M21 2v6h-6M3 22v-6h6M21 8a9 9 0 00-15-5.7L3 5M3 16a9 9 0 0015 5.7L21 19',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  timer: 'M12 8v4l3 3M12 22a9 9 0 110-18 9 9 0 010 18zM12 2v2',
  external: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  chevron: 'M9 18l6-6-6-6',
  note: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  info: 'M12 22a10 10 0 110-20 10 10 0 010 20zM12 16v-4M12 8h.01',
  flame: 'M12 22c4.4 0 8-3.6 8-8 0-3.5-2-6.6-4-8.5-.4 2-1.5 3.5-3 4.5 0-2.5-1-6-4-8-.5 3-2 5-3.5 7C4 11 4 12.5 4 14c0 4.4 3.6 8 8 8z',
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4'}
      aria-hidden
    >
      <path d={ICON_PATHS[name] ?? ''} />
    </svg>
  )
}
