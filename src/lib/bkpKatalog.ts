// Katalog aller Anlagekosten-Positionen nach Naef-Schema (BKP-H-orientiert).
// Hauptgruppe 2 ist in den variant_buildings als BKP-2-Kennwerte separat
// erfasst (siehe bkp2.ts); hier sind die übrigen Hauptgruppen 0, 1, 3-9.

import type { BaseRef, CalcMethod, Eigentumsart } from '@/types'

export type BkpHauptgruppe = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface BkpHauptgruppeMeta {
  code: BkpHauptgruppe
  label: string
}

export const HAUPTGRUPPEN: BkpHauptgruppeMeta[] = [
  { code: 0, label: 'Grundstück' },
  { code: 1, label: 'Vorbereitungsarbeiten' },
  { code: 2, label: 'Gebäude' },
  { code: 3, label: 'Betriebseinrichtungen' },
  { code: 4, label: 'Umgebung' },
  { code: 5, label: 'Baunebenkosten' },
  { code: 6, label: 'Honorare' },
  { code: 7, label: 'Vermarktung' },
  { code: 8, label: 'Entwicklung' },
  { code: 9, label: 'Eigentümer / Investor' },
]

/**
 * Berechnungstyp einer Position. Der Eingabewert (`kennwert`) bekommt je nach
 * Typ eine andere Bedeutung — siehe Kommentare.
 */
export type BerechnungsTyp =
  /** Direkte CHF-Eingabe (z.B. „150'000 für Altlastensanierung") */
  | { kind: 'pauschal' }
  /** kennwert = CHF/m² Grundstücksfläche; Menge aus den Parzellen */
  | { kind: 'chf_pro_m2_gsf' }
  /** kennwert = CHF/m² VMF (gesamt über alle Gebäude/Mietflächen) */
  | { kind: 'chf_pro_m2_vmf' }
  /** kennwert = CHF/m² Umgebungsfläche (Grundstücksfläche minus Gebäude-Grundfläche) */
  | { kind: 'chf_pro_m2_uf' }
  /** kennwert = CHF/m³ Abbruch; Menge wird vom User in `bezugsmenge_override` erfasst */
  | { kind: 'chf_pro_m3_abbruch' }
  /** kennwert = Prozentsatz (0..1) vom Total der genannten Hauptgruppen */
  | { kind: 'prozent_von_hauptgruppen'; gruppen: BkpHauptgruppe[]; exklRueckstellung?: boolean }
  /**
   * kennwert = jährlicher Zinssatz (0..1); zusätzlich `bezugsmenge_override`
   * als Laufzeit in Monaten. Bezugsgröße sind die genannten Hauptgruppen.
   */
  | { kind: 'finanzierung'; gruppen: BkpHauptgruppe[]; refs?: BaseRef[] }
  /** kennwert = % vom Verkaufserlös (für 730/740) — vereinfacht als Pauschal-Override */
  | { kind: 'von_ertrag_vereinfacht' }
  /**
   * Erstvermietung 710/720: Betrag = Σ (Jahresmietertrag der gewählten Nutzung ×
   * deren %). Kein Kennwert — die Nutzungs-% (in `refs[].prozent`) sind der ganze
   * Faktor. Ertrag stammt aus der Eigentumsart der Zeile.
   */
  | { kind: 'prozent_von_ertrag'; refs: BaseRef[] }
  /** kennwert = % vom CHF-Mehrwertbetrag, der in `bezugsmenge_override` erfasst wird */
  | { kind: 'auf_mehrwert' }
  /**
   * Freie Eingabe: kennwert = EH-Preis (CHF), bezugsmenge_override = Menge,
   * mengen_einheit_override = Einheit (frei vom User eintragbar, z.B. 'Stk').
   * Betrag = Menge × EH-Preis.
   */
  | { kind: 'manuell_menge_einheit' }
  /** kennwert = Prozentsatz (0..1) der Summe gewählter Positionen/Hauptgruppen */
  | { kind: 'prozent_von_refs'; refs: BaseRef[] }
  /** kennwert = Promille (‰) der Summe gewählter Positionen/Hauptgruppen */
  | { kind: 'promille_von_refs'; refs: BaseRef[] }
  /** BKP 2: kennwert = CHF/m³; Menge = aggregiertes Volumen (m³) der Zeile aus dem Mengengerüst */
  | { kind: 'chf_pro_m3_bkp2'; rowKey: string }

