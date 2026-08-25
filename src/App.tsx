import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'

import { LoginPage }                from '@/pages/LoginPage'
import { BestaetigenPage }          from '@/pages/BestaetigenPage'
import { ProjekteListPage }         from '@/pages/ProjekteListPage'
import { ProjektDetailPage }        from '@/pages/ProjektDetailPage'
import { KundenPage }               from '@/pages/KundenPage'
import { VarianteDetailPage }       from '@/pages/VarianteDetailPage'
import { AnlagekostenPage }         from '@/pages/AnlagekostenPage'
import { ParzellenPage }            from '@/pages/ParzellenPage'
import { VariantenVergleichPage }   from '@/pages/VariantenVergleichPage'
import { EinstellungenPage }        from '@/pages/EinstellungenPage'
import { BenutzerverwaltungPage }   from '@/pages/BenutzerverwaltungPage'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/anmelden" element={<LoginPage />} />
          <Route path="/auth/bestaetigen" element={<BestaetigenPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/projekte" replace />} />
              <Route path="projekte"                                element={<ProjekteListPage />} />
              <Route path="projekte/:id"                            element={<ProjektDetailPage />} />
              <Route path="kunden"                                  element={<KundenPage />} />
              <Route path="projekte/:projektId/vergleich"           element={<VariantenVergleichPage />} />
              <Route path="projekte/:projektId/varianten/:id"       element={<VarianteDetailPage />} />
              <Route path="projekte/:projektId/varianten/:id/anlagekosten" element={<AnlagekostenPage />} />
              <Route path="projekte/:projektId/parzellen"           element={<ParzellenPage />} />
              <Route path="einstellungen"                           element={<EinstellungenPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute requireAdmin />}>
            <Route element={<AppLayout />}>
              <Route path="verwaltung/benutzer" element={<BenutzerverwaltungPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
