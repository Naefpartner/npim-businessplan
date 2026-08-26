export type ProjectPhase =
  | 'grundstuecksakquisition'
  | 'machbarkeit'
  | 'loi'
  | 'wettbewerb'
  | 'ueberarbeitung_wettbewerb'
  | 'gestaltungsplan'
  | 'vorprojekt'
  | 'bauprojekt'
  | 'bewilligungsverfahren'
  | 'ausschreibung'
  | 'realisierung'

export type ProjectUseType =
  | 'renditeobjekt'
  | 'verkaufsobjekt'
  | 'genossenschaft'
  | 'gemischt'

export type VariantStatus = 'entwurf' | 'aktiv' | 'archiviert'

export interface Project {
  id: string
  name: string
  project_number: string | null
  strasse: string | null
  hausnummer: string | null
  plz: string | null
  ort: string | null
  description: string | null
  start_year: number | null
  customer_id: string | null
  archived: boolean
  // Ausnutzungs-Inputs (VMF-Berechnung, analog immo-portfolio)
  vmf_ausnuetzungsuebertragung_m2: number | null
  vmf_az_anrechenbar_pct: number | null
  vmf_bm_geschosshoehe_m: number | null
  vmf_bm_gelaendekorrektur_pct: number | null
  vmf_bm_vmf_gf_pct: number | null
  vmf_uz_vmf_gf_pct: number | null
  vmf_ff_vmf_gf_pct: number | null
  // Foto-Galerie / Thumbnail
  thumbnail_photo_id: string | null
  // GIS-Karte (Kantons-Webview)
  gis_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Eingebetteter Kunde (nur wenn explizit per JOIN abgefragt)
  customer?: { id: string; name: string } | null
  // Eingebettetes Thumbnail-Foto (nur wenn per JOIN abgefragt)
  thumbnail_photo?: { id: string; storage_path: string } | null
}

export interface ProjectPhoto {
  id: string
  project_id: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  sort_order: number
  created_at: string
  created_by: string | null
}

export interface ProjectGisScreenshot {
  id: string
  project_id: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  sort_order: number
  created_at: string
  created_by: string | null
}

export function projectAddressLine(p: Pick<Project, 'strasse' | 'hausnummer' | 'plz' | 'ort'>): string | null {
  const line1 = [p.strasse, p.hausnummer].filter(Boolean).join(' ').trim()
  const line2 = [p.plz, p.ort].filter((s) => s && s.toString().trim()).join(' ').trim()
  const combined = [line1, line2].filter(Boolean).join(', ')
  return combined || null
}