export type Status = 'beruecksichtigt' | 'nicht_beruecksichtigt' | 'nicht_relevant'

export interface BkpPosition {
  /** Eindeutiger Code (Storage-Key), z.B. '010' oder bei eigenen Zeilen die UUID */
  code: string
  /** Anzeige-/Sortier-Nummer (eigene Zeilen); fehlt → code wird genutzt */
  displayCode?: string
  /** Zur Hauptgruppe */
  hauptgruppe: BkpHauptgruppe
  /** Bezeichnung in der UI */
  label: string
  /** Berechnungs-Typ inkl. Bezugsangaben */
  typ: BerechnungsTyp
  /** Default-Status — Excel-Vorlage */
  defaultStatus: Status
  /** Default-Kennwert aus Excel-Vorlage (optional als Vorschlag) */
  defaultKennwert?: number
  /** Default-Modus für die UI — 'pauschal' zeigt initial den Pauschal-Eingabemodus. */
  defaultMode?: 'pauschal' | 'berechnet'
  /** Soll mit MwSt berechnet werden — informativ in der UI */
  mwst: boolean
  /** Optionale Zusatz-Notiz, in der UI als Tooltip / Subtext */
  hinweis?: string
  /**
   * Eigentumsarten, für die die Position gilt. Ohne Angabe für alle — mit
   * Angabe erscheint sie nur dort, etwa die Verkaufs- und Beurkundungskosten,
   * die nur beim Stockwerkeigentum anfallen.
   */
  nurFuer?: Eigentumsart[]
}

