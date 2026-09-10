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
