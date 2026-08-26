// Import der Erstellungskosten aus dem Excel-Export von keevalue.ch.
//
// keeValue liefert eine feste Arbeitsmappe mit drei Blättern:
//   1 „Eingaben"                      — Objektdaten, Quantitäten, Wertklassen
//   2 „Ergebnisse Erstellungskosten"  — BKP-Gliederung, das was wir übernehmen
//   3 „Erklärung der Wertklassen"     — reine Legende, wird ignoriert
//
// Statt einer Excel-Bibliothek lesen wir die Datei direkt: XLSX ist ein ZIP
// (entpackt mit fflate) mit XML darin (geparst mit dem DOMParser des Browsers).
// Das Blatt hat ein festes Raster, deshalb genügt ein gezielter Parser — und
// der Bundle bleibt klein.
//
// Achtung bei der BKP-Zuordnung: keeValue führt die Honorare als Position 29
// INNERHALB von BKP 2. Unser Katalog (lib/bkpKatalog.ts) hat Honorare als
// Hauptgruppe 6. `zuNaefHauptgruppen()` hängt 29 deshalb nach 6 um und zieht
// den Betrag von BKP 2 ab — sonst würden Honorare doppelt gezählt.

import { unzipSync, strFromU8 } from 'fflate'
import { isGarageNutzung } from '@/lib/bkp2'
import { BKP_POSITIONEN } from '@/lib/bkpKatalog'
import type { BkpErgebnis, PositionResult } from '@/lib/bkpBerechnung'
import type { BuildingMietflaeche, BuildingMieteinheit, VariantBuilding } from '@/types'

/** Eine Ergebniszeile des Blatts „Ergebnisse Erstellungskosten". */
export interface KeeValueZeile {
  /** BKP-Nummer wie im Blatt: '1', '2', '20'…'29', '4', '5', '6'. */
  code: string
  label: string
  /** Betrag exkl. MwSt. in CHF. */
  netto: number
  /** Betrag inkl. MwSt. in CHF. */
  brutto: number
  /** Kennwert (z.B. 3716) mit zugehöriger Einheit ('CHF/m² GF', 'CHF/m² BUF'). */
  kennwert: number | null
  kennwertEinheit: string | null
  /** true bei den Unterpositionen 20–29 von BKP 2. */
  istUnterposition: boolean
}

/** Die Objekt- und Mengenangaben aus dem Blatt „Eingaben". */
export interface KeeValueEingaben {
  objektbezeichnung: string | null
  hauptnutzung: string | null
  adresse: string | null
  plzOrt: string | null
  /** Rohtexte der Quantitäten, z.B. { 'Geschossfläche GF SIA 416': "2'378 m²" }. */
  quantitaeten: Record<string, string>
  /** Wertklassen aus Komplexität und Qualität, z.B. { 'Dachform': 'Flachdach' }. */
  wertklassen: Record<string, string>
}

export interface KeeValueImport {
  /** Version des Baukostenmodells, z.B. '1.0.11'. */
  version: string | null
  /** Preisstand, z.B. 'April 2026'. */
  preisstand: string | null
  /** Exportdatum aus dem Blatt, ISO-Text wie im Excel. */
  datum: string | null
  eingaben: KeeValueEingaben
  zeilen: KeeValueZeile[]
  /** Erstellungskosten total (Zeile „Erstellungskosten CHF"). */
  totalNetto: number
  totalBrutto: number
  /** Terminkennwerte in Monaten — direkt für den Mittelfluss verwendbar. */
  planungszeitMonate: number | null
  bauzeitMonate: number | null
  /**
   * Geschossfläche GF SIA 416 (m²), auf die keeValue seine Kennwerte bezieht.
   * Steht im Ergebnis-Blatt als „Bezugsgrösse" unter den BKP-2-Kennwerten.
   * Wir rechnen unsere Kennwerte auf dieselbe Fläche, damit die Spalte
   * durchgängig vergleichbar bleibt.
   */
  bezugsGfM2: number | null
  /** Gebäudevolumen GV SIA 416 (m³) als Bezugsgrösse, analog. */
  bezugsGvM3: number | null
}

export class KeeValueParseError extends Error {}

// ── Mengen aus dem Businessplan für das keeValue-Eingabeformular ─────────────

/** Nur die Felder, die für die keeValue-Mengen gebraucht werden. */
type MengenMietflaeche =
  Pick<BuildingMietflaeche, 'nutzung' | 'unterirdisch' | 'gf_m2' | 'volumen_m3' | 'anzahl'
    | 'geschoss_bezeichnung'>
  & { mieteinheiten?: Pick<BuildingMieteinheit, 'anzahl'>[] }

/**
 * Erkennt eine Erdgeschoss-Zeile an der Geschossbezeichnung. Das Feld ist
 * Freitext (Platzhalter „EG / 1.OG"), deshalb wird tolerant geprüft: Punkte
 * fallen weg, Gross-/Kleinschreibung egal, Zusätze nach dem Kürzel erlaubt
 * („EG Nord"). „1.OG" und „UG" dürfen dabei nicht mitgehen — daher die
 * Verankerung am Anfang plus Wortgrenze.
 */
export function istErdgeschoss(bezeichnung: string | null | undefined): boolean {
  if (!bezeichnung) return false
  const s = bezeichnung.trim().toLowerCase().replace(/\./g, '')
  return /^(eg|erdgeschoss)\b/.test(s)
}

type MengenGebaeude =
  Pick<VariantBuilding, 'geschossflaeche_m2' | 'volumen_m3'>
  & { mietflaechen: MengenMietflaeche[] }

/**
 * Geschosszählung einer Terrainlage. keeValue fragt die Geschosszahl pro Gebäude,
 * unsere Erfassung kennt beliebig viele Gebäude — deshalb der Durchschnitt über
 * die Gebäude, die in dieser Lage überhaupt Geschosse ausweisen.
 */
export interface GeschossZaehlung {
  /** Ø Geschosse je Gebäude; null, wenn kein Gebäude solche Geschosse hat. */
  schnitt: number | null
  /** Summe der verschiedenen Geschosse über alle Gebäude. */
  total: number
  /** Anzahl Gebäude mit mindestens einem bezeichneten Geschoss dieser Lage. */
  gebaeude: number
  /** Zeilen dieser Lage ohne Geschossbezeichnung — nicht zählbar. */
  ohneGeschoss: number
}

