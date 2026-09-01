import { useEffect, useRef } from 'react'
import { Bold, Italic, Underline, RemoveFormatting } from 'lucide-react'
import { bereinige, TEXT_FARBEN } from '@/lib/richText'
import { cn } from '@/lib/utils'

/**
 * Kleines Textfeld mit Auszeichnung: fett, kursiv, unterstrichen und eine
 * Farbe aus der Palette.
 *
 * Bewusst ohne Editor-Bibliothek — für ein Bemerkungsfeld wäre sie
 * unverhältnismässig. Der Browser bringt mit `contentEditable` und
 * `execCommand` alles mit, was es braucht. `execCommand` gilt als veraltet,
 * funktioniert aber in allen Browsern; sollte es einmal wegfallen, bleibt der
 * Text lesbar, nur das Auszeichnen ginge verloren.
 *
 * Gespeichert wird nicht das HTML des Browsers, sondern der daraus bereinigte
 * Ausschnitt — siehe lib/richText.
 */
export function RichText({
  wert, onChange, disabled, placeholder, zeilen = 3,
}: {
  wert: string | null
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
  /** Mindesthöhe in Textzeilen. */
  zeilen?: number
}) {
  const feld = useRef<HTMLDivElement>(null)

  // Nur von aussen setzen, solange nicht getippt wird — sonst springt der
  // Cursor bei jedem Zeichen an den Anfang.
  useEffect(() => {
    const el = feld.current
    if (el && document.activeElement !== el) el.innerHTML = wert ?? ''
  }, [wert])

  function befehl(name: string, arg?: string) {
    feld.current?.focus()
    document.execCommand(name, false, arg)
    speichern()
  }

  function speichern() {
    const el = feld.current
    if (el) onChange(bereinige(el.innerHTML))
  }

  const knopf = 'rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40'

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <button type="button" disabled={disabled} title="Fett"
          onMouseDown={(e) => e.preventDefault()} onClick={() => befehl('bold')}
          className={knopf}>
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={disabled} title="Kursiv"
          onMouseDown={(e) => e.preventDefault()} onClick={() => befehl('italic')}
          className={knopf}>
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={disabled} title="Unterstrichen"
          onMouseDown={(e) => e.preventDefault()} onClick={() => befehl('underline')}
          className={knopf}>
          <Underline className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-slate-200" />

        {TEXT_FARBEN.map((f) => (
          <button
            key={f.wert}
            type="button"
            disabled={disabled}
            title={`Farbe ${f.name}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => befehl('foreColor', f.wert)}
            className="h-4 w-4 rounded-full ring-1 ring-slate-300 transition hover:ring-slate-500 disabled:opacity-40"
            style={{ backgroundColor: f.wert }}
          />
        ))}

        <span className="mx-1 h-4 w-px bg-slate-200" />

        <button type="button" disabled={disabled} title="Auszeichnung entfernen"
          onMouseDown={(e) => e.preventDefault()} onClick={() => befehl('removeFormat')}
          className={knopf}>
          <RemoveFormatting className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref={feld}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onBlur={speichern}
        data-platzhalter={placeholder}
        style={{ minHeight: `${zeilen * 1.5}rem` }}
        className={cn(
          'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none',
          'focus:border-[#8B6956] focus:ring-2 focus:ring-[#8B6956]/20',
          'empty:before:text-slate-400 empty:before:content-[attr(data-platzhalter)]',
          disabled && 'opacity-60',
        )}
      />
    </div>
  )
}
