import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, NotebookPen, Save, Trash2 } from "lucide-react";
import { addNote, readNotes, removeNote, writeNotes, type EventNote } from "@/lib/eventMode";
import { hapticSuccess } from "@/lib/haptics";

type Props = { defaultEvent?: string; onExit: () => void };

/**
 * The three lines an athlete can actually write in the twenty minutes after an
 * event: what worked, what to fix, how it felt.
 *
 * It is deliberately not a form with a save button and a spinner — there is no
 * server here. Notes stay on this device (eventMode notes key), which is also
 * why the last thing on the screen points at the Review tab: the value of a
 * note is reading it back before the next competition, not writing it.
 */
const EventNotes = ({ defaultEvent = "", onExit }: Props) => {
  const [notes, setNotes] = useState<EventNote[]>(() => readNotes());
  const [event, setEvent] = useState(defaultEvent);
  const [worked, setWorked] = useState("");
  const [fix, setFix] = useState("");
  const [felt, setFelt] = useState("");
  const [saved, setSaved] = useState(false);

  const canSave = !!(worked.trim() || fix.trim() || felt.trim());

  const save = () => {
    if (!canSave) return;
    const updated = addNote(notes, { event: event.trim() || defaultEvent || "Event", worked, fix, felt });
    setNotes(updated);
    writeNotes(updated);
    setWorked("");
    setFix("");
    setFelt("");
    setSaved(true);
    hapticSuccess();
  };

  const remove = (id: string) => {
    const updated = removeNote(notes, id);
    setNotes(updated);
    writeNotes(updated);
  };

  const field = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground";

  return (
    <div className="min-h-screen bg-background px-5 pb-24 pt-[var(--vaylo-screen-top)]">
      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onExit}
          className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft size={18} aria-hidden /> Back
        </motion.button>
      </div>

      <h2 className="mt-4 flex items-center gap-2 text-lg font-display font-bold">
        <NotebookPen size={18} className="text-primary" aria-hidden /> After the event
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Three lines now are worth more than a paragraph tomorrow. These stay on this device.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block text-xs font-semibold text-muted-foreground">
          Event
          <input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="200m heat, race 2" className={field} />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          What worked
          <textarea value={worked} onChange={(e) => setWorked(e.target.value)} rows={2} placeholder="Start, warmup, the cue word" className={field} />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          What to fix
          <textarea value={fix} onChange={(e) => setFix(e.target.value)} rows={2} placeholder="One thing, specific" className={field} />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          How it felt
          <input value={felt} onChange={(e) => setFelt(e.target.value)} placeholder="Calm, rushed, strong" className={field} />
        </label>
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={save}
        disabled={!canSave}
        className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary font-semibold text-primary-foreground disabled:opacity-40"
      >
        <Save size={16} aria-hidden /> Save note
      </motion.button>
      {saved && <p className="mt-2 text-xs text-primary" role="status">Saved on this device.</p>}

      {notes.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Recent notes</p>
          <ul className="mt-2 space-y-2">
            {notes.slice(-3).reverse().map((note) => (
              <li key={note.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{note.event}</p>
                    {note.worked && <p className="mt-0.5 text-xs text-muted-foreground">Worked: {note.worked}</p>}
                    {note.fix && <p className="mt-0.5 text-xs text-muted-foreground">Fix: {note.fix}</p>}
                    {note.felt && <p className="mt-0.5 text-xs text-muted-foreground">Felt: {note.felt}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete note for ${note.event}`}
                    onClick={() => remove(note.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Read these back in Mental Gym &rarr; Review before your next competition, and turn the one thing you keep
            writing into the thing you actually train.
          </p>
        </div>
      )}
    </div>
  );
};

export default EventNotes;
