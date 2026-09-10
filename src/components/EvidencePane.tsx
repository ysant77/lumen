import { useMemo, useState } from 'react'
import type { CatalogItem, Checkpoints, ExperimentRecord, ReadDepth } from '../types'
import { useData } from '../store/data'
import { Button, Chip, EmptyState, Icon, cn } from './ui'

const DEPTHS: Array<{ id: ReadDepth; label: string; hint: string }> = [
  { id: 'skim', label: 'Skim', hint: 'know what it claims' },
  { id: 'read', label: 'Read', hint: 'followed the argument' },
  { id: 'deep', label: 'Deep read', hint: 'could re-derive it' },
]

const CHECKPOINTS: Array<{ id: keyof Checkpoints; label: string }> = [
  { id: 'idea', label: 'Can state the core idea in my own words' },
  { id: 'math', label: 'Can derive / explain the key math' },
  { id: 'repro', label: 'Reproduced a key result or exercise' },
]

const EMPTY_FORM = {
  title: '',
  hypothesis: '',
  baseline: '',
  split: '',
  metric: '',
  result: '',
  limitations: '',
  artifactUrl: '',
  snippetId: '',
}

const inputCls =
  'w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500'

function Field({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  const id = `exp-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor={id}>
      {label}
      {rows ? (
        <textarea id={id} value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      ) : (
        <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </label>
  )
}

export default function EvidencePane({ item }: { item: CatalogItem }) {
  const progress = useData((s) => s.progress[item.id])
  const setDepth = useData((s) => s.setDepth)
  const toggleCheckpoint = useData((s) => s.toggleCheckpoint)
  const recordsRaw = useData((s) => s.experiments[item.id])
  const records = useMemo(() => recordsRaw ?? [], [recordsRaw])
  const saveExperiments = useData((s) => s.saveExperiments)
  const snippets = useData((s) => s.code[item.id]) ?? []

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const startEdit = (r: ExperimentRecord) => {
    setForm({ ...EMPTY_FORM, ...r, snippetId: r.snippetId ?? '' })
    setEditingId(r.id)
    setFormOpen(true)
  }

  const submit = () => {
    if (!form.title.trim()) return
    const now = new Date().toISOString()
    if (editingId) {
      saveExperiments(
        item.id,
        records.map((r) => (r.id === editingId ? { ...r, ...form, snippetId: form.snippetId || undefined, updatedAt: now } : r)),
      )
    } else {
      const rec: ExperimentRecord = {
        id: crypto.randomUUID(),
        ...form,
        snippetId: form.snippetId || undefined,
        createdAt: now,
        updatedAt: now,
      }
      saveExperiments(item.id, [...records, rec])
    }
    setForm(EMPTY_FORM)
    setEditingId(null)
    setFormOpen(false)
  }

  const remove = (id: string) => {
    if (confirm('Delete this experiment record?')) {
      saveExperiments(item.id, records.filter((r) => r.id !== id))
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* reading depth */}
      <section aria-label="Reading depth">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
          Reading depth
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {DEPTHS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDepth(item.id, progress?.depth === d.id ? undefined : d.id)}
              aria-pressed={progress?.depth === d.id}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs',
                progress?.depth === d.id
                  ? 'border-amber-700 bg-amber-500/10 text-amber-300'
                  : 'border-neutral-800 text-neutral-400 hover:border-neutral-700',
              )}
            >
              {d.label} <span className="text-neutral-500">· {d.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* understanding checkpoints */}
      <section aria-label="Understanding checkpoints">
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
          Understanding checkpoints
        </h3>
        <ul className="flex flex-col gap-1">
          {CHECKPOINTS.map((c) => {
            const ts = progress?.checks?.[c.id]
            return (
              <li key={c.id}>
                <button
                  onClick={() => toggleCheckpoint(item.id, c.id)}
                  aria-pressed={!!ts}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-xs hover:bg-neutral-900"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      ts ? 'border-emerald-700 bg-emerald-500/10 text-emerald-400' : 'border-neutral-600',
                    )}
                  >
                    {ts && <Icon name="check" className="h-3 w-3" />}
                  </span>
                  <span className={ts ? 'text-neutral-300' : 'text-neutral-400'}>{c.label}</span>
                  {ts && <span className="ml-auto text-[10px] text-neutral-600">{new Date(ts).toLocaleDateString()}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {/* implementation evidence */}
      <section aria-label="Experiments">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Implementation evidence
          </h3>
          <Button
            variant="primary"
            onClick={() => {
              setForm(EMPTY_FORM)
              setEditingId(null)
              setFormOpen(!formOpen)
            }}
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Experiment
          </Button>
        </div>
        <p className="mb-2 text-[11px] text-neutral-500">
          Small experiments run in the Code tab (browser Python); heavier GPU/notebook work lives
          outside — link it as the artifact.
        </p>

        {formOpen && (
          <div className="mb-3 grid gap-2 rounded-lg border border-neutral-700 bg-neutral-900/50 p-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="e.g. RMSNorm vs LayerNorm runtime on toy MLP" />
            </div>
            <Field label="Hypothesis" rows={2} value={form.hypothesis} onChange={(v) => setForm({ ...form, hypothesis: v })} placeholder="what you expect and why" />
            <Field label="Baseline" rows={2} value={form.baseline} onChange={(v) => setForm({ ...form, baseline: v })} placeholder="what it's compared against" />
            <Field label="Data / split" value={form.split} onChange={(v) => setForm({ ...form, split: v })} placeholder="dataset, train/val split, seed" />
            <Field label="Metric" value={form.metric} onChange={(v) => setForm({ ...form, metric: v })} placeholder="what is measured" />
            <div className="sm:col-span-2">
              <Field label="Result" rows={2} value={form.result} onChange={(v) => setForm({ ...form, result: v })} placeholder="numbers, not adjectives" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Limitations" rows={2} value={form.limitations} onChange={(v) => setForm({ ...form, limitations: v })} placeholder="what this does NOT show" />
            </div>
            <Field label="Artifact / repository link" value={form.artifactUrl} onChange={(v) => setForm({ ...form, artifactUrl: v })} placeholder="https://github.com/… or notebook link" />
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="exp-snippet">
              Linked code snippet
              <select id="exp-snippet" value={form.snippetId} onChange={(e) => setForm({ ...form, snippetId: e.target.value })} className={inputCls}>
                <option value="">none</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={submit} disabled={!form.title.trim()}>
                {editingId ? 'Save changes' : 'Add record'}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {records.length === 0 && !formOpen ? (
          <EmptyState title="No experiments recorded">
            Hypothesis → baseline → split → metric → result → limitations. Honest records beat
            impressive ones.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {records.map((r) => (
              <li key={r.id} className="rounded-lg border border-neutral-800 p-3">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-xs font-semibold text-neutral-200">{r.title}</p>
                  <span className="shrink-0 text-[10px] text-neutral-600">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </span>
                  <button onClick={() => startEdit(r)} className="text-neutral-500 hover:text-amber-300" aria-label={`Edit ${r.title}`}>
                    <Icon name="note" className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(r.id)} className="text-neutral-600 hover:text-red-400" aria-label={`Delete ${r.title}`}>
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
                  {(
                    [
                      ['Hypothesis', r.hypothesis],
                      ['Baseline', r.baseline],
                      ['Split', r.split],
                      ['Metric', r.metric],
                      ['Result', r.result],
                      ['Limitations', r.limitations],
                    ] as const
                  ).map(([k, v]) =>
                    v ? (
                      <div key={k} className={k === 'Result' || k === 'Limitations' ? 'sm:col-span-2' : ''}>
                        <dt className="inline font-medium text-neutral-500">{k}: </dt>
                        <dd className={cn('inline', k === 'Result' ? 'text-emerald-300/90' : 'text-neutral-300')}>{v}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {r.artifactUrl && (
                    <a href={r.artifactUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-amber-400 hover:underline">
                      <Icon name="external" className="h-3 w-3" /> artifact
                    </a>
                  )}
                  {r.snippetId && (
                    <Chip className="border-sky-900 text-sky-400">
                      code: {snippets.find((s) => s.id === r.snippetId)?.title ?? 'snippet'}
                    </Chip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
