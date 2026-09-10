import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import EvidencePane from './EvidencePane'
import { useData } from '../store/data'
import { loadEvidenceDraft } from '../lib/drafts'
import type { CatalogItem } from '../types'

const item: CatalogItem = {
  id: 'llm-01',
  order: 1,
  phase: '1. Foundations',
  shortName: 'Transformer',
  title: 'Attention Is All You Need',
  year: 2017,
  pdfFile: null,
}

beforeEach(async () => {
  cleanup()
  localStorage.clear()
  vi.stubGlobal('confirm', vi.fn(() => true))
  await useData.getState().clearLocal()
})

function openFormAndType(title: string, hypothesis: string) {
  fireEvent.click(screen.getByRole('button', { name: /Experiment/ }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: hypothesis } })
}

describe('EvidencePane — unfinished drafts survive unmount (regression)', () => {
  it('REGRESSION: a half-filled experiment form survives tab switch / navigation', () => {
    const first = render(<EvidencePane item={item} />)
    openFormAndType('rope vs alibi length extrapolation', 'rope decays with distance')
    // switching workspace tabs unmounts the pane — previously the draft died here
    first.unmount()

    render(<EvidencePane item={item} />)
    expect(screen.getByTestId('draft-restored')).toBeTruthy()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'rope vs alibi length extrapolation',
    )
    expect((screen.getByLabelText('Hypothesis') as HTMLTextAreaElement).value).toBe(
      'rope decays with distance',
    )
    // draft lives separately from completed records
    expect(useData.getState().experiments['llm-01'] ?? []).toHaveLength(0)
    expect(loadEvidenceDraft('llm-01')).not.toBeNull()
  })

  it('submit turns the draft into a record and clears the draft store', async () => {
    render(<EvidencePane item={item} />)
    openFormAndType('adamw vs muon on toy mlp', 'orthogonalized updates help')
    fireEvent.click(screen.getByRole('button', { name: 'Add record' }))

    await vi.waitFor(() => {
      expect(useData.getState().experiments['llm-01']).toHaveLength(1)
    })
    expect(useData.getState().experiments['llm-01'][0].title).toBe('adamw vs muon on toy mlp')
    expect(loadEvidenceDraft('llm-01')).toBeNull()
    // remount: no phantom draft banner
    cleanup()
    render(<EvidencePane item={item} />)
    expect(screen.queryByTestId('draft-restored')).toBeNull()
  })

  it('discard warns (confirm) and clears the draft without creating a record', () => {
    render(<EvidencePane item={item} />)
    openFormAndType('throwaway', 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.stringMatching(/unsaved/i))
    expect(loadEvidenceDraft('llm-01')).toBeNull()
    expect(useData.getState().experiments['llm-01'] ?? []).toHaveLength(0)
  })

  it('keeps the draft when the user declines the discard warning', () => {
    vi.mocked(confirm).mockReturnValueOnce(false)
    render(<EvidencePane item={item} />)
    openFormAndType('keep me', 'still thinking')
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(loadEvidenceDraft('llm-01')).not.toBeNull()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('keep me')
  })

  const recordA = {
    id: 'rec-a',
    title: 'experiment A',
    hypothesis: 'baseline hypothesis',
    baseline: '',
    split: '',
    metric: '',
    result: '',
    limitations: '',
    artifactUrl: '',
    createdAt: 'x',
    updatedAt: 'x',
  }

  it('REGRESSION: Edit on a record must not silently replace an unsaved draft (decline path)', () => {
    useData.getState().saveExperiments('llm-01', [recordA])
    vi.mocked(confirm).mockReturnValue(false)
    render(<EvidencePane item={item} />)

    // start a new unsaved draft B…
    openFormAndType('draft B', 'unrelated idea')
    // …then click Edit on experiment A and DECLINE the replacement
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))

    expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.stringMatching(/replace.*unsaved/is))
    // visible form unchanged
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('draft B')
    // stored draft unchanged (still draft B, still a NEW-record draft)
    expect(loadEvidenceDraft('llm-01')).toMatchObject({
      form: { title: 'draft B' },
      editingId: null,
    })
  })

  it('accepting the replacement loads record A into form and draft', () => {
    useData.getState().saveExperiments('llm-01', [recordA])
    vi.mocked(confirm).mockReturnValue(true)
    render(<EvidencePane item={item} />)
    openFormAndType('draft B', 'unrelated idea')
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('experiment A')
    expect(loadEvidenceDraft('llm-01')).toMatchObject({ editingId: 'rec-a' })
  })

  it('Edit on the SAME record never resets unsaved edits (and never nags)', () => {
    useData.getState().saveExperiments('llm-01', [recordA])
    render(<EvidencePane item={item} />)
    // open A cleanly (empty form -> no confirmation expected)
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    expect(vi.mocked(confirm)).not.toHaveBeenCalled()
    // modify it, then click Edit on the same record again
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A modified' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    expect(vi.mocked(confirm)).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('A modified')
    expect(loadEvidenceDraft('llm-01')).toMatchObject({ form: { title: 'A modified' } })
  })

  it('switching between records without unsaved edits does not nag', () => {
    const recordB = { ...recordA, id: 'rec-b', title: 'experiment B' }
    useData.getState().saveExperiments('llm-01', [recordA, recordB])
    render(<EvidencePane item={item} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment B' })) // pristine view of A
    expect(vi.mocked(confirm)).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('experiment B')
  })

  it('a draft parked with "Close (keep draft)" is also protected from Edit', () => {
    useData.getState().saveExperiments('llm-01', [recordA])
    vi.mocked(confirm).mockReturnValue(false)
    render(<EvidencePane item={item} />)
    openFormAndType('parked draft', 'to finish later')
    fireEvent.click(screen.getByRole('button', { name: 'Close (keep draft)' }))
    expect(screen.queryByLabelText('Title')).toBeNull() // form hidden, draft kept

    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1)
    // declined: form stays closed, stored draft untouched
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(loadEvidenceDraft('llm-01')).toMatchObject({
      form: { title: 'parked draft' },
      editingId: null,
    })

    // accepting later replaces it deliberately
    vi.mocked(confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Edit experiment A' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('experiment A')
    expect(loadEvidenceDraft('llm-01')).toMatchObject({ editingId: 'rec-a' })
  })

  it('editing a record deleted elsewhere falls back to creating, not dropping content', async () => {
    useData.getState().saveExperiments('llm-01', [
      {
        id: 'gone',
        title: 'old',
        hypothesis: '',
        baseline: '',
        split: '',
        metric: '',
        result: '',
        limitations: '',
        artifactUrl: '',
        createdAt: 'x',
        updatedAt: 'x',
      },
    ])
    render(<EvidencePane item={item} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit old/ }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'edited content' } })
    // the record vanishes (e.g. deletion synced from another device)
    useData.getState().saveExperiments('llm-01', [])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => {
      expect(useData.getState().experiments['llm-01']).toHaveLength(1)
    })
    expect(useData.getState().experiments['llm-01'][0].title).toBe('edited content')
  })
})
