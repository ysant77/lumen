import { NavLink, Outlet, Link } from 'react-router-dom'
import { useData } from '../store/data'
import { useTimer, fmtClock } from '../store/timer'
import { getSyncConfig } from '../lib/sync'
import { Icon, Spinner, cn } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/review', label: 'Review', icon: 'cards' },
  { to: '/roadmap', label: 'Roadmap', icon: 'book' },
  { to: '/radar', label: 'Radar', icon: 'radar' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/**
 * Sync status: makes "saved on this device" vs "confirmed in your data repo"
 * legible at a glance, on every device.
 */
function SyncButton() {
  const syncing = useData((s) => s.syncing)
  const lastSync = useData((s) => s.lastSync)
  const pending = useData((s) => s.dirtyPaths.length)
  const syncNow = useData((s) => s.syncNow)
  const configured = !!getSyncConfig()

  if (!configured) {
    return (
      <Link
        to="/settings"
        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200"
        title={pending > 0 ? `${pending} change(s) saved on this device only` : 'Data stays on this device until sync is set up'}
      >
        <Icon name="sync" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{pending > 0 ? `local only · ${pending}` : 'Set up sync'}</span>
      </Link>
    )
  }

  const label = syncing
    ? 'Syncing…'
    : lastSync?.error
      ? 'Sync error'
      : pending > 0
        ? `${pending} pending`
        : lastSync
          ? 'Synced'
          : 'Sync'
  return (
    <button
      onClick={() => void syncNow()}
      disabled={syncing}
      title={
        (pending > 0 ? `${pending} change(s) saved locally, not yet in your data repo. ` : '') +
        (lastSync
          ? `Last sync ${new Date(lastSync.at).toLocaleTimeString()}${lastSync.error ? ` — ${lastSync.error}` : ''}`
          : 'Sync now')
      }
      aria-label={`Sync now (${label})`}
      className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-amber-300 disabled:opacity-50"
    >
      {syncing ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="sync" className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{label}</span>
      {lastSync?.error ? (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      ) : pending > 0 ? (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      ) : lastSync ? (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      ) : null}
    </button>
  )
}

function TimerChip() {
  const { running, secondsLeft, mode } = useTimer()
  if (!running) return null
  return (
    <Link
      to="/"
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs',
        mode === 'focus' ? 'border-amber-700 text-amber-300' : 'border-sky-700 text-sky-300',
      )}
    >
      <Icon name="timer" className="h-3.5 w-3.5" />
      {fmtClock(secondsLeft)}
    </Link>
  )
}

export default function Layout() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
            <Icon name="flame" className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-wide text-neutral-100">lumen</span>
        </Link>
        <div className="flex items-center gap-4">
          <TimerChip />
          <SyncButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* collapsed icon rail on tablet/laptop (lg), full labels on wide screens (xl) */}
        <nav
          aria-label="Primary"
          className="hidden shrink-0 flex-col gap-1 border-r border-neutral-800 p-2 lg:flex xl:w-44 xl:p-3"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              title={n.label}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] xl:justify-start',
                  isActive
                    ? 'bg-amber-500/10 font-medium text-amber-300'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200',
                )
              }
            >
              <Icon name={n.icon} className="h-4.5 w-4.5 xl:h-4 xl:w-4" />
              <span className="hidden xl:inline">{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto pb-16 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* bottom nav (phone + tablet portrait) */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-neutral-800 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px]',
                isActive ? 'text-amber-300' : 'text-neutral-400',
              )
            }
          >
            <Icon name={n.icon} className="h-5 w-5" />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