export interface KeeValueMengen {
  /** Σ Geschossfläche (m²) über alle Mietflächen. */
  gfM2: number
  /** Σ Gebäudevolumen (m³) über alle Mietflächen. */
  gvM3: number
  /** Anteil davon unter Terrain (0..1); null wenn kein Volumen erfasst ist. */
  anteilUnterTerrain: number | null
  /** Volumen unter Terrain (m³) — Grundlage des Anteils. */
  gvUnterirdischM3: number
  /** Anzahl Parkplätze in unterirdisch erfassten Parking-/Garagenflächen. */
  parkplaetzeUnterirdisch: number
  anzahlGebaeude: number
  /** Σ Geschossfläche der als Erdgeschoss bezeichneten Zeilen = Gebäude-Fussabdruck. */
  egFlaecheM2: number
  /** Geschosse über Terrain, gezählt über die oberirdisch (oi) erfassten Zeilen. */
  geschosseUeberTerrain: GeschossZaehlung
  /** Geschosse unter Terrain, gezählt über die unterirdisch (ui) erfassten Zeilen. */
  geschosseUnterTerrain: GeschossZaehlung
  /**
   * Bearbeitete Umgebungsfläche = Parzellenfläche minus Fussabdruck.
   * null, wenn keine Zeile als Erdgeschoss bezeichnet ist — dann wäre die BUF
   * gleich der ganzen Parzelle und damit irreführend.
   */
  bufM2: number | null
}

/**
 * Leitet die Mengenangaben des keeValue-Formulars aus dem Mengengerüst ab.
 *
 * Gerechnet wird über die Mietflächen, nicht über die Gebäude-Aggregate — so
 * wie es auch die BKP-2-Aggregation (lib/bkp2.ts) tut. Nur wenn ein Gebäude gar
 * keine Mietflächen hat, greifen wir auf dessen eigene Werte zurück.
 *
 * Für Flächen mit erfassten Mieteinheiten zählt deren Summe, weil das
 * Mietflächen-Aggregat einem Sync-Lag unterliegen kann (gleiche Logik wie in
 * aggregateMietflaechen).
 *
 * `gsfTotal` ist die Parzellenfläche und wird nur für die bearbeitete
 * Umgebungsfläche gebraucht (Parzelle minus Erdgeschossflächen aller Gebäude).
 */
export function ermittleKeeValueMengen(
  buildings: MengenGebaeude[],
  gsfTotal: number,
): KeeValueMengen {
  const anzahlVon = (m: MengenMietflaeche): number => {
    const units = m.mieteinheiten ?? []
    return units.length > 0
      ? units.reduce((s, u) => s + (u.anzahl ?? 1), 0)
      : (m.anzahl ?? 0)
  }

  let gfM2 = 0
  let gvM3 = 0
  let gvUnterirdischM3 = 0
  let parkplaetzeUnterirdisch = 0
  let egFlaecheM2 = 0
  let hatEg = false
  const oi = neueZaehlung()
  const ui = neueZaehlung()

  for (const b of buildings) {
    if (b.mietflaechen.length === 0) {
      gfM2 += b.geschossflaeche_m2 ?? 0
      gvM3 += b.volumen_m3 ?? 0
      continue
    }
    // Verschiedene Geschosse dieses Gebäudes je Lage. Mehrere Mietflächen im
    // selben Geschoss (z.B. Wohnen und Gewerbe im EG) zählen einmal.
    const oiGeschosse = new Set<string>()
    const uiGeschosse = new Set<string>()

    for (const m of b.mietflaechen) {
      const vol = m.volumen_m3 ?? 0
      gfM2 += m.gf_m2 ?? 0
      gvM3 += vol
      const g = geschossSchluessel(m.geschoss_bezeichnung)
      if (m.unterirdisch) {
        gvUnterirdischM3 += vol
        // Unterirdisch erfasste Parking-/Garagenfläche = Tiefgaragenplätze.
        if (isGarageNutzung(m.nutzung ?? '')) parkplaetzeUnterirdisch += anzahlVon(m)
        if (g) uiGeschosse.add(g)
        else ui.ohneGeschoss++
      } else {
        if (g) oiGeschosse.add(g)
        else oi.ohneGeschoss++
      }
      // Erdgeschossflächen aller Gebäude zusammen = überbaute Fläche.
      if (istErdgeschoss(m.geschoss_bezeichnung)) {
        hatEg = true
        egFlaecheM2 += m.gf_m2 ?? 0
      }
    }

    if (oiGeschosse.size > 0) { oi.total += oiGeschosse.size; oi.gebaeude++ }
    if (uiGeschosse.size > 0) { ui.total += uiGeschosse.size; ui.gebaeude++ }
  }

  return {
    gfM2,
    gvM3,
    gvUnterirdischM3,
    anteilUnterTerrain: gvM3 > 0 ? gvUnterirdischM3 / gvM3 : null,
    parkplaetzeUnterirdisch,
    anzahlGebaeude: buildings.length,
    egFlaecheM2,
    // Ohne EG-Bezeichnung keine Aussage — sonst käme die ganze Parzelle als BUF
    // heraus. Negative Werte (EG grösser als Parzelle) auf 0 begrenzen.
    bufM2: hatEg && gsfTotal > 0 ? Math.max(0, gsfTotal - egFlaecheM2) : null,
    geschosseUeberTerrain: abschliessen(oi),
    geschosseUnterTerrain: abschliessen(ui),
  }
}

function neueZaehlung(): GeschossZaehlung {
  return { schnitt: null, total: 0, gebaeude: 0, ohneGeschoss: 0 }
}

/** Durchschnitt setzen, sobald alle Gebäude gezählt sind. */
function abschliessen(z: GeschossZaehlung): GeschossZaehlung {
  return { ...z, schnitt: z.gebaeude > 0 ? z.total / z.gebaeude : null }
}

/** Geschosskürzel am Anfang einer Bezeichnung, mit optionaler Nummer davor. */
const GESCHOSS_KUERZEL =
  /^(\d*\s*(?:erdgeschoss|untergeschoss|obergeschoss|dachgeschoss|attika|eg|og|ug|dg|ag))\b/

/**
 * Vergleichsschlüssel einer Geschossbezeichnung, damit dasselbe Geschoss nicht
 * mehrfach gezählt wird. Zwei Fälle werden zusammengeführt:
 *   • Schreibvarianten — „1.OG", „1. OG" und „1 OG" ergeben denselben Schlüssel.
 *   • Zusätze hinter dem Kürzel — „EG Nord" und „EG Gewerbe" gelten als „eg",
 *     denn ein nach Flügel oder Nutzung aufgeteiltes Geschoss bleibt eines.
 * Bezeichnungen ohne erkennbares Kürzel (z.B. „Hochparterre") bleiben, wie sie
 * sind. Leere Bezeichnungen liefern null — die sind nicht zählbar.
 */
function geschossSchluessel(bezeichnung: string | null | undefined): string | null {
  if (!bezeichnung) return null
  const s = bezeichnung.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  if (!s) return null
  const treffer = s.match(GESCHOSS_KUERZEL)
  return (treffer ? treffer[1] : s).replace(/\s+/g, '')
}

// ── XLSX-Grundlagen ──────────────────────────────────────────────────────────

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

/** Zellinhalte eines Blatts als Map 'A5' → Text. */
type Zellen = Map<string, string>

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new KeeValueParseError('Die Excel-Datei konnte nicht gelesen werden (ungültiges XML).')
  }
  return doc
}

