/**
 * Device-local persistence for in-progress form drafts (currently: the
 * Evidence experiment form). Drafts are deliberately kept SEPARATE from
 * completed experiment records: they live in localStorage on this device
 * only, are never synced, and are cleared on submit or explicit discard.
 *
 * Protects against: switching workspace tabs (the pane unmounts) or
 * navigating away mid-form — previously that dropped the draft silently.
 */

export interface EvidenceDraft {
  form: Record<string, string>
  editingId: string | null
  savedAt: string
}

const key = (itemId: string) => `lumen.evidence-draft.${itemId}`

export function loadEvidenceDraft(itemId: string): EvidenceDraft | null {
  try {
    const raw = localStorage.getItem(key(itemId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as EvidenceDraft
    if (!parsed || typeof parsed.form !== 'object' || parsed.form === null) return null
    return { form: parsed.form, editingId: parsed.editingId ?? null, savedAt: parsed.savedAt ?? '' }
  } catch {
    return null
  }
}

export function saveEvidenceDraft(itemId: string, form: Record<string, string>, editingId: string | null) {
  try {
    const empty = Object.values(form).every((v) => !String(v ?? '').trim())
    if (empty && !editingId) {
      localStorage.removeItem(key(itemId))
      return
    }
    const draft: EvidenceDraft = { form, editingId, savedAt: new Date().toISOString() }
    localStorage.setItem(key(itemId), JSON.stringify(draft))
  } catch {
    /* quota/private-mode: draft protection is best-effort, never blocks input */
  }
}

export function clearEvidenceDraft(itemId: string) {
  try {
    localStorage.removeItem(key(itemId))
  } catch {
    /* ignore */
  }
}
