// ═══════════════════════════════════════════════════════════════════════════
// MONITOR EN TIEMPO REAL — Snippet para CodigoGS
//
// PASO 1: Copiar la función actualizarRepartoEnCurso_() al final del bloque
//         "SUPABASE — GUARDAR RENDICIÓN" en CodigoGS
//
// PASO 2: En guardarDatosReparto(), AGREGAR esta línea al final,
//         justo después de SpreadsheetApp.flush():
//
//         actualizarRepartoEnCurso_(hoja, datosParaEscribir);
//
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actualiza la tabla reparto_en_curso en Supabase con el estado actual
 * de todos los pedidos. Se llama tras cada guardado del repartidor.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hoja  Hoja RepartoDelDia
 * @param {Array[]} filas  Datos actualizados (18 columnas, filas desde A3)
 */
function actualizarRepartoEnCurso_(hoja, filas) {
  try {
    var SB_URL = 'https://gjeyvbidomxzofcdycya.supabase.co';
    var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqZXl2Ymlkb214em9mY2R5Y3lhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzIyNzkzMCwiZXhwIjoyMDg4ODAzOTMwfQ.PDN9bfQxnD-COifvPFAbw_1ecAi57hxEFQ2aZDfDqZQ';

    var fecha = String(hoja.getRange('H1').getValue() || '').trim();
    var turno = String(hoja.getRange('I1').getValue() || '').trim();
    if (!fecha || !turno) return;

    var pedidos = filas
      .filter(function(f) { return String(f[0] || '').trim() !== ''; })
      .map(function(f) {
        return {
          numeroCliente:   String(f[0]  || ''),
          nombre:          String(f[1]  || ''),
          domicilio:       String(f[2]  || ''),
          localidad:       String(f[3]  || ''),
          telefono:        String(f[4]  || ''),
          importeTotal:    parseFloat(f[5]  || 0) || 0,
          formaPago1:      String(f[6]  || ''),
          importe1:        parseFloat(f[7]  || 0) || 0,
          formaPago2:      String(f[8]  || ''),
          importe2:        parseFloat(f[9]  || 0) || 0,
          devolucion:      f[10] === true || String(f[10] || '').toLowerCase() === 'true',
          notasDevolucion: String(f[11] || ''),
          coordenadas:     String(f[12] || ''),
          orden:           parseInt(f[14] || 0) || 0,
          entregado:       f[15] === true || String(f[15] || '').toLowerCase() === 'true',
          comprobanteId:   String(f[16] || ''),
          horaEntrega:     (f[17] instanceof Date && !isNaN(f[17]))
                             ? f[17].toISOString()
                             : null
        };
      });

    var resp = UrlFetchApp.fetch(SB_URL + '/rest/v1/reparto_en_curso', {
      method:          'POST',
      contentType:     'application/json',
      headers: {
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Prefer':        'resolution=merge-duplicates'
      },
      payload: JSON.stringify({
        fecha:      fecha,
        turno:      turno,
        pedidos:    pedidos,
        updated_at: new Date().toISOString()
      }),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code === 200 || code === 201) {
      Logger.log('✅ reparto_en_curso → Supabase OK (' + pedidos.length + ' pedidos, turno ' + turno + ')');
    } else {
      Logger.log('⚠️ reparto_en_curso → HTTP ' + code + ': ' + resp.getContentText().slice(0, 200));
    }
  } catch (e) {
    // No interrumpir el flujo principal si falla
    Logger.log('⚠️ actualizarRepartoEnCurso_ error: ' + e.message);
  }
}