/** Text aller <t>-Knoten unterhalb eines Elements — deckt auch Rich Text ab. */
function textOf(el: Element): string {
  const parts: string[] = []
  const ts = el.getElementsByTagNameNS(NS_MAIN, 't')
  for (let i = 0; i < ts.length; i++) parts.push(ts[i].textContent ?? '')
  return parts.join('')
}

/** sharedStrings.xml → indizierte Texttabelle (fehlt bei inline strings). */
function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files['xl/sharedStrings.xml']
  if (!raw) return []
  const doc = parseXml(strFromU8(raw))
  const sis = doc.getElementsByTagNameNS(NS_MAIN, 'si')
  const out: string[] = []
  for (let i = 0; i < sis.length; i++) out.push(textOf(sis[i]))
  return out
}

/** Ein Arbeitsblatt in eine Map 'A5' → Text auflösen. */
function readSheet(xml: string, shared: string[]): Zellen {
  const doc = parseXml(xml)
  const cells: Zellen = new Map()
  const cs = doc.getElementsByTagNameNS(NS_MAIN, 'c')
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const ref = c.getAttribute('r')
    if (!ref) continue
    const t = c.getAttribute('t')
    let val: string
    if (t === 'inlineStr') {
      const is = c.getElementsByTagNameNS(NS_MAIN, 'is')[0]
      val = is ? textOf(is) : ''
    } else {
      const v = c.getElementsByTagNameNS(NS_MAIN, 'v')[0]
      if (!v) continue
      const raw = v.textContent ?? ''
      // 's' = Verweis in die sharedStrings-Tabelle, alles andere ist der Wert selbst.
      val = t === 's' ? (shared[Number(raw)] ?? '') : raw
    }
    val = val.trim()
    if (val) cells.set(ref, val)
  }
  return cells
}

/** Blattnamen → Dateipfad, über workbook.xml und die zugehörigen Rels. */
function sheetPaths(files: Record<string, Uint8Array>): Map<string, string> {
  const wbRaw = files['xl/workbook.xml']
  const relRaw = files['xl/_rels/workbook.xml.rels']
  if (!wbRaw || !relRaw) throw new KeeValueParseError('Das ist keine gültige Excel-Datei (workbook.xml fehlt).')

  const relTargets = new Map<string, string>()
  const relDoc = parseXml(strFromU8(relRaw))
  const rels = relDoc.getElementsByTagName('Relationship')
  for (let i = 0; i < rels.length; i++) {
    const id = rels[i].getAttribute('Id')
    const target = rels[i].getAttribute('Target')
    if (id && target) relTargets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }

  const out = new Map<string, string>()
  const wbDoc = parseXml(strFromU8(wbRaw))
  const sheets = wbDoc.getElementsByTagNameNS(NS_MAIN, 'sheet')
  for (let i = 0; i < sheets.length; i++) {
    const name = sheets[i].getAttribute('name')
    // r:id — der Namespace-Präfix ist nicht garantiert, deshalb über die lokale Suche.
    const rid = sheets[i].getAttribute('r:id')
      ?? sheets[i].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const target = rid ? relTargets.get(rid) : null
    if (name && target) out.set(name, `xl/${target}`)
  }
  return out
}

// ── Zellhelfer ───────────────────────────────────────────────────────────────

function txt(cells: Zellen, ref: string): string | null {
  return cells.get(ref) ?? null
}

function num(cells: Zellen, ref: string): number | null {
  const v = cells.get(ref)
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Zeilennummer aus einer Zellreferenz ('B17' → 17). */
function rowOf(ref: string): number {
  return Number(ref.replace(/^[A-Z]+/, ''))
}

/** Führende Nullen der keeValue-Codes normalisieren: '1.0' → '1', '20.0' → '20'. */
function normCode(raw: string): string {
  const n = Number(raw)
  return Number.isFinite(n) ? String(n) : raw.trim()
}

/** Monatszahl aus '21 Monate'. */
function monate(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/(\d+(?:[.,]\d+)?)/)
  return m ? Number(m[1].replace(',', '.')) : null
}

// ── Blatt „Ergebnisse Erstellungskosten" ─────────────────────────────────────

/**
 * Liest die BKP-Zeilen. Aufbau (Spalten fix, Zeilen variabel):
 *   A = BKP-Code   B = Bezeichnung   C = exkl. MwSt.   D = inkl. MwSt.
 *   G = Kennwert   H = Einheit des Kennwerts
 * Unterpositionen von BKP 2 sind die Codes 20–29; sie führen zusätzlich in
 * Spalte E ihren Anteil an BKP 2 und dürfen nicht mitsummiert werden.
 */
function readErgebnisse(cells: Zellen): { zeilen: KeeValueZeile[]; totalNetto: number; totalBrutto: number } {
  const zeilen: KeeValueZeile[] = []
  let totalNetto = 0
  let totalBrutto = 0

  // Alle belegten Zeilennummern in Spalte A oder B einsammeln.
  const rows = new Set<number>()
  for (const ref of cells.keys()) {
    if (/^[AB]\d+$/.test(ref)) rows.add(rowOf(ref))
  }

  for (const r of [...rows].sort((a, b) => a - b)) {
    const a = txt(cells, `A${r}`)
    const b = txt(cells, `B${r}`)

    // Totalzeile — heisst im Blatt „Erstellungskosten CHF".
    if (a && /^Erstellungskosten/i.test(a)) {
      totalNetto = num(cells, `C${r}`) ?? 0
      totalBrutto = num(cells, `D${r}`) ?? 0
      continue
    }

    // Datenzeilen haben eine Zahl in A und eine Bezeichnung in B.
    if (!a || !b || !Number.isFinite(Number(a))) continue

    const code = normCode(a)
    const netto = num(cells, `C${r}`)
    const brutto = num(cells, `D${r}`)
    if (netto == null && brutto == null) continue

    const codeNum = Number(code)
    zeilen.push({
      code,
      label: b,
      netto: netto ?? 0,
      brutto: brutto ?? 0,
      kennwert: num(cells, `G${r}`),
      kennwertEinheit: txt(cells, `H${r}`),
      istUnterposition: codeNum >= 20 && codeNum <= 29,
    })
  }

  if (zeilen.length === 0) {
    throw new KeeValueParseError(
      'Im Blatt „Ergebnisse Erstellungskosten" wurden keine BKP-Zeilen gefunden. ' +
      'Stammt die Datei aus keeValue?',
    )
  }
  return { zeilen, totalNetto, totalBrutto }
}

/**
 * Bezugsgrössen aus dem Block „Kostenkennwerte BKP 2" am Fuss des Blatts.
 * Aufbau: Spalte A das Kennwert-Label, Spalte E der Text „Bezugsgrösse: 2'378 m²".
 */
