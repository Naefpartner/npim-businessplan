import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import {
  SEITE, RAND, TITELFLAECHE, LOGO, SCHRIFT, BERICHT_FARBE, FUSSZEILE_FIRMA,
  kapitelFuer, type BerichtKapitel,
} from '@/lib/bericht'
import { mm, schriftRegistrieren, datumCh } from '@/lib/berichtPdf'

schriftRegistrieren()

/** Alles, was der Bericht über Projekt und Variante wissen muss. */
export interface BerichtDaten {
  projektName: string
  /** Adresszeile, erscheint als erste Titelzeile und in der Fusszeile. */
  adresse: string | null
  dokumentBezeichnung: string
  untertitel: string | null
  auftraggeberin: string[]
  datum: Date
  /** Öffentliche URL des Projektbilds für die Titelfläche. */
  titelbildUrl: string | null
  /** Kapitelschlüssel in Druckreihenfolge. */
  kapitel: string[]
}

const s = StyleSheet.create({
  seite: {
    fontFamily: SCHRIFT.familie,
    fontSize: SCHRIFT.grund,
    lineHeight: SCHRIFT.zeile / SCHRIFT.grund,
    color: BERICHT_FARBE.text,
  },
  // Titelblatt wird absolut bemasst, deshalb ohne Satzspiegel.
  inhaltsSeite: {
    paddingTop: mm(RAND.oben),
    paddingBottom: mm(RAND.unten),
    paddingLeft: mm(RAND.links),
    paddingRight: mm(RAND.rechts),
  },

  // ── Titelblatt ────────────────────────────────────────────────────────────
  titelFlaeche: {
    position: 'absolute',
    left: mm(TITELFLAECHE.links),
    top: mm(TITELFLAECHE.oben),
    width: mm(TITELFLAECHE.breite),
    height: mm(TITELFLAECHE.hoehe),
    backgroundColor: BERICHT_FARBE.primaer,
    overflow: 'hidden',
  },
  titelBild: { width: '100%', height: '100%', objectFit: 'cover' },
  /**
   * Die Vorlage schneidet oben links eine Ecke aus der Fläche — nachgebildet
   * durch ein weisses Rechteck über der Fläche. Dort sitzt die Wortmarke.
   */
  ausschnitt: {
    position: 'absolute',
    left: mm(TITELFLAECHE.links),
    top: mm(TITELFLAECHE.oben),
    width: mm(TITELFLAECHE.ausschnittBreite),
    height: mm(TITELFLAECHE.ausschnittHoehe),
    backgroundColor: '#FFFFFF',
  },
  wortmarke: {
    position: 'absolute',
    left: mm(LOGO.titel.links),
    top: mm(LOGO.titel.oben),
    width: mm(LOGO.titel.breite),
    height: mm(LOGO.titel.hoehe),
  },
  titelText: {
    position: 'absolute',
    left: mm(TITELFLAECHE.links),
    top: mm(130.4),
    width: mm(102),
  },
  titelZeile: {
    fontSize: SCHRIFT.titel,
    lineHeight: SCHRIFT.titelZeile / SCHRIFT.titel,
    fontWeight: 700,
    color: '#FFFFFF',
  },
  angabenBlock: {
    position: 'absolute',
    left: mm(RAND.links),
    top: mm(180),
    width: mm(SEITE.a4.breite - RAND.links - RAND.rechts),
    flexDirection: 'row',
    gap: mm(10),
  },
  angabenSpalte: { width: mm(55) },
  angabenTitel: { fontWeight: 700, marginBottom: mm(1) },

  // ── Kopf und Fuss der Folgeseiten ─────────────────────────────────────────
  bildmarke: {
    position: 'absolute',
    right: mm(LOGO.folge.rechts),
    top: mm(LOGO.folge.oben),
    width: mm(LOGO.folge.breite),
    height: mm(LOGO.folge.hoehe),
  },
  fuss: {
    position: 'absolute',
    left: mm(RAND.links),
    right: mm(RAND.rechts),
    bottom: mm(RAND.fuss),
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: SCHRIFT.klein,
    lineHeight: SCHRIFT.kleinZeile / SCHRIFT.klein,
    color: BERICHT_FARBE.text,
  },

  // ── Inhaltsverzeichnis ────────────────────────────────────────────────────
  h1: {
    fontSize: SCHRIFT.h1,
    lineHeight: SCHRIFT.h1Zeile / SCHRIFT.h1,
    fontWeight: 700,
    marginBottom: mm(6.7),   // 380 Twips
  },
  tocZeile: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: mm(3.5),      // 200 Twips
    fontWeight: 700,
  },
  tocPunkte: {
    flexGrow: 1,
    borderBottomWidth: 0.5,
    borderBottomColor: '#C8C8C8',
    borderBottomStyle: 'dotted',
    marginHorizontal: mm(2),
    marginBottom: mm(1),
  },
})

