-- ═══════════════════════════════════════════════════════════════════════════
-- MONITOR DE REPARTO — Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════════════════

-- Tabla para el estado EN VIVO del reparto (se actualiza por pedido)
CREATE TABLE IF NOT EXISTS public.reparto_en_curso (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha       date        NOT NULL,
  turno       text        NOT NULL,          -- 'Mañana' | 'Tarde'
  repartidor  text        DEFAULT 'En reparto',
  pedidos     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (fecha, turno)
);

-- Índice para buscar por fecha
CREATE INDEX IF NOT EXISTS idx_reparto_en_curso_fecha
  ON public.reparto_en_curso (fecha DESC);

-- Habilitar Realtime (actualizaciones en vivo al monitor)
ALTER PUBLICATION supabase_realtime ADD TABLE public.reparto_en_curso;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rendiciones_reparto;

-- RLS: Lectura pública (monitor), escritura solo con service_role (GAS)
ALTER TABLE public.reparto_en_curso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monitor_read"
  ON public.reparto_en_curso FOR SELECT
  USING (true);

CREATE POLICY "gas_write"
  ON public.reparto_en_curso FOR ALL
  USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Estructura del array "pedidos" (JSONB) en reparto_en_curso:
-- {
--   numeroCliente:    string
--   nombre:           string
--   domicilio:        string
--   localidad:        string
--   telefono:         string
--   importeTotal:     number
--   formaPago1:       string   ('Efectivo'|'Transferencia'|'Cheque'|'No pagó')
--   importe1:         number
--   formaPago2:       string
--   importe2:         number
--   devolucion:       boolean  (entregado pero cliente devolvió artículos)
--   notasDevolucion:  string
--   coordenadas:      string   ('-34.89,-58.39')
--   orden:            number
--   entregado:        boolean
--   comprobanteId:    string   (ID de Google Drive)
--   horaEntrega:      string   (ISO timestamp | null)
-- }
-- ═══════════════════════════════════════════════════════════════════════════
