-- =============================================================================
-- NPIM-Businessplan: Adresse aufteilen in Strasse / Hausnummer / PLZ / Ort
-- Migration: 004_project_address_split.sql
-- =============================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS strasse    text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hausnummer text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plz        text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ort        text;

-- Best-effort Migration für bestehende address-Werte im Format
-- "Hauptstrasse 12, 8000 Zürich". Was nicht parsbar ist, landet komplett
-- in strasse — kann anschliessend manuell nachgepflegt werden.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'address'
    ) THEN
        UPDATE projects
        SET
            strasse    = btrim(regexp_replace(split_part(address, ',', 1), '\s+\d+\w*\s*$', '')),
            hausnummer = (regexp_match(split_part(address, ',', 1), '(\d+\w*)\s*$'))[1],
            plz        = (regexp_match(btrim(split_part(address, ',', 2)), '^(\d{4})'))[1],
            ort        = btrim(regexp_replace(btrim(split_part(address, ',', 2)), '^\d{4}\s*', ''))
        WHERE address IS NOT NULL
          AND position(',' in address) > 0
          AND strasse IS NULL;

        -- Nicht parsebare Adressen: alles in strasse
        UPDATE projects
        SET strasse = address
        WHERE address IS NOT NULL AND strasse IS NULL;

        ALTER TABLE projects DROP COLUMN address;
    END IF;
END $$;