export const BKP_POSITIONEN: BkpPosition[] = [
  // ─── 0 Grundstück ──────────────────────────────────────────────────────
  { code: '010', hauptgruppe: 0, label: 'Grundstückerwerb',
    typ: { kind: 'chf_pro_m2_gsf' }, defaultStatus: 'beruecksichtigt', mwst: false },
  { code: '020', hauptgruppe: 0, label: 'Vorstudien Grundstückserwerb',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true },
  { code: '021', hauptgruppe: 0, label: 'Treuhänder, Anwaltskosten (Darlehensverträge etc.)',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '030', hauptgruppe: 0, label: 'Vermessung, Vermarchung',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true },
  { code: '040', hauptgruppe: 0, label: 'Planungsverfahren (QP, GP, SBV, SNV, UVP)',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true },
  { code: '050', hauptgruppe: 0, label: 'Altlastensanierung Grundstück',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true },
  { code: '060', hauptgruppe: 0, label: 'Sicherungskosten, Handänderung, Grundbuch, Notar',
    typ: { kind: 'promille_von_refs', refs: [{ kind: 'position', ref: '010' }] }, defaultStatus: 'beruecksichtigt', mwst: false,
    hinweis: 'Kennwert = ‰ der Grundstückskosten (Pos. 010). Alternativ als Pauschale erfassbar.' },
  // Beurkundung und Grundbuch, getrennt nach Ankauf und Verkauf — beim
  // Stockwerkeigentum fallen sie zweimal an und werden einzeln erfasst.
  { code: '061', hauptgruppe: 0, label: 'Notariatsgebühren Kaufvertrag Ankauf',
    typ: { kind: 'promille_von_refs', refs: [{ kind: 'position', ref: '010' }] },
    defaultStatus: 'beruecksichtigt', mwst: true, nurFuer: ['verkaufsobjekt'],
    hinweis: 'Kennwert = ‰ der Grundstückskosten (Pos. 010).' },
  { code: '062', hauptgruppe: 0, label: 'Grundbuchgebühren Kaufvertrag Ankauf',
    typ: { kind: 'promille_von_refs', refs: [{ kind: 'position', ref: '010' }] },
    defaultStatus: 'beruecksichtigt', mwst: false, nurFuer: ['verkaufsobjekt'],
    hinweis: 'Kennwert = ‰ der Grundstückskosten (Pos. 010).' },
  { code: '063', hauptgruppe: 0, label: 'Notariatsgebühren Schuldbrieferrichtung Ankauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '064', hauptgruppe: 0, label: 'Grundbuchgebühren Schuldbrieferrichtung Ankauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: false, nurFuer: ['verkaufsobjekt'] },
  { code: '065', hauptgruppe: 0, label: 'Notariatsgebühren Kaufvertrag STWEG, Verkauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '066', hauptgruppe: 0, label: 'Grundbuchgebühren Kaufvertrag STWEG, Verkauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: false, nurFuer: ['verkaufsobjekt'] },
  { code: '067', hauptgruppe: 0, label: 'Feststellungsbeschluss Bezirksrat (BewG)',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: false, nurFuer: ['verkaufsobjekt'] },
  { code: '070', hauptgruppe: 0, label: 'Vermittlungsprovisionen',
    typ: { kind: 'prozent_von_refs', refs: [{ kind: 'position', ref: '010' }] }, defaultStatus: 'beruecksichtigt', mwst: true,
    hinweis: 'Kennwert = % der Grundstückskosten (Pos. 010). Alternativ als Pauschale erfassbar.' },
  { code: '071', hauptgruppe: 0, label: 'Leistungen Eigentümervertretung Ankauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '072', hauptgruppe: 0, label: 'Leistungen Eigentümervertretung MBS',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '073', hauptgruppe: 0, label: 'Vermittlungsprovision Verkauf',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '074', hauptgruppe: 0, label: 'Stockwerkeigentumsbegründung',
    typ: { kind: 'manuell_menge_einheit' }, defaultStatus: 'beruecksichtigt',
    defaultMode: 'pauschal', mwst: false, nurFuer: ['verkaufsobjekt'] },
  { code: '080', hauptgruppe: 0, label: 'Abfindungen, Servitute, Beiträge',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', mwst: false },
  { code: '090', hauptgruppe: 0, label: 'Erschliessungskosten Leitungen / Verkehrsanlagen extern',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '099', hauptgruppe: 0, label: 'Mehrwertausgleich',
    typ: { kind: 'auf_mehrwert' }, defaultStatus: 'beruecksichtigt', mwst: false,
    hinweis: 'Kennwert = % vom CHF-Mehrwertbetrag. Mehrwert wird im Bezugsmenge-Feld eingegeben.' },

  // ─── 1 Vorbereitungsarbeiten ───────────────────────────────────────────
  { code: '110', hauptgruppe: 1, label: 'Bestandsaufnahmen',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 10000, mwst: true },
  { code: '120', hauptgruppe: 1, label: 'Baugrunduntersuchung, Sondierungen',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 60000, mwst: true },
  { code: '130', hauptgruppe: 1, label: 'Abbruch, Räumung, Terrainvorbereitung',
    typ: { kind: 'chf_pro_m3_abbruch' }, defaultStatus: 'beruecksichtigt', mwst: true,
    hinweis: 'Kennwert = CHF/m³. m³ Abbruch im Bezugsmenge-Feld erfassen.' },
  { code: '140', hauptgruppe: 1, label: 'Zusätzliche Entsorgungskosten (Schadstoffe)',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 150000, mwst: true },
  { code: '150', hauptgruppe: 1, label: 'Spezielle Fundationen, Baugrubensicherung, Grundwasserhaltung',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 300000, mwst: true },
  { code: '160', hauptgruppe: 1, label: 'Sonstige Vorbereitungsarbeiten',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [2] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.04, mwst: true },

  // ─── 3 Betriebseinrichtungen ───────────────────────────────────────────
  { code: '300', hauptgruppe: 3, label: 'Erweiterter Grundausbau / Edelrohbau',
    typ: { kind: 'chf_pro_m2_vmf' }, defaultStatus: 'beruecksichtigt', mwst: true },

  // ─── 4 Umgebung ────────────────────────────────────────────────────────
  { code: '400', hauptgruppe: 4, label: 'Umgebungsarbeiten',
    typ: { kind: 'chf_pro_m2_uf' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 150, mwst: true },

  // ─── 5 Baunebenkosten (ohne Finanzierung) ──────────────────────────────
  { code: '550', hauptgruppe: 5, label: 'Sonstige Baunebenkosten und Gebühren',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.05, mwst: true },
  { code: '560', hauptgruppe: 5, label: 'Rückstellungen, Garantien bis und mit SIA-Phase 41',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.0252, mwst: true },
  { code: '570', hauptgruppe: 5, label: 'Rückstellungen, Garantien ab SIA-Phase 51',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', mwst: true },

  // ─── 6 Honorare ────────────────────────────────────────────────────────
  { code: '690a', hauptgruppe: 6, label: 'Planer und Spezialisten bis und mit SIA-Phase 41',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.11, mwst: true },
  { code: '690b', hauptgruppe: 6, label: 'Planer und Spezialisten ab SIA-Phase 51',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.12, mwst: true },
  { code: '699.1', hauptgruppe: 6, label: 'Nachhaltigkeitsplaner',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '699.2', hauptgruppe: 6, label: 'Diverse Spezialisten (Lärm, usw.)',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '650', hauptgruppe: 6, label: 'TU-Honorar',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '660', hauptgruppe: 6, label: 'TU-Risiko',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4] }, defaultStatus: 'beruecksichtigt', mwst: true },

  // ─── 7 Vermarktung ─────────────────────────────────────────────────────
  { code: '710', hauptgruppe: 7, label: 'Erstvermietung Wohnen',
    typ: { kind: 'von_ertrag_vereinfacht' }, defaultStatus: 'beruecksichtigt', mwst: true,
    hinweis: 'Vereinfacht: Pauschalbetrag im Bezugsmenge-Feld erfassen.' },
  { code: '720', hauptgruppe: 7, label: 'Erstvermietung Gewerbe',
    typ: { kind: 'von_ertrag_vereinfacht' }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '730', hauptgruppe: 7, label: 'Verkauf Wohnen',
    typ: { kind: 'von_ertrag_vereinfacht' }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '740', hauptgruppe: 7, label: 'Verkauf Gewerbe',
    typ: { kind: 'von_ertrag_vereinfacht' }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '750', hauptgruppe: 7, label: 'Drittkosten Vermarktung',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 20000, mwst: true },
  { code: '760', hauptgruppe: 7, label: 'Analysen, Marktdaten, Produktdefinition, Beratung',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 30000, mwst: true },

  // ─── 8 Entwicklung ─────────────────────────────────────────────────────
  { code: '801', hauptgruppe: 8, label: 'Studienauftrag, Wettbewerb',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 100000, mwst: true },
  { code: '802', hauptgruppe: 8, label: 'Betriebsvorbereitung, Kommunikation',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 40000, mwst: true },
  { code: '803', hauptgruppe: 8, label: 'Nachbar- und Mieterentschädigungen, Mietzinsausfall',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '804', hauptgruppe: 8, label: 'Gutachten, Anwalts- / Gerichtskosten',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 30000, mwst: true },
  { code: '810a', hauptgruppe: 8, label: 'Projektleitung Entwicklung bis und mit SIA-Phase 41',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '810b', hauptgruppe: 8, label: 'Projektleitung Entwicklung ab SIA-Phase 51',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '820', hauptgruppe: 8, label: 'Projektleitung Realisierung bis und mit SIA-Phase 41',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7], exklRueckstellung: true }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.00176, mwst: true },
  { code: '830', hauptgruppe: 8, label: 'Projektleitung Realisierung ab SIA-Phase 51',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7], exklRueckstellung: true },
    defaultStatus: 'beruecksichtigt', mwst: true, nurFuer: ['verkaufsobjekt'] },
  { code: '840', hauptgruppe: 8, label: 'Begleitung Qualitätssicherung',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '850', hauptgruppe: 8, label: 'Zertifizierungskosten',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7], exklRueckstellung: true }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '860', hauptgruppe: 8, label: 'Reserve Diverse Berater (QS-Spezialist usw.)',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7] }, defaultStatus: 'beruecksichtigt', mwst: true },
  { code: '870', hauptgruppe: 8, label: 'Partizipation / Soziale Nachhaltigkeit',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 20000, mwst: true },
  { code: '880', hauptgruppe: 8, label: 'Nebenkosten (Plankopien usw.)',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.01, mwst: true },

  // ─── 9 Eigentümer / Investor ────────────────────────────────────────────
  { code: '910', hauptgruppe: 9, label: 'Eigenleistungen Entwicklung',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7, 8] }, defaultStatus: 'beruecksichtigt', mwst: false },
  { code: '920', hauptgruppe: 9, label: 'Eigenleistungen Realisierung',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [1, 2, 3, 4, 5, 6, 7, 8] }, defaultStatus: 'beruecksichtigt', mwst: false },
  { code: '930', hauptgruppe: 9, label: 'Versicherungen (direkt durch Eigentümer / Investor)',
    typ: { kind: 'pauschal' }, defaultStatus: 'beruecksichtigt', defaultKennwert: 50000, mwst: false },
  { code: '940', hauptgruppe: 9, label: 'Finanzierung Grundstück ab Landanbindung',
    // Basis-Default: Grundstückskosten (Pos. 010) — frei wählbar.
    typ: { kind: 'finanzierung', gruppen: [0], refs: [{ kind: 'position', ref: '010' }] },
    defaultStatus: 'beruecksichtigt', defaultKennwert: 0.015, mwst: false,
    hinweis: 'Kennwert = Zinssatz p.a. (z.B. 0.015 = 1.5%). Laufzeit in Monaten im Bezugsmenge-Feld.' },
  // Das Grundstück wird beim Stockwerkeigentum in Tranchen finanziert und
  // stückweise wieder abgelöst — deshalb zwei Zeilen mit eigener Laufzeit.
  { code: '941', hauptgruppe: 9, label: 'Finanzierung Grundstück ab Landanbindung, Tranche 1',
    typ: { kind: 'finanzierung', gruppen: [0], refs: [{ kind: 'position', ref: '010' }] },
    defaultStatus: 'beruecksichtigt', mwst: false, nurFuer: ['verkaufsobjekt'],
    hinweis: 'Kennwert = Zinssatz p.a., Laufzeit in Monaten im Bezugsmenge-Feld.' },
  { code: '942', hauptgruppe: 9, label: 'Finanzierung Grundstück ab Landanbindung, Tranche 2',
    typ: { kind: 'finanzierung', gruppen: [0], refs: [{ kind: 'position', ref: '010' }] },
    defaultStatus: 'beruecksichtigt', mwst: false, nurFuer: ['verkaufsobjekt'],
    hinweis: 'Kennwert = Zinssatz p.a., Laufzeit in Monaten im Bezugsmenge-Feld.' },
  { code: '950', hauptgruppe: 9, label: 'Finanzierung Erstellung bis und mit SIA-Phase 41',
    typ: { kind: 'finanzierung', gruppen: [5, 6, 7, 8] }, defaultStatus: 'beruecksichtigt', mwst: false },
  { code: '960', hauptgruppe: 9, label: 'Finanzierung Erstellung ab SIA-Phase 51',
    typ: { kind: 'finanzierung', gruppen: [1, 2, 3, 4, 5, 6, 7, 8] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.015, mwst: false },
  { code: '970', hauptgruppe: 9, label: 'Reserve',
    typ: { kind: 'prozent_von_hauptgruppen', gruppen: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, defaultStatus: 'beruecksichtigt', defaultKennwert: 0.05, mwst: true },
]

export function positionsInGroup(hg: BkpHauptgruppe): BkpPosition[] {
  return BKP_POSITIONEN.filter((p) => p.hauptgruppe === hg)
}

/**
 * Liefert die Einheiten-Labels für die UI-Anzeige je nach Berechnungs-Typ.
 *   - mengeEinheit: Einheit der Bezugsmenge (z.B. 'm²', 'm³', 'Mt', 'CHF')
 *   - preisEinheit: Einheit des Einheitspreises (z.B. 'CHF/m²', '%')
 */
export function einheitenFuerTyp(typ: BerechnungsTyp): { mengeEinheit: string; preisEinheit: string } {
  switch (typ.kind) {
    case 'pauschal':                return { mengeEinheit: '',          preisEinheit: 'CHF' }
    case 'chf_pro_m2_gsf':          return { mengeEinheit: 'm² GSF',    preisEinheit: 'CHF/m²' }
    case 'chf_pro_m2_vmf':          return { mengeEinheit: 'm² VMF',    preisEinheit: 'CHF/m²' }
    case 'chf_pro_m2_uf':           return { mengeEinheit: 'm² UF',     preisEinheit: 'CHF/m²' }
    case 'chf_pro_m3_abbruch':      return { mengeEinheit: 'm³',        preisEinheit: 'CHF/m³' }
    case 'prozent_von_hauptgruppen':return { mengeEinheit: 'CHF',       preisEinheit: '%' }
    case 'finanzierung':            return { mengeEinheit: 'Mt',        preisEinheit: '%/a' }
    case 'von_ertrag_vereinfacht':  return { mengeEinheit: '',          preisEinheit: 'CHF' }
    case 'auf_mehrwert':            return { mengeEinheit: 'CHF Mehrw.', preisEinheit: '%' }
    case 'manuell_menge_einheit':   return { mengeEinheit: '',          preisEinheit: 'CHF/Einh.' }
    case 'prozent_von_refs':        return { mengeEinheit: 'CHF',       preisEinheit: '%' }
    case 'promille_von_refs':       return { mengeEinheit: 'CHF',       preisEinheit: '‰' }
    case 'prozent_von_ertrag':      return { mengeEinheit: 'CHF',       preisEinheit: '%' }
    case 'chf_pro_m3_bkp2':         return { mengeEinheit: 'm³',        preisEinheit: 'CHF/m³' }
  }
}

/** Mappt die gewählte Methode auf einen BerechnungsTyp (Standard = Katalog). */
export function resolveTyp(
  catalogTyp: BerechnungsTyp,
  method: CalcMethod | null | undefined,
  base: BaseRef[] | null | undefined,
): BerechnungsTyp {
  // Finanzierung: Basis über calc_base (BasisPicker) wählbar; sonst Katalog-Default
  // (gruppen bzw. fix gesetzte refs, z.B. Pos. 010 bei 940).
  if (catalogTyp.kind === 'finanzierung') {
    return base && base.length > 0 ? { ...catalogTyp, refs: base } : catalogTyp
  }
  switch (method) {
    case 'pauschal':     return { kind: 'pauschal' }
    case 'einheit':      return { kind: 'manuell_menge_einheit' }
    case 'prozent_von':  return { kind: 'prozent_von_refs', refs: base ?? [] }
    case 'promille_von': return { kind: 'promille_von_refs', refs: base ?? [] }
    case 'ertrag_nutzung': return { kind: 'prozent_von_ertrag', refs: base ?? [] }
    // Eigene Finanzierungszeile: die Bezugsgrösse steht ganz in der Basis —
    // anders als bei den Katalogpositionen, die eine Hauptgruppe vorgeben.
    case 'finanzierung':   return { kind: 'finanzierung', gruppen: [], refs: base ?? [] }
    default:             return catalogTyp
  }
}