/**
 * Fusszeile der Inhaltsseiten — Firma, Objekt, Dokument und Seitenzahl.
 * Das Titelblatt ist eine eigene Seite ohne diese Elemente, deshalb genügt es,
 * sie nur in den Inhaltsseiten zu setzen; eine Seitenprüfung braucht es nicht.
 */
function Fusszeile({ daten }: { daten: BerichtDaten }) {
  const links = [FUSSZEILE_FIRMA, daten.adresse, daten.dokumentBezeichnung]
    .filter(Boolean).join('  |  ')
  return (
    <View style={s.fuss} fixed>
      <Text>{links}</Text>
      {/* Nur Text bekommt totalPages im render-Callback, nicht View. */}
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

/** Bildmarke oben rechts auf den Inhaltsseiten. */
function Kopfmarke() {
  return (
    <View style={s.bildmarke} fixed>
      <Image src="/naef-bildmarke.png" />
    </View>
  )
}

/**
 * Titelblatt nach Naef-Vorlage: farbige Fläche mit dem Projektbild, oben links
 * die Ecke für die Wortmarke ausgespart, darunter Titel und Angaben.
 */
function Titelblatt({ daten }: { daten: BerichtDaten }) {
  return (
    <Page size="A4" style={[s.seite]}>
      <View style={s.titelFlaeche}>
        {daten.titelbildUrl && <Image src={daten.titelbildUrl} style={s.titelBild} />}
      </View>
      <View style={s.ausschnitt} />
      <Image src="/naef-wortmarke.jpg" style={s.wortmarke} />

      <View style={s.titelText}>
        {daten.adresse && <Text style={s.titelZeile}>{daten.adresse}</Text>}
        <Text style={s.titelZeile}>{daten.dokumentBezeichnung}</Text>
        {daten.untertitel && <Text style={s.titelZeile}>{daten.untertitel}</Text>}
      </View>

      <View style={s.angabenBlock}>
        <View style={s.angabenSpalte}>
          <Text style={s.angabenTitel}>Auftraggeberin</Text>
          {daten.auftraggeberin.map((z, i) => <Text key={i}>{z}</Text>)}
        </View>
        <View style={s.angabenSpalte}>
          <Text style={s.angabenTitel}>Beauftragte</Text>
          <Text>Naef & Partner Immobilien AG</Text>
          <Text>Bleicherweg 10</Text>
          <Text>8002 Zürich</Text>
        </View>
        <View style={s.angabenSpalte}>
          <Text style={s.angabenTitel}>Datum</Text>
          <Text>{datumCh(daten.datum)}</Text>
        </View>
      </View>
    </Page>
  )
}

/**
 * Inhaltsverzeichnis. Die Seitenzahlen bleiben vorerst offen — sie stehen erst
 * fest, wenn die Kapitelinhalte gesetzt sind, und werden dann über die
 * Bookmark-/Zielseiten von @react-pdf nachgezogen.
 */
function Inhaltsverzeichnis({ kapitel, daten }: { kapitel: BerichtKapitel[]; daten: BerichtDaten }) {
  return (
    <Page size="A4" style={[s.seite, s.inhaltsSeite]}>
      <Kopfmarke />
      <Text style={s.h1}>Inhaltsverzeichnis</Text>
      {kapitel.map((k, i) => (
        <View key={k.key} style={s.tocZeile}>
          <Text>{i + 1}   {k.label}</Text>
          <View style={s.tocPunkte} />
          <Text>—</Text>
        </View>
      ))}
      <Fusszeile daten={daten} />
    </Page>
  )
}

/**
 * Der Businessplan-Bericht als PDF-Dokument.
 *
 * Stand: Titelblatt und Inhaltsverzeichnis. Die Fachkapitel folgen einzeln —
 * ihre Schlüssel stehen bereits in `daten.kapitel` und im Inhaltsverzeichnis.
 */
export function BerichtDokument({ daten }: { daten: BerichtDaten }) {
  // Titelblatt und Inhaltsverzeichnis stehen im Verzeichnis selbst nicht.
  const fachkapitel = kapitelFuer(daten.kapitel).filter((k) => !k.fix)

  return (
    <Document
      title={`${daten.projektName} — ${daten.dokumentBezeichnung}`}
      author={FUSSZEILE_FIRMA}
    >
      <Titelblatt daten={daten} />
      <Inhaltsverzeichnis kapitel={fachkapitel} daten={daten} />
    </Document>
  )
}
