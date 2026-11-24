-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Retención de documentos de identidad
-- Marca cuándo se borraron las fotos (ID + selfie) de una postulación por la política de 90 días
-- (api/_lib/doc-retention.js, ejecutado por /api/dispatch). La fila y su historial se conservan.
-- Solo AGREGA una columna: no cambia triggers ni políticas RLS.
-- =====================================================================
alter table public.walker_applications add column if not exists docs_deleted_at timestamptz;