export interface ProjectVariant {
  id: string
  project_id: string
  variant_number: number
  name: string
  phase: ProjectPhase
  status: VariantStatus
  notes: string | null
  snapshot_of: string | null
  snapshot_taken_at: string | null
  /** Globaler MwSt-Satz für die Anlagekosten-Berechnung (z.B. 0.081 = 8.1%) */
  mwst_satz: number
  /** Gewählte Erfassungsmethode der Anlagekosten (Kachelauswahl im Reiter). */
  kosten_methode: KostenMethode
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Erfassungsmethode der Anlagekosten je Variante (Migration 059):
 *   'benchmark' — Grobschätzung über Benchmarks BKP 0–9
 *   'keevalue'  — Erstellungskosten BKP 1–5 aus dem Onlinetool keevalue.ch
 *   'detail'    — Detailkatalog mit Positionsraster (Standard)
 */
export type KostenMethode = 'benchmark' | 'keevalue' | 'detail'

export const KOSTEN_METHODE_LABEL: Record<KostenMethode, string> = {
  benchmark: 'Benchmarks BKP 0–9',
  keevalue:  'keeValue',
  detail:    'Detailkatalog',
}

/**
 * Gespeicherter keeValue-Excel-Import. `doc` = KeeValueImport.
 * Ein Datensatz je Variante × Block (Migration 062): `block_key` ist leer für
 * den Gesamtimport, sonst '<etappe_id>::<eigentumsart>'.
 */
export interface VariantKeeValueImport {
  id: string
  variant_id: string
  block_key: string
  file_name: string | null
  preisstand: string | null
  version: string | null
  doc: unknown
  imported_by: string | null
  created_at: string
  updated_at: string
}

export const PHASE_LABEL: Record<ProjectPhase, string> = {
  grundstuecksakquisition:  'Grundstücksakquisition',
  machbarkeit:              'Machbarkeit',
  loi:                      'LOI',
  wettbewerb:               'Wettbewerb',
  ueberarbeitung_wettbewerb:'Überarbeitung Wettbewerb',
  gestaltungsplan:          'Gestaltungsplan',
  vorprojekt:               'Vorprojekt',
  bauprojekt:               'Bauprojekt',
  bewilligungsverfahren:    'Bewilligungsverfahren',
  ausschreibung:            'Ausschreibung',
  realisierung:             'Realisierung',
}

export const PHASE_ORDER: ProjectPhase[] = [
  'grundstuecksakquisition',
  'machbarkeit',
  'loi',
  'wettbewerb',
  'ueberarbeitung_wettbewerb',
  'gestaltungsplan',
  'vorprojekt',
  'bauprojekt',
  'bewilligungsverfahren',
  'ausschreibung',
  'realisierung',
]

export const USE_TYPE_LABEL: Record<ProjectUseType, string> = {
  renditeobjekt:  'Renditeobjekt',
  verkaufsobjekt: 'Verkaufsobjekt',
  genossenschaft: 'Genossenschaft',
  gemischt:       'Gemischt',
}

// In der UI auswählbare Nutzungsarten — 'gemischt' ist abgeschafft (pro Gebäude
// genau eine Eigentumsart). Der Enum-Wert bleibt für Bestandsdaten definiert.
export const USE_TYPE_SELECTABLE: ProjectUseType[] = [
  'renditeobjekt', 'genossenschaft', 'verkaufsobjekt',
]

export const VARIANT_STATUS_LABEL: Record<VariantStatus, string> = {
  entwurf:     'Entwurf',
  aktiv:       'Aktiv',
  archiviert:  'Archiviert',
}

// ─── Stammdaten ─────────────────────────────────────────────────────────────

export type BuildingCondition =
  | 'gut'
  | 'mittel'
  | 'sanierungsbeduerftig'
  | 'abbruchreif'


export interface Parcel {
  id: string
  project_id: string
  parzelle_nummer: string
  gemeinde: string | null
  kanton: string | null
  flaeche_m2: number | null
  agsf_m2: number | null
  zone: string | null
  eigentuemer: string | null
  erwerbsdatum: string | null
  erwerbspreis_chf: number | null
  // Baurecht (analog immo-portfolio: simple Felder pro Parzelle)
  has_building_right: boolean
  building_right_fee_chf_pa: number | null
  building_right_expiry: string | null
  notizen: string | null
  created_at: string
  updated_at: string
}

export interface ExistingBuilding {
  id: string
  project_id: string
  bezeichnung: string
  gvz_nummer: string | null
  baujahr: number | null
  nutzung: string | null
  geschossflaeche_m2: number | null
  volumen_m3: number | null
  zustand: BuildingCondition | null
  vermietet: boolean
  jahresertrag_chf: number | null
  notizen: string | null
  created_at: string
  updated_at: string
  // Embed: nur gefüllt, wenn per Supabase-Relation mitgeladen
  owners?: ExistingBuildingOwner[]
}

export interface ExistingBuildingOwner {
  id: string
  existing_building_id: string
  name: string
  anteil_pct: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ZoneRegulation {
  id: string
  project_id: string
  zone_type: string
  az: number | null
  bmz: number | null
  uez: number | null
  ffz: number | null
  vollgeschosse: number | null
  anrech_ug: number | null
  anrech_ug_pct: number | null
  dg: number | null
  dg_pct: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export const BUILDING_CONDITION_LABEL: Record<BuildingCondition, string> = {
  gut:                  'Gut',
  mittel:               'Mittel',
  sanierungsbeduerftig: 'Sanierungsbedürftig',
  abbruchreif:          'Abbruchreif',
}

// ─── Mengengerüst (variantenbezogen) ───────────────────────────────────────

export type BuildingArt = 'neubau' | 'sanierung' | 'bestand_unveraendert' | 'abbruch'

// ─── Etappen (Bauetappen pro Variante) ──────────────────────────────────────

export interface VariantEtappe {
  id: string
  variant_id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

// ─── Eigentumskategorie (Anlagekosten) ──────────────────────────────────────
// Drei Kategorien, pro Gebäude genau eine, abgeleitet aus use_type — durchgängig
// zu Mengengerüst/Wohnungsmix. Renditeobjekt + Gemischt → Renditeobjekt,
// Genossenschaft → Genossenschaft, Verkaufsobjekt → Verkaufsobjekt (= STWEG).
export type Eigentumsart = 'renditeobjekt' | 'genossenschaft' | 'verkaufsobjekt'

export const EIGENTUMSART_LABEL: Record<Eigentumsart, string> = {
  renditeobjekt:  'Renditeobjekt',
  genossenschaft: 'Genossenschaft',
  verkaufsobjekt: 'Verkaufsobjekt',
}

export function eigentumsartForBuilding(useType: ProjectUseType): Eigentumsart {
  switch (useType) {
    case 'verkaufsobjekt': return 'verkaufsobjekt'
    case 'genossenschaft': return 'genossenschaft'
    default:               return 'renditeobjekt' // renditeobjekt + gemischt
  }
}

export interface VariantBuilding {
  id: string
  variant_id: string
  etappe_id: string | null
  name: string
  art: BuildingArt
  use_type: ProjectUseType
  existing_building_id: string | null
  nutzung_haupt: string | null
  geschossflaeche_m2: number | null
  hauptnutzflaeche_m2: number | null
  volumen_m3: number | null
  faktor_hnf_gf: number | null
  geschosshoehe_m: number | null
  notizen: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// Detaillierte Mieteinheit als Kindzeile einer Mietfläche
export interface BuildingMieteinheit {
  id: string
  mietflaeche_id: string
  sort_order: number
  bezeichnung: string | null
  /** Wohnungsnummer (Freitext, z. B. „1.01") */
  wohnungsnummer: string | null
  /** Wohnungstyp (bei Wohnen aus Auswahl, sonst Freitext) */
  wohnungstyp: string | null
  zimmer: number | null
  anzahl: number
  gf_m2: number | null
  geschosshoehe_m: number | null
  volumen_m3: number | null
  faktor_vmf_gf: number | null
  flaeche_m2: number
  /** Durchschnittliche VMF pro Stück (anzahl × vmf_pro_stk = flaeche_m2) */
  vmf_pro_stk: number | null
  miete_chf_m2_pa: number | null
  miete_chf_stk_mt: number | null
  miete_chf_pa: number | null
  wohnungsmix: Wohnungsmix | null
  locked_fields: string[]
  created_at: string
  updated_at: string
}

// Eine Zeile im Mengengerüst-Raster — kann Mietfläche (Gebäude-Ebene),
// Geschoss-Aufteilung oder Einzeleinheit sein, je nachdem welche Felder
// der User füllt. Optional verschachtelte Mieteinheiten für detaillierte
// Erfassung; sobald Einheiten existieren, werden die Werte hier aggregiert.
export interface BuildingMietflaeche {
  id: string
  variant_building_id: string
  geschoss_bezeichnung: string | null
  nutzung: string
  bezeichnung: string | null
  anzahl: number | null
  zimmer: number | null
  // Maße
  gf_m2: number | null
  geschosshoehe_m: number | null
  volumen_m3: number | null
  faktor_vmf_gf: number | null    // VMF = GF × Faktor
  flaeche_m2: number              // VMF (Vermietungsfläche) — historischer Spaltenname
  /** Durchschnittliche VMF pro Stück (anzahl × vmf_pro_stk = flaeche_m2) */
  vmf_pro_stk: number | null
  /** false = oberirdisch, true = unterirdisch (Keller, Tiefgarage, Lager im UG …) */
  unterirdisch: boolean
  // Mietzins (drei Repräsentationen, im Frontend synchron gehalten)
  miete_chf_m2_pa: number | null
  miete_chf_stk_mt: number | null
  miete_chf_pa: number | null
  // Welche Felder hat der User „eingefroren" — die Recalc-Logik berührt sie nicht
  locked_fields: string[]
  // Wohnungsmix pro Zimmergrösse (nur wenn Nutzung == Wohnen)
  wohnungsmix: Wohnungsmix | null
  // Untergeordnete Detail-Mieteinheiten; nur befüllt wenn explizit angelegt
  mieteinheiten?: BuildingMieteinheit[]
  sort_order: number
  created_at: string
  updated_at: string
}

// BKP-2-Kennwert auf Variantenebene, je Etappe × Eigentumsart × Zeile.
// row_key = Nutzung (kleingeschrieben) für oberirdische Zeilen, oder
// 'unterirdisch' / 'tiefgarage' / 'etappierung'.
export interface VariantBkp2Kennwert {
  id: string
  variant_id: string
  /** null = Konsolidiert-Ebene (etappenübergreifender Default) */
  etappe_id: string | null
  eigentumsart: Eigentumsart
  row_key: string
  chf_pro_m3: number | null
  pauschal_chf: number | null
  notiz: string | null
  /** Nur Konsolidiert-Row: true = aus Etappen aggregiert; false = verteilt. */
  aggregate_from_etappen: boolean
  created_at: string
  updated_at: string
}

// Teilposition einer Pauschale (Pauschal-Kalkulator). Betrag = anzahl × ehp.
export interface PauschalPosten {
  text: string
  anzahl: number
  ehp: number
}

// Berechnungsmethode pro Zeile (überschreibt den Katalog-Default).
export type CalcMethod = 'standard' | 'pauschal' | 'einheit' | 'prozent_von' | 'promille_von' | 'honorarrechner' | 'ertrag_nutzung'

// Referenz für die %/‰-Basis: eine Position (Code), eine ganze Hauptgruppe oder
// eine Nutzungskategorie (dann `ref` = Nutzungsname, `prozent` = Anteil des
// Jahresmietertrags dieser Nutzung, Default 100). Für 710/720 „Mieterträge nach Nutzung".
export interface BaseRef {
  kind: 'position' | 'hauptgruppe' | 'nutzung'
  ref: string
  prozent?: number
}

// Eigene (benutzerdefinierte) Anlagekosten-Zeile pro Block (Hauptgruppe × Eigentumsart).
export interface VariantBkpCustomPosition {
  id: string
  variant_id: string
  eigentumsart: Eigentumsart
  hauptgruppe: number
  /** Frei wählbare Positionsnummer (für aufsteigende Sortierung). */
  code: string
  label: string
  mwst: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// Anlagekosten-Eintrag (BKP-Position) pro Variante × Etappe × Eigentumsart.
// etappe_id NULL = Konsolidiert-Ebene (etappenübergreifender Default).
export interface VariantBkpKosten {
  id: string
  variant_id: string
  etappe_id: string | null
  eigentumsart: Eigentumsart
  position_code: string
  status: Status
  kennwert: number | null
  /** Zweiter Kennwert (z.B. Finanzierungs-Anteil 0..1). */
  kennwert2: number | null
  bezugsmenge_override: number | null
  betrag_override: number | null
  mengen_einheit_override: string | null
  mwst_anwenden: boolean | null
  mwst_satz_override: number | null
  notiz: string | null
  /** Nur auf der Konsolidiert-Row (etappe_id NULL) relevant: true = Konsolidiert
   *  wird aus den Etappen aggregiert; false = Konsolidiert wird verteilt. */
  aggregate_from_etappen: boolean
  /** Aufschlüsselung einer Pauschale aus dem Rechner (Total = betrag_override). */
  pauschal_detail: PauschalPosten[] | null
  /** Gewählte Berechnungsmethode (null = Katalog-Standard). Auf Konsolidiert-Row geführt. */
  calc_method: CalcMethod | null
  /** Basis-Refs für prozent_von/promille_von. */
  calc_base: BaseRef[] | null
  created_at: string
  updated_at: string
}

// Status einer BKP-Position (mirror von bkpKatalog Status — hier ohne Import,
// damit der Typ-File frei von lib-Abhängigkeiten bleibt).
export type Status = 'beruecksichtigt' | 'nicht_beruecksichtigt' | 'nicht_relevant'

// Aufteilung der projektweiten Grundstücksfläche je Etappe × Eigentumsart.
export interface VariantEtappeGsfAlloc {
  id: string
  variant_id: string
  etappe_id: string
  eigentumsart: Eigentumsart
  mode: 'pct' | 'm2'
  value: number | null
  created_at: string
  updated_at: string
}

// Anzahl Wohnungen pro Zimmergrösse
export interface Wohnungsmix {
  joker?: number | null
  '1.5'?: number | null
  '2.0'?: number | null
  '2.5'?: number | null
  '3.0'?: number | null
  '3.5'?: number | null
  '4.0'?: number | null
  '4.5'?: number | null
  '5.0'?: number | null
  '5.5'?: number | null
  '6.0'?: number | null
  '6.5'?: number | null
  '>6.5'?: number | null
}

export const WOHNUNGSMIX_KEYS: readonly (keyof Wohnungsmix)[] = [
  'joker', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '>6.5',
] as const

export const WOHNUNGSMIX_LABEL: Record<typeof WOHNUNGSMIX_KEYS[number], string> = {
  joker:  'Joker',
  '1.5':  '1.5',
  '2.0':  '2.0',
  '2.5':  '2.5',
  '3.0':  '3.0',
  '3.5':  '3.5',
  '4.0':  '4.0',
  '4.5':  '4.5',
  '5.0':  '5.0',
  '5.5':  '5.5',
  '6.0':  '6.0',
  '6.5':  '6.5',
  '>6.5': '>6.5',
}

export function isNutzungWohnen(nutzung: string | null | undefined): boolean {
  if (!nutzung) return false
  return /wohn/i.test(nutzung)
}

/**
 * Effektive Wohnungs-Zählung einer Wohnen-Fläche: bevorzugt den erfassten
 * Zimmer-Mix (1.5, 2.5 …). Ist kein Mix erfasst, aber eine Stückzahl (anzahl),
 * werden diese als „Joker"-Wohnungen (ohne Zimmerangabe) gezählt — so wirken
 * auf Geschossebene eingegebene Stückzahlen in Wohnungsmix und Benchmarks.
 */
// Sonder-Schlüssel für Wohnungen ohne erfassten Zimmer-Mix (nur Stückzahl).
export const WOHNUNG_FALLBACK_KEY = 'wohnungen'

export function effektiveWohnungCounts(
  nutzung: string | null | undefined,
  wohnungsmix: Wohnungsmix | null | undefined,
  anzahl: number | null | undefined,
): [string, number][] {
  if (!isNutzungWohnen(nutzung)) return []
  const mix = WOHNUNGSMIX_KEYS
    .map((k) => [k as string, wohnungsmix?.[k] ?? 0] as [string, number])
    .filter(([, c]) => c > 0)
  if (mix.reduce((s, [, c]) => s + c, 0) > 0) return mix
  const anz = anzahl ?? 0
  // Kein Zimmer-Mix erfasst → reine Stückzahl als „Wohnungen" (ohne Zimmerangabe).
  return anz > 0 ? [[WOHNUNG_FALLBACK_KEY, anz]] : []
}


export interface BuildingErtragsobjekt {
  id: string
  variant_building_id: string
  bezeichnung: string
  anzahl: number
  notizen: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export const BUILDING_ART_LABEL: Record<BuildingArt, string> = {
  neubau:               'Neubau',
  sanierung:            'Sanierung',
  bestand_unveraendert: 'Bestand unverändert',
  abbruch:              'Abbruch',
}

// Default-Faktor VMF/GF (Anteil der Vermietungsfläche an der Geschossfläche)
export const DEFAULT_FAKTOR_VMF_GF = 0.82

export const NUTZUNG_VORSCHLAEGE: string[] = [
  'Wohnen',
  'Büro',
  'Gewerbe',
  'Verkauf',
  'Lager',
  'Gastronomie',
  'Parking',
  'Sonstiges',
]

// ─── Kunden ─────────────────────────────────────────────────────────────────

export type CustomerKind = 'firma' | 'genossenschaft' | 'stiftung' | 'oeffentliche_hand' | 'privat'

export interface Customer {
  id: string
  name: string
  typ: CustomerKind
  vorname: string | null
  nachname: string | null
  strasse: string | null
  hausnummer: string | null
  plz: string | null
  ort: string | null
  land: string | null
  email: string | null
  telefon: string | null
  website: string | null
  notizen: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  firma:             'Firma',
  genossenschaft:    'Genossenschaft',
  stiftung:          'Stiftung',
  oeffentliche_hand: 'Öffentliche Hand',
  privat:            'Privatperson',
}

export function customerAddressLine(c: Pick<Customer, 'strasse' | 'hausnummer' | 'plz' | 'ort' | 'land'>): string | null {
  const line1 = [c.strasse, c.hausnummer].filter(Boolean).join(' ').trim()
  const line2 = [c.plz, c.ort].filter((s) => s && s.toString().trim()).join(' ').trim()
  const parts = [line1, line2].filter(Boolean)
  if (c.land && c.land.toLowerCase() !== 'schweiz') parts.push(c.land)
  return parts.join(', ') || null
}