function readBezugsgroessen(cells: Zellen): { bezugsGfM2: number | null; bezugsGvM3: number | null } {
  let gf: number | null = null
  let gv: number | null = null
  for (const [ref, val] of cells) {
    if (!/^A\d+$/.test(ref)) continue
    const menge = bezugsMenge(txt(cells, `E${rowOf(ref)}`))
    if (menge == null) continue
    if (/m²\s*GF/i.test(val)) gf ??= menge
    else if (/m³\s*GV/i.test(val)) gv ??= menge
  }
  return { bezugsGfM2: gf, bezugsGvM3: gv }
}

/** Zahl aus „Bezugsgrösse: 2'378 m²". */
function bezugsMenge(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/Bezugsgr[öo]sse:\s*([\d'’\s.]+)/i)
  if (!m) return null
  const n = Number(m[1].replace(/['’\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Terminkennwerte am Fuss des Ergebnis-Blatts. */
function readTermine(cells: Zellen): { planungszeitMonate: number | null; bauzeitMonate: number | null } {
  let planung: number | null = null
  let bau: number | null = null
  for (const [ref, val] of cells) {
    if (!/^A\d+$/.test(ref)) continue
    const r = rowOf(ref)
    if (/^Planungszeit/i.test(val)) planung = monate(txt(cells, `C${r}`))
    if (/^Bauzeit/i.test(val)) bau = monate(txt(cells, `C${r}`))
  }
  return { planungszeitMonate: planung, bauzeitMonate: bau }
}

// ── Blatt „Eingaben" ─────────────────────────────────────────────────────────

/**
 * Liest die Objektdaten. Das Blatt ist als Label/Wert-Paar in A/B aufgebaut und
 * durch Abschnittsüberschriften („Quantität", „Komplexität", „Qualität") in
 * Blöcke geteilt. Wir lesen Label/Wert generisch und ordnen nach Abschnitt zu —
 * so überstehen wir zusätzliche Zeilen einer neuen keeValue-Version.
 */
function readEingaben(cells: Zellen): { eingaben: KeeValueEingaben; version: string | null; preisstand: string | null; datum: string | null } {
  const rows = new Set<number>()
  for (const ref of cells.keys()) if (/^A\d+$/.test(ref)) rows.add(rowOf(ref))
  const sorted = [...rows].sort((a, b) => a - b)

  const eingaben: KeeValueEingaben = {
    objektbezeichnung: null, hauptnutzung: null, adresse: null, plzOrt: null,
    quantitaeten: {}, wertklassen: {},
  }
  let version: string | null = null
  let preisstand: string | null = null
  let datum: string | null = null
  let abschnitt: 'objekt' | 'quantitaet' | 'wertklasse' | null = null

  for (const r of sorted) {
    const label = txt(cells, `A${r}`)
    const wert = txt(cells, `B${r}`)
    if (!label) continue

    // Kopfzeilen „Datum: …" stehen komplett in Spalte A.
    if (/^Datum:/i.test(label)) { datum = label.replace(/^Datum:\s*/i, ''); continue }
    if (/^Version Baukosten:/i.test(label)) { version = label.replace(/^Version Baukosten:\s*/i, ''); continue }
    if (/^Preisstand:/i.test(label)) { preisstand = label.replace(/^Preisstand:\s*/i, ''); continue }

    // Abschnittswechsel (Überschrift ohne Wert in Spalte B).
    if (!wert) {
      if (/^Objektdaten$/i.test(label)) abschnitt = 'objekt'
      else if (/^Quantität$/i.test(label)) abschnitt = 'quantitaet'
      else if (/^(Komplexität|Qualität)$/i.test(label)) abschnitt = 'wertklasse'
      else if (/^Handeintrag$/i.test(label)) abschnitt = null
      continue
    }

    if (abschnitt === 'objekt') {
      if (/^Objektbezeichnung/i.test(label)) eingaben.objektbezeichnung = wert
      else if (/^Hauptnutzung/i.test(label)) eingaben.hauptnutzung = wert
      else if (/^Strasse/i.test(label)) eingaben.adresse = wert
      else if (/^Postleitzahl/i.test(label)) eingaben.plzOrt = wert
    } else if (abschnitt === 'quantitaet') {
      eingaben.quantitaeten[label] = wert
    } else if (abschnitt === 'wertklasse') {
      eingaben.wertklassen[label] = wert
    }
  }

  return { eingaben, version, preisstand, datum }
}

// ── Öffentliche API ──────────────────────────────────────────────────────────

/** Parst eine keeValue-Arbeitsmappe. Wirft KeeValueParseError bei Fremddateien. */
export function parseKeeValueXlsx(data: ArrayBuffer): KeeValueImport {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data))
  } catch {
    throw new KeeValueParseError('Die Datei ist keine gültige .xlsx-Datei.')
  }

  const shared = readSharedStrings(files)
  const paths = sheetPaths(files)

  const findSheet = (pattern: RegExp): Zellen | null => {
    for (const [name, path] of paths) {
      if (!pattern.test(name)) continue
      const raw = files[path]
      if (raw) return readSheet(strFromU8(raw), shared)
    }
    return null
  }

  const ergebnisCells = findSheet(/^Ergebnisse Erstellungskosten/i)
  if (!ergebnisCells) {
    throw new KeeValueParseError(
      'Das Blatt „Ergebnisse Erstellungskosten" fehlt. Bitte den unveränderten Excel-Export aus keeValue hochladen.',
    )
  }
  const { zeilen, totalNetto, totalBrutto } = readErgebnisse(ergebnisCells)
  const { planungszeitMonate, bauzeitMonate } = readTermine(ergebnisCells)
  const { bezugsGfM2, bezugsGvM3 } = readBezugsgroessen(ergebnisCells)

  const eingabeCells = findSheet(/^Eingaben/i)
  const meta = eingabeCells
    ? readEingaben(eingabeCells)
    : { eingaben: { objektbezeichnung: null, hauptnutzung: null, adresse: null, plzOrt: null, quantitaeten: {}, wertklassen: {} }, version: null, preisstand: null, datum: null }

  return {
    version: meta.version,
    preisstand: meta.preisstand,
    datum: meta.datum,
    eingaben: meta.eingaben,
    zeilen,
    totalNetto,
    totalBrutto,
    planungszeitMonate,
    bauzeitMonate,
    bezugsGfM2,
    bezugsGvM3,
  }
}

/** Hauptgruppen-Zeilen (ohne die Unterpositionen 20–29). */
export function hauptgruppenZeilen(imp: KeeValueImport): KeeValueZeile[] {
  return imp.zeilen.filter((z) => !z.istUnterposition)
}

/** Unterpositionen 20–29 von BKP 2. */
export function bkp2Unterpositionen(imp: KeeValueImport): KeeValueZeile[] {
  return imp.zeilen.filter((z) => z.istUnterposition)
}

/** Eine Zeile der Kostenberechnung in unserer Hauptgruppen-Systematik. */
export interface NaefKostenZeile {
  /** Hauptgruppe ('1', '2', '4', '5', '6', '9') oder Unterposition ('20'…'28'). */
  code: string
  label: string
  netto: number
  brutto: number
  kennwert: number | null
  kennwertEinheit: string | null
  /** 0 = Hauptgruppe, 1 = Unterposition von BKP 2. */
  ebene: 0 | 1
}

/**
 * Stellt den Import als Kostenberechnung in unserer Systematik dar — mit den
 * BKP-2-Unterpositionen als eingerückte Zeilen direkt unter BKP 2.
 *
 * Zwei Umbuchungen gegenüber der keeValue-Nummerierung:
 *   • Position 29 „Honorare" wird aus BKP 2 herausgelöst und zur Hauptgruppe 6
 *     „Honorare" — unsere 6 ist die Honorargruppe, keeValue führt sie in 2.
 *   • keeValue-Position 6 „Reserve" wandert nach Hauptgruppe 9, wo bei uns die
 *     Reserve (Position 970) sitzt. Ohne das kollidierte sie mit den Honoraren.
 *
 * Die Kennwerte von BKP 2 und 29 stehen beide in CHF/m² GF und dürfen deshalb
 * voneinander abgezogen werden. Weichen die Einheiten ab, bleibt der Kennwert
 * der reduzierten BKP-2-Zeile leer statt falsch.
 */
export function naefKostenZeilen(imp: KeeValueImport): NaefKostenZeile[] {
  const honorar = imp.zeilen.find((z) => z.code === '29') ?? null
  const reserve = imp.zeilen.find((z) => z.code === '6' && !z.istUnterposition) ?? null

  const out: NaefKostenZeile[] = []

  for (const z of imp.zeilen) {
    if (z.istUnterposition) continue
    if (z.code === '6') continue // Reserve — kommt unten als Hauptgruppe 9

    if (z.code === '2') {
      const netto = z.netto - (honorar?.netto ?? 0)
      const brutto = z.brutto - (honorar?.brutto ?? 0)
      const gleicheEinheit = honorar != null
        && z.kennwertEinheit != null
        && z.kennwertEinheit === honorar.kennwertEinheit
      out.push({
        code: z.code,
        label: z.label,
        netto,
        brutto,
        kennwert: honorar == null
          ? z.kennwert
          : (gleicheEinheit && z.kennwert != null && honorar.kennwert != null
              ? z.kennwert - honorar.kennwert
              : null),
        kennwertEinheit: z.kennwertEinheit,
        ebene: 0,
      })
      // Unterpositionen direkt darunter — ohne 29, die ist jetzt Hauptgruppe 6.
      for (const u of imp.zeilen) {
        if (!u.istUnterposition || u.code === '29') continue
        out.push({ ...u, ebene: 1 })
      }
      continue
    }

    out.push({ ...z, ebene: 0 })
  }

  if (honorar) {
    out.push({
      code: '6',
      label: 'Honorare',
      netto: honorar.netto,
      brutto: honorar.brutto,
      kennwert: honorar.kennwert,
      kennwertEinheit: honorar.kennwertEinheit,
      ebene: 0,
    })
  }
  if (reserve) {
    out.push({
      code: '9',
      label: 'Reserve',
      netto: reserve.netto,
      brutto: reserve.brutto,
      kennwert: reserve.kennwert,
      kennwertEinheit: reserve.kennwertEinheit,
      ebene: 0,
    })
  }

  return out
}

// ── Vollständige Anlagekosten: keeValue plus die fehlenden Hauptgruppen ─────

/**
 * Die vier Kennwerte für die von keeValue nicht abgedeckten Hauptgruppen
 * (Migration 060). Prozentsätze als Faktor, also 0.03 für 3 %.
 */
export interface ErgaenzungDoc {
  /** BKP 0 Grundstück: CHF pro m² Grundstücksfläche. */
  bkp0ChfProM2Gsf: number | null
  /** BKP 7 Vermarktung: Anteil am Ertrag bzw. Verkaufserlös. */
  bkp7ProzentVonErtrag: number | null
  /** BKP 8 Entwicklungskosten: Anteil an BKP 1–7. */
  bkp8ProzentVon1bis7: number | null
  /** BKP 9 Eigentümerkosten: Anteil an BKP 1–8. */
  bkp9ProzentVon1bis8: number | null
  /**
   * BKP 9 Reserve: Anteil an BKP 0–8 (Bezug wie Katalogposition 970).
   * null = die aus keeValue importierte Reserve gilt unverändert.
   */
  bkp9ReserveProzentVon0bis8: number | null
}

export const LEERE_ERGAENZUNG: ErgaenzungDoc = {
  bkp0ChfProM2Gsf: null,
  bkp7ProzentVonErtrag: null,
  bkp8ProzentVon1bis7: null,
  bkp9ProzentVon1bis8: null,
  bkp9ReserveProzentVon0bis8: null,
}

/**
 * Erfassungstiefe der keeValue-Methode — wie bei den Benchmarks:
 *   'total'      — ein keeValue-Ergebnis für die ganze Variante
 *   'aufgeteilt' — je Block aus Etappe × Nutzungsart ein eigenes Ergebnis,
 *                  separat in keeValue gerechnet und separat eingelesen
 * Beide Stände bleiben gespeichert, ein Wechsel verwirft also nichts.
 */
export type KeeValueModus = 'total' | 'aufgeteilt'

/**
 * Das JSONB-Dokument von variant_keevalue_ergaenzung: die Erfassungstiefe und
 * die ergänzenden Kennwerte je Ebene. Die Excel-Importe selbst liegen daneben
 * in variant_keevalue_import, ein Datensatz je Block (Migration 062).
 */
export interface ErgaenzungsDokument {
  modus: KeeValueModus
  /** Kennwerte im Gesamtmodus. */
  total: ErgaenzungDoc
  /** Kennwerte je Block; Schlüssel = blockKey() aus lib/bkpBlocks.ts. */
  bloecke: Record<string, ErgaenzungDoc>
}

function normalizeKennwerte(k: Partial<ErgaenzungDoc> | null | undefined): ErgaenzungDoc {
  return { ...LEERE_ERGAENZUNG, ...(k ?? {}) }
}

/**
 * Fehlende Felder auffüllen — `doc` kommt als beliebiges JSONB aus der DB.
 *
 * Deckt auch den früheren Aufbau ab, bei dem die Kennwerte flach im Dokument
 * lagen (vor der Aufteilung nach Etappe × Nutzungsart): fehlt `total`, werden
 * die Felder der obersten Ebene als Gesamtsatz übernommen.
 */
export function normalizeErgaenzung(
  doc: Partial<ErgaenzungsDokument> | null | undefined,
): ErgaenzungsDokument {
  const roh = (doc ?? {}) as Partial<ErgaenzungsDokument> & Partial<ErgaenzungDoc>
  const bloecke: Record<string, ErgaenzungDoc> = {}
  for (const [key, k] of Object.entries(roh.bloecke ?? {})) {
    bloecke[key] = normalizeKennwerte(k as Partial<ErgaenzungDoc>)
  }
  return {
    modus: roh.modus === 'aufgeteilt' ? 'aufgeteilt' : 'total',
    total: roh.total != null
      ? normalizeKennwerte(roh.total)
      : normalizeKennwerte(roh as Partial<ErgaenzungDoc>),
    bloecke,
  }
}

export interface AnlagekostenZeile extends NaefKostenZeile {
  /** 'keevalue' = aus dem Import, 'ergaenzung' = hier erfasster Ansatz. */
  quelle: 'keevalue' | 'ergaenzung'
  /** Welches Feld der Ergänzung dieser Ansatz bearbeitet. */
  feld?: keyof ErgaenzungDoc
  /** Aktueller Wert des Ansatzes (Faktor bei %, CHF bei CHF/m²). */
  ansatzWert?: number | null
  /** Einheit des Ansatzes. */
  ansatzEinheit?: 'CHF/m²' | '%'
  /** Woraus gerechnet wird, im Klartext — z.B. „von BKP 1–7 8'950'919 CHF". */
  ansatzBasis?: string
  /**
   * Kennwert in CHF/m² GF inkl. MwSt, einheitlich für jede Zeile gerechnet.
   * null, wenn keine GF-Bezugsgrösse bekannt ist.
   */
  chfProM2Gf: number | null
  /**
   * Ursprünglicher keeValue-Kennwert, falls er sich NICHT auf die GF bezieht
   * (BKP 4 rechnet auf der BUF). Sonst leer — die GF-Spalte zeigt ihn ohnehin.
   */
  fremdKennwert?: string
}

export interface AnlagekostenErgebnis {
  zeilen: AnlagekostenZeile[]
  /** Total über alle Hauptgruppen (ohne die Unterpositionen). */
  totalNetto: number
  totalBrutto: number
  /** Die keeValue-Erstellungskosten als Teilsumme — zur Einordnung. */
  erstellungskostenNetto: number
  erstellungskostenBrutto: number
  /** Geschossfläche (m²), auf die die Kennwertspalte rechnet. */
  bezugsGfM2: number | null
}

export interface AnlagekostenBezug {
  /** Grundstücksfläche (m²) aus den Parzellen. */
  gsfTotal: number
  /** Geschossfläche (m²) aus dem Mengengerüst — Rückfall für die Kennwerte. */
  gfM2: number
  /** Jahresertrag bzw. Verkaufserlös der Variante (Basis für BKP 7). */
  ertragBasis: number
  /** Globaler MwSt-Satz der Variante, z.B. 0.081. */
  mwstSatz: number
}

/**
 * Setzt die vollständigen Anlagekosten zusammen: die importierten
 * keeValue-Hauptgruppen plus BKP 0, 7, 8 und die Eigentümerkosten in 9.
 *
 * Die Prozentzeilen rechnen auf den **Netto**-Summen und legen die MwSt danach
 * oben drauf — gleiche Konvention wie die Engine in lib/bkpBerechnung.ts.
 * Die MwSt-Pflicht folgt dem Detailkatalog: Grundstück (010) und
 * Eigenleistungen (910/920) sind ohne, Vermarktung (7xx) und Entwicklung (8xx)
 * mit MwSt gerechnet.
 *
 * Die Basen sind kumulativ: BKP 8 bezieht sich auf 1–7 (also inklusive der
 * gerade erst gerechneten 7), BKP 9 Eigentümerkosten auf 1–8. BKP 0 bleibt in
 * beiden Basen aussen vor — analog zu den Katalogpositionen 810/910.
 */
export function anlagekostenZeilen(
  imp: KeeValueImport,
  erg: ErgaenzungDoc,
  bezug: AnlagekostenBezug,
): AnlagekostenErgebnis {
  const kv = naefKostenZeilen(imp)
  // Die keeValue-Reserve steht in Hauptgruppe 9 und gehört ans Ende, hinter
  // die hier erfassten Gruppen 7 und 8.
  const reserve = kv.find((z) => z.ebene === 0 && z.code === '9') ?? null
  const kvRest = kv.filter((z) => z !== reserve)

  const mitMwst = (netto: number) => netto * (1 + bezug.mwstSatz)
  const zeilen: AnlagekostenZeile[] = []

  // ─── BKP 0 Grundstück — Menge aus den Parzellen, ohne MwSt ───────────────
  const bkp0Netto = (erg.bkp0ChfProM2Gsf ?? 0) * bezug.gsfTotal
  zeilen.push({
    code: '0',
    label: 'Grundstück',
    netto: bkp0Netto,
    brutto: bkp0Netto, // Grundstückerwerb ist nicht mehrwertsteuerpflichtig
    kennwert: erg.bkp0ChfProM2Gsf,
    kennwertEinheit: 'CHF/m² GSF',
    ebene: 0,
    chfProM2Gf: null, // wird unten für alle Zeilen einheitlich gesetzt
    quelle: 'ergaenzung',
    feld: 'bkp0ChfProM2Gsf',
    ansatzWert: erg.bkp0ChfProM2Gsf,
    ansatzEinheit: 'CHF/m²',
    ansatzBasis: `× GSF ${formatMenge(bezug.gsfTotal)} m²`,
  })

  // ─── BKP 1–6 aus keeValue ───────────────────────────────────────────────
  for (const z of kvRest) zeilen.push({ ...z, quelle: 'keevalue', chfProM2Gf: null })

  // ─── BKP 7 Vermarktung — % vom Ertrag / Verkaufserlös ───────────────────
  const bkp7Netto = (erg.bkp7ProzentVonErtrag ?? 0) * bezug.ertragBasis
  zeilen.push({
    code: '7',
    label: 'Vermarktung',
    netto: bkp7Netto,
    brutto: mitMwst(bkp7Netto),
    kennwert: erg.bkp7ProzentVonErtrag,
    kennwertEinheit: '%',
    ebene: 0,
    chfProM2Gf: null,
    quelle: 'ergaenzung',
    feld: 'bkp7ProzentVonErtrag',
    ansatzWert: erg.bkp7ProzentVonErtrag,
    ansatzEinheit: '%',
    ansatzBasis: `von Ertrag / Verkaufserlös ${formatMenge(bezug.ertragBasis)} CHF`,
  })

  // ─── BKP 8 Entwicklungskosten — % von BKP 1–7 ───────────────────────────
  const basis1bis7 = summeHauptgruppen(zeilen, 1, 7)
  const bkp8Netto = (erg.bkp8ProzentVon1bis7 ?? 0) * basis1bis7
  zeilen.push({
    code: '8',
    label: 'Entwicklungskosten',
    netto: bkp8Netto,
    brutto: mitMwst(bkp8Netto),
    kennwert: erg.bkp8ProzentVon1bis7,
    kennwertEinheit: '%',
    ebene: 0,
    chfProM2Gf: null,
    quelle: 'ergaenzung',
    feld: 'bkp8ProzentVon1bis7',
    ansatzWert: erg.bkp8ProzentVon1bis7,
    ansatzEinheit: '%',
    ansatzBasis: `von BKP 1–7 ${formatMenge(basis1bis7)} CHF`,
  })

  // ─── Hauptgruppe 9: Eigentümerkosten, dann Reserve ──────────────────────
  // Beide Basen enden bei BKP 8 und sind damit unabhängig von der Reihenfolge —
  // was in Hauptgruppe 9 steht, bezieht sich nicht auf sich selbst.
  const basis1bis8 = summeHauptgruppen(zeilen, 1, 8)
  const basis0bis8 = summeHauptgruppen(zeilen, 0, 8)

  const bkp9Netto = (erg.bkp9ProzentVon1bis8 ?? 0) * basis1bis8
  zeilen.push({
    code: '9',
    label: 'Eigentümerkosten',
    netto: bkp9Netto,
    brutto: bkp9Netto, // Eigenleistungen sind nicht mehrwertsteuerpflichtig
    kennwert: erg.bkp9ProzentVon1bis8,
    kennwertEinheit: '%',
    ebene: 0,
    chfProM2Gf: null,
    quelle: 'ergaenzung',
    feld: 'bkp9ProzentVon1bis8',
    ansatzWert: erg.bkp9ProzentVon1bis8,
    ansatzEinheit: '%',
    ansatzBasis: `von BKP 1–8 ${formatMenge(basis1bis8)} CHF`,
  })

  // Mit Prozentsatz wird die Reserve auf BKP 0–8 gerechnet (Bezug wie
  // Katalogposition 970) und ersetzt den keeValue-Wert. Ohne Prozentsatz gilt
  // die importierte Reserve unverändert.
  const reserveProzent = erg.bkp9ReserveProzentVon0bis8
  const reserveNetto = reserveProzent != null ? reserveProzent * basis0bis8 : (reserve?.netto ?? 0)
  zeilen.push({
    code: '9',
    label: 'Reserve',
    netto: reserveNetto,
    brutto: reserveProzent != null ? mitMwst(reserveNetto) : (reserve?.brutto ?? 0),
    kennwert: reserveProzent,
    kennwertEinheit: '%',
    ebene: 0,
    chfProM2Gf: null,
    quelle: 'ergaenzung',
    feld: 'bkp9ReserveProzentVon0bis8',
    ansatzWert: reserveProzent,
    ansatzEinheit: '%',
    ansatzBasis: reserveProzent != null
      ? `von BKP 0–8 ${formatMenge(basis0bis8)} CHF`
      : 'leer = Reserve aus keeValue',
  })

  // ─── Kennwerte einheitlich über die GF ──────────────────────────────────
  // Bezug ist die GF, auf die keeValue selbst rechnet; fehlt sie im Blatt,
  // greift die GF aus dem Mengengerüst. Brutto-basiert wie bei keeValue.
  const gf = imp.bezugsGfM2 ?? (bezug.gfM2 > 0 ? bezug.gfM2 : null)
  for (const z of zeilen) {
    z.chfProM2Gf = gf && gf > 0 ? z.brutto / gf : null
    // Kennwerte auf anderer Bezugsgrösse (BKP 4 rechnet auf der BUF) erhalten,
    // sonst ginge die Information des Imports verloren.
    if (z.quelle === 'keevalue' && z.kennwert != null && z.kennwertEinheit
        && !/m²\s*GF/i.test(z.kennwertEinheit)) {
      z.fremdKennwert = `${formatMenge(z.kennwert)} ${z.kennwertEinheit}`
    }
  }

  const hauptgruppen = zeilen.filter((z) => z.ebene === 0)
  return {
    zeilen,
    totalNetto: hauptgruppen.reduce((s, z) => s + z.netto, 0),
    totalBrutto: hauptgruppen.reduce((s, z) => s + z.brutto, 0),
    erstellungskostenNetto: imp.totalNetto,
    erstellungskostenBrutto: imp.totalBrutto,
    bezugsGfM2: gf,
  }
}

/** Netto-Summe der Hauptgruppen-Zeilen mit Code von..bis (Unterpositionen aussen vor). */
function summeHauptgruppen(zeilen: AnlagekostenZeile[], von: number, bis: number): number {
  return zeilen
    .filter((z) => z.ebene === 0)
    .filter((z) => {
      const n = Number(z.code)
      return Number.isFinite(n) && n >= von && n <= bis
    })
    .reduce((s, z) => s + z.netto, 0)
}

/** Ganzzahl mit Tausender-Hochkomma — nur für die Basistexte in der UI. */
function formatMenge(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

/**
 * Übersetzt die keeValue-Anlagekosten in ein BkpErgebnis, wie es die Engine in
 * lib/bkpBerechnung.ts liefert. Damit können Wirtschaftlichkeit, Rendite und
 * Kostenmiete unverändert weiterrechnen, egal welche Erfassungsmethode gewählt
 * ist — sie sehen in beiden Fällen dieselbe Struktur.
 *
 * `anteil` verteilt das Variantentotal auf eine Eigentumsart (0..1). keeValue
 * kennt keine Eigentumsarten — die Aufteilung erfolgt beim Aufrufer, üblich
 * nach VMF-Anteil.
 *
 * Abgebildet werden die Hauptgruppensummen sowie die Position 010
 * (Grundstückerwerb), die von Kostenmiete, Rendite, WBF und Honorarrechner als
 * Landanteil gelesen wird. Einzelpositionen darüber hinaus kennt die Methode
 * naturgemäss nicht.
 */
export function alsBkpErgebnis(erg: AnlagekostenErgebnis, anteil: number): BkpErgebnis {
  const nettoHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  const mwstHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  let grundstueckNetto = 0
  let grundstueckMwst = 0

  for (const z of erg.zeilen) {
    if (z.ebene !== 0) continue // Unterpositionen stecken in BKP 2
    const hg = Number(z.code)
    if (!Number.isFinite(hg) || hg < 0 || hg > 9) continue
    const netto = z.netto * anteil
    const mwst = (z.brutto - z.netto) * anteil
    nettoHg[hg] += netto
    mwstHg[hg] += mwst
    if (hg === 0) { grundstueckNetto += netto; grundstueckMwst += mwst }
  }

  const pos010 = BKP_POSITIONEN.find((p) => p.code === '010')!
  return {
    positionen: {
      '010': {
        position: pos010,
        status: 'beruecksichtigt',
        kennwert: null,
        betragOverride: null,
        menge: null,
        mengeEinheit: 'm² GSF',
        preisEinheit: 'CHF/m²',
        betragNetto: grundstueckNetto,
        mwstAnwenden: grundstueckMwst > 0,
        mwstSatz: grundstueckNetto > 0 ? grundstueckMwst / grundstueckNetto : 0,
        mwstBetrag: grundstueckMwst,
        betragBrutto: grundstueckNetto + grundstueckMwst,
        berechnungs_info: 'aus keeValue',
      } satisfies PositionResult,
    },
    hauptgruppenSummenNetto: nettoHg as BkpErgebnis['hauptgruppenSummenNetto'],
    hauptgruppenSummenMwst: mwstHg as BkpErgebnis['hauptgruppenSummenMwst'],
    totalNetto: erg.totalNetto * anteil,
    totalMwst: (erg.totalBrutto - erg.totalNetto) * anteil,
    totalBrutto: erg.totalBrutto * anteil,
  }
}

/**
 * Skaliert ein BkpErgebnis auf einen Anteil (0..1) — etwa um ein gesamthaft
 * erfasstes Variantentotal auf eine Etappe herunterzubrechen. Alle Beträge
 * werden proportional gezogen, auch der Landanteil in Position 010.
 */
export function skaliereErgebnis(erg: BkpErgebnis, anteil: number): BkpErgebnis {
  const nettoHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  const mwstHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  for (let c = 0; c <= 9; c++) {
    const k = c as keyof typeof erg.hauptgruppenSummenNetto
    nettoHg[c] = (erg.hauptgruppenSummenNetto[k] ?? 0) * anteil
    mwstHg[c] = (erg.hauptgruppenSummenMwst[k] ?? 0) * anteil
  }
  const p = erg.positionen['010']
  const landNetto = (p?.betragNetto ?? 0) * anteil
  const landMwst = (p?.mwstBetrag ?? 0) * anteil
  const pos010 = BKP_POSITIONEN.find((x) => x.code === '010')!
  return {
    positionen: {
      '010': {
        position: pos010,
        status: 'beruecksichtigt',
        kennwert: null,
        betragOverride: null,
        menge: null,
        mengeEinheit: 'm² GSF',
        preisEinheit: 'CHF/m²',
        betragNetto: landNetto,
        mwstAnwenden: landMwst > 0,
        mwstSatz: landNetto > 0 ? landMwst / landNetto : 0,
        mwstBetrag: landMwst,
        betragBrutto: landNetto + landMwst,
        berechnungs_info: 'Anteil am Gesamttotal',
      } satisfies PositionResult,
    },
    hauptgruppenSummenNetto: nettoHg as BkpErgebnis['hauptgruppenSummenNetto'],
    hauptgruppenSummenMwst: mwstHg as BkpErgebnis['hauptgruppenSummenMwst'],
    totalNetto: erg.totalNetto * anteil,
    totalMwst: erg.totalMwst * anteil,
    totalBrutto: erg.totalBrutto * anteil,
  }
}

/**
 * Summiert mehrere BkpErgebnisse zu einem — etwa die Blöcke einer Nutzungsart,
 * wenn keeValue je Etappe gerechnet wurde. Die Position 010 (Grundstück) wird
 * mitaddiert, weil Kostenmiete und Rendite daraus den Landanteil lesen.
 */
export function addiereErgebnisse(teile: BkpErgebnis[]): BkpErgebnis {
  const nettoHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  const mwstHg: Record<number, number> = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 }
  let landNetto = 0
  let landMwst = 0
  let totalNetto = 0
  let totalMwst = 0

  for (const t of teile) {
    for (let c = 0; c <= 9; c++) {
      const k = c as keyof typeof t.hauptgruppenSummenNetto
      nettoHg[c] += t.hauptgruppenSummenNetto[k] ?? 0
      mwstHg[c] += t.hauptgruppenSummenMwst[k] ?? 0
    }
    const p = t.positionen['010']
    landNetto += p?.betragNetto ?? 0
    landMwst += p?.mwstBetrag ?? 0
    totalNetto += t.totalNetto
    totalMwst += t.totalMwst
  }

  const pos010 = BKP_POSITIONEN.find((p) => p.code === '010')!
  return {
    positionen: {
      '010': {
        position: pos010,
        status: 'beruecksichtigt',
        kennwert: null,
        betragOverride: null,
        menge: null,
        mengeEinheit: 'm² GSF',
        preisEinheit: 'CHF/m²',
        betragNetto: landNetto,
        mwstAnwenden: landMwst > 0,
        mwstSatz: landNetto > 0 ? landMwst / landNetto : 0,
        mwstBetrag: landMwst,
        betragBrutto: landNetto + landMwst,
        berechnungs_info: 'Summe der keeValue-Blöcke',
      } satisfies PositionResult,
    },
    hauptgruppenSummenNetto: nettoHg as BkpErgebnis['hauptgruppenSummenNetto'],
    hauptgruppenSummenMwst: mwstHg as BkpErgebnis['hauptgruppenSummenMwst'],
    totalNetto,
    totalMwst,
    totalBrutto: totalNetto + totalMwst,
  }
}

/** Ein Betrag je Naef-Hauptgruppe. */
export type HauptgruppenBetraege = Record<number, { netto: number; brutto: number }>

/**
 * Übersetzt den Import in unsere Hauptgruppen-Systematik (lib/bkpKatalog.ts).
 *
 * Zwei Eigenheiten von keeValue werden dabei begradigt:
 *   • Position 29 „Honorare" liegt bei keeValue innerhalb BKP 2. Wir buchen sie
 *     nach Hauptgruppe 6 und ziehen sie von BKP 2 ab (sonst Doppelzählung).
 *   • keeValue nennt seine Position 6 „Reserve"; unsere Reserve ist die
 *     Position 970 in Hauptgruppe 9. Sie wird deshalb nach 9 gebucht.
 *
 * BKP 0 (Grundstück), 3, 7 und 8 deckt keeValue nicht ab — die bleiben leer und
 * werden weiterhin über den Detailkatalog bzw. die Benchmarks erfasst.
 */
export function zuNaefHauptgruppen(imp: KeeValueImport): HauptgruppenBetraege {
  const out: HauptgruppenBetraege = {}
  const add = (hg: number, netto: number, brutto: number) => {
    const cur = out[hg] ?? { netto: 0, brutto: 0 }
    out[hg] = { netto: cur.netto + netto, brutto: cur.brutto + brutto }
  }

  const honorar = imp.zeilen.find((z) => z.code === '29')

  for (const z of imp.zeilen) {
    if (z.istUnterposition) continue // in BKP 2 bereits enthalten
    if (z.code === '6') { add(9, z.netto, z.brutto); continue } // Reserve → HG 9
    const hg = Number(z.code)
    if (!Number.isFinite(hg) || hg < 0 || hg > 9) continue
    if (hg === 2 && honorar) {
      // Honorare aus BKP 2 herauslösen …
      add(2, z.netto - honorar.netto, z.brutto - honorar.brutto)
      // … und als Hauptgruppe 6 führen.
      add(6, honorar.netto, honorar.brutto)
      continue
    }
    add(hg, z.netto, z.brutto)
  }
  return out
}
