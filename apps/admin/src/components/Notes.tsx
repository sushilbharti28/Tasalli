import { addNoteAction } from '@/app/actions';
import type { SupportNote } from '@/lib/queries';
import { fmtDateTime } from '@/lib/format';
import { NOTE_MAX_LENGTH } from '@/lib/writes';

export function NoteForm({ userId, personId }: { userId: string; personId?: string }) {
  return (
    <form action={addNoteAction} style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <input type="hidden" name="userId" value={userId} />
      {personId && <input type="hidden" name="personId" value={personId} />}
      <label htmlFor="note-text" className="muted">
        Add a note. Do not paste full phone numbers or medicine details here.
      </label>
      <textarea id="note-text" name="text" maxLength={NOTE_MAX_LENGTH} required />
      <div><button type="submit">Save note</button></div>
    </form>
  );
}

export function NotesList({ notes, personId }: { notes: SupportNote[]; personId?: string }) {
  const shown = personId ? notes.filter((n) => n.personId === personId || n.personId === null) : notes;
  if (shown.length === 0) return <p className="muted">No notes yet.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
      {shown.map((n) => (
        <li key={n.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {fmtDateTime(n.createdAt)} IST{n.by ? ` · ${n.by}` : ''}{n.personId && !personId ? ' · about one person' : ''}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
        </li>
      ))}
    </ul>
  );
}
