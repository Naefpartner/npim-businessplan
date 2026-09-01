// Ausgezeichneter Freitext für Bemerkungsfelder.
//
// Gespeichert wird ein sehr enger HTML-Ausschnitt: Absätze, Zeilenumbrüche und
// die Auszeichnungen fett, kursiv, unterstrichen sowie eine Textfarbe. Mehr
// lässt der Editor nicht zu, und beim Lesen wird nochmals gefiltert — der
// Bericht rendert daraus Textläufe, und was er nicht kennt, soll gar nicht
// erst in der Datenbank stehen.
//
// Altbestand ohne Auszeichnung bleibt lesbar: Text ohne Tags ergibt einen
// einzigen Absatz.

/** Ein zusammenhängendes Stück Text mit gleicher Auszeichnung. */
export interface TextLauf {
  text: string
  fett?: boolean
  kursiv?: boolean
  unterstrichen?: boolean
  /** Textfarbe als Hex; ohne Angabe die Grundfarbe des Berichts. */
  farbe?: string
}

export interface Absatz {
  laeufe: TextLauf[]
}

/** Erlaubte Farben — die CI-Palette, damit nichts Fremdes in den Bericht gerät. */
export const TEXT_FARBEN: { wert: string; name: string }[] = [
  { wert: '#1A1A1A', name: 'Schwarz' },
  { wert: '#8B6956', name: 'Kupfer' },
  { wert: '#5F7F8B', name: 'Blau' },
  { wert: '#808052', name: 'Grün' },
  { wert: '#994D4D', name: 'Rot' },
]

const FARB_SET = new Set(TEXT_FARBEN.map((f) => f.wert.toLowerCase()))

/** `rgb(139, 105, 86)` und `#8B6956` auf dieselbe Schreibweise bringen. */
function normFarbe(wert: string | null | undefined): string | undefined {
  if (!wert) return undefined
  const s = wert.trim().toLowerCase()
  const rgb = s.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  const hex = rgb
    ? `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
    : s
  return FARB_SET.has(hex) ? hex : undefined
}

/** Ob der Text überhaupt Inhalt trägt — leere Absätze zählen nicht. */
export function hatInhalt(absaetze: Absatz[]): boolean {
  return absaetze.some((a) => a.laeufe.some((l) => l.text.trim() !== ''))
}

/**
 * HTML in Absätze und Läufe zerlegen. Ohne DOM — etwa beim Rendern ausserhalb
 * des Browsers — bleibt der reine Text übrig.
 */
export function alsAbsaetze(html: string | null | undefined): Absatz[] {
  const roh = (html ?? '').trim()
  if (!roh) return []
  if (typeof DOMParser === 'undefined') {
    // Ohne DOM — etwa beim Rendern in Node — bleibt der Text ohne Auszeichnung.
    // Die Tags werden abgestreift, nicht ausgegeben.
    const text = roh
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    return text.split(/\n+/).filter((z) => z.trim() !== '').map((z) => ({ laeufe: [{ text: z }] }))
  }
  if (!/[<&]/.test(roh)) {
    return roh.split(/\n+/).map((z) => ({ laeufe: [{ text: z }] }))
  }

  const doc = new DOMParser().parseFromString(`<div>${roh}</div>`, 'text/html')
  const absaetze: Absatz[] = []
  let laufend: TextLauf[] = []

  function absatzSchliessen() {
    if (laufend.length > 0) { absaetze.push({ laeufe: laufend }); laufend = [] }
  }

  function gehe(knoten: Node, stil: TextLauf) {
    if (knoten.nodeType === Node.TEXT_NODE) {
      const text = knoten.textContent ?? ''
      if (text) laufend.push({ ...stil, text })
      return
    }
    if (knoten.nodeType !== Node.ELEMENT_NODE) return
    const el = knoten as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (tag === 'br') { absatzSchliessen(); return }
    if (tag === 'p' || tag === 'div') {
      absatzSchliessen()
      el.childNodes.forEach((k) => gehe(k, stil))
      absatzSchliessen()
      return
    }

    const naechster: TextLauf = {
      ...stil,
      fett: stil.fett || tag === 'b' || tag === 'strong' || el.style.fontWeight === 'bold',
      kursiv: stil.kursiv || tag === 'i' || tag === 'em' || el.style.fontStyle === 'italic',
      unterstrichen: stil.unterstrichen || tag === 'u'
        || el.style.textDecoration.includes('underline'),
      farbe: normFarbe(el.style.color) ?? stil.farbe,
      text: '',
    }
    el.childNodes.forEach((k) => gehe(k, naechster))
  }

  doc.body.firstChild?.childNodes.forEach((k) => gehe(k, { text: '' }))
  absatzSchliessen()
  return absaetze.filter((a) => a.laeufe.length > 0)
}

/**
 * Zurück in den engen HTML-Ausschnitt. Der Editor arbeitet auf HTML; gespeichert
 * wird, was diese Funktion daraus macht — damit steht in der Datenbank nie mehr,
 * als der Bericht lesen kann.
 */
export function alsHtml(absaetze: Absatz[]): string {
  const esc = (t: string) => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return absaetze
    .map((a) => {
      const inhalt = a.laeufe.map((l) => {
        let t = esc(l.text)
        if (l.farbe) t = `<span style="color:${l.farbe}">${t}</span>`
        if (l.unterstrichen) t = `<u>${t}</u>`
        if (l.kursiv) t = `<em>${t}</em>`
        if (l.fett) t = `<strong>${t}</strong>`
        return t
      }).join('')
      return `<p>${inhalt || '<br>'}</p>`
    })
    .join('')
}

/** HTML durch Zerlegen und Zusammensetzen von allem Fremden befreien. */
export function bereinige(html: string): string {
  const a = alsAbsaetze(html)
  return hatInhalt(a) ? alsHtml(a) : ''
}
