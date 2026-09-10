import { beforeEach, describe, expect, it } from 'vitest'
import { clearEvidenceDraft, loadEvidenceDraft, saveEvidenceDraft } from './drafts'

beforeEach(() => localStorage.clear())

describe('evidence drafts (device-local, separate from records)', () => {
  it('round-trips a draft per item', () => {
    saveEvidenceDraft('llm-01', { title: 'draft A', hypothesis: 'h' }, null)
    saveEvidenceDraft('cv-02', { title: 'draft B', hypothesis: '' }, 'rec-9')
    expect(loadEvidenceDraft('llm-01')).toMatchObject({ form: { title: 'draft A' }, editingId: null })
    expect(loadEvidenceDraft('cv-02')).toMatchObject({ editingId: 'rec-9' })
  })

  it('an all-empty new-record draft clears itself instead of persisting noise', () => {
    saveEvidenceDraft('llm-01', { title: 'x' }, null)
    saveEvidenceDraft('llm-01', { title: '  ', hypothesis: '' }, null)
    expect(loadEvidenceDraft('llm-01')).toBeNull()
  })

  it('clear removes the draft; corrupt storage is treated as no draft', () => {
    saveEvidenceDraft('llm-01', { title: 'x' }, null)
    clearEvidenceDraft('llm-01')
    expect(loadEvidenceDraft('llm-01')).toBeNull()
    localStorage.setItem('lumen.evidence-draft.llm-01', '{broken json')
    expect(loadEvidenceDraft('llm-01')).toBeNull()
  })
})
