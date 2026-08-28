// Grundlagen für die PDF-Ausgabe des Businessplan-Berichts.
//
// @react-pdf/renderer rechnet in typografischen Punkten, die Naef-Vorlage ist
// in Millimeter bemasst — deshalb überall über mm() gehen statt Punktwerte zu
// hinterlegen. So bleiben die Zahlen mit der Word-Vorlage vergleichbar.

import { Buffer } from 'buffer'
import { Font } from '@react-pdf/renderer'
import { SCHRIFT } from '@/lib/bericht'

// @react-pdf greift beim Einlesen der Schriften auf Node's Buffer zu, den der
// Browser nicht kennt („Can't find variable: Buffer"). Die Polyfill steht hier
// statt global, damit sie nur mit dem Bericht geladen wird.
const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
if (!g.Buffer) g.Buffer = Buffer

/** Millimeter in Punkt. 1 mm = 72/25.4 pt. */
export function mm(wert: number): number {
  return (wert * 72) / 25.4
}

/**
 * Basis für Schriften und Bilder des Berichts. Im Browser leer — die Pfade
 * beginnen dann an der Wurzel. Zum Rendern ausserhalb des Browsers (Prüfung,
 * späterer Serverexport) auf eine erreichbare Basis setzen, weil dort absolute
 * Pfade keine gültigen URLs sind.
 */
let assetBasis = ''

export function setzeAssetBasis(basis: string): void {
  assetBasis = basis.replace(/\/$/, '')
}

/** Pfad zu einer Datei unter public/. */
export function assetPfad(rel: string): string {
  return `${assetBasis}${rel}`
}

let registriert = false

/**
 * Bettet Euclid NP ein — ohne das fällt @react-pdf auf Helvetica zurück und
 * das PDF entspricht nicht mehr dem Naef-Auftritt. Die Dateien liegen unter
 * public/fonts und werden zur Laufzeit geladen; einmal pro Sitzung genügt.
 *
 * Die Schrift kennt keine echten Kapitälchen oder optischen Grade — Light
 * dient als leichter Schnitt für grosse Titel, Bold für Überschriften.
 */
export function schriftRegistrieren(): void {
  if (registriert) return
  Font.register({
    family: SCHRIFT.familie,
    fonts: [
      { src: assetPfad('/fonts/EuclidNP-Light.ttf'),         fontWeight: 300 },
      { src: assetPfad('/fonts/EuclidNP-LightItalic.ttf'),   fontWeight: 300, fontStyle: 'italic' },
      { src: assetPfad('/fonts/EuclidNP-Regular.ttf'),       fontWeight: 400 },
      { src: assetPfad('/fonts/EuclidNP-RegularItalic.ttf'), fontWeight: 400, fontStyle: 'italic' },
      { src: assetPfad('/fonts/EuclidNP-Bold.ttf'),          fontWeight: 700 },
      { src: assetPfad('/fonts/EuclidNP-BoldItalic.ttf'),    fontWeight: 700, fontStyle: 'italic' },
    ],
  })
  // Trennt lange Wörter nicht — deutsche Komposita sonst mitten im Wort
  // umgebrochen, was die Vorlage nicht tut.
  Font.registerHyphenationCallback((wort) => [wort])
  registriert = true
}

/** Datum im Schweizer Format, wie auf dem Titelblatt der Vorlage. */
export function datumCh(d: Date): string {
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
