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
}

export class KeeValueParseError extends Error {}

// ── Mengen aus dem Businessplan für das keeValue-Eingabeformular ─────────────

/** Nur die Felder, die für die keeValue-Mengen gebraucht werden. */
type MengenMietflaeche =
  Pick<BuildingMietflaeche, 'nutzung' | 'unterirdisch' | 'gf_m2' | 'volumen_m3' | 'anzahl'>
  & { mieteinheiten?: Pick<BuildingMieteinheit, 'anzahl'>[] }

type MengenGebaeude =
  Pick<VariantBuilding, 'geschossflaeche_m2' | 'volumen_m3'>
  & { mietflaechen: MengenMietflaeche[] }

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
 */
export function ermittleKeeValueMengen(buildings: MengenGebaeude[]): KeeValueMengen {
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

  for (const b of buildings) {
    if (b.mietflaechen.length === 0) {
      gfM2 += b.geschossflaeche_m2 ?? 0
      gvM3 += b.volumen_m3 ?? 0
      continue
    }
    for (const m of b.mietflaechen) {
      const vol = m.volumen_m3 ?? 0
      gfM2 += m.gf_m2 ?? 0
      gvM3 += vol
      if (m.unterirdisch) {
        gvUnterirdischM3 += vol
        // Unterirdisch erfasste Parking-/Garagenfläche = Tiefgaragenplätze.
        if (isGarageNutzung(m.nutzung ?? '')) parkplaetzeUnterirdisch += anzahlVon(m)
      }
    }
  }

  return {
    gfM2,
    gvM3,
    gvUnterirdischM3,
    anteilUnterTerrain: gvM3 > 0 ? gvUnterirdischM3 / gvM3 : null,
    parkplaetzeUnterirdisch,
    anzahlGebaeude: buildings.length,
  }
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
