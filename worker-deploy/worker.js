// =================================================================================
// CLOUDFLARE WORKER — COPILOTO MERCADO LIMPIO + PROXY CORS PARA REPARTO ML
// =================================================================================

const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx4yKCWXEtYXrhZBakUyOo8x6dZo9nozNnXYSELy6wAdKpsoEQbg7plRVRHj3rOy6KL/exec';
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const ALLOWED_ORIGINS = [
  'https://pablosantamaria26.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
];

function getCorsHeaders(request) {
  const origin    = request.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin === '';
  return {
    'Access-Control-Allow-Origin' : isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age'      : '86400',
  };
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sbInsert(env, table, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer'       : 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase insert ${res.status}`);
}

async function sbSelect(env, table, qs) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      'apikey'       : env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase select ${res.status}`);
  return res.json();
}

async function sbUpsert(env, table, data, onConflict = '') {
  const qs  = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer'       : 'resolution=merge-duplicates',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Supabase upsert ${res.status}`);
}

// ── POST /update-entrega ──────────────────────────────────────────────────────
async function handleUpdateEntrega(request, env, corsHeaders) {
  try {
    const { fecha, turno, pedidos } = await request.json();
    if (!fecha || !turno || !Array.isArray(pedidos)) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Normalizar campos: la app usa importePagado1/confirmedAt, el monitor espera importe1/horaEntrega
    const pedidosNorm = pedidos.map(p => ({
      ...p,
      importe1:    Number(p.importePagado1 ?? p.importe1)    || 0,
      importe2:    Number(p.importePagado2 ?? p.importe2)    || 0,
      horaEntrega: p.horaEntrega || (p.entregado && p.confirmedAt ? p.confirmedAt : null),
    }));

    await sbUpsert(env, 'reparto_en_curso', {
      fecha,
      turno,
      pedidos    : pedidosNorm,
      updated_at : new Date().toISOString(),
    }, 'fecha,turno');
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ── POST /consejo-turno ───────────────────────────────────────────────────────
async function handleConsejoTurno(request, env, ctx, corsHeaders) {
  try {
    const { repartidor, turno, fecha, pedidos } = await request.json();

    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return new Response(JSON.stringify({ consejo: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fmt = n => Math.round(n).toLocaleString('es-AR');

    // ── Estadísticas globales ─────────────────────────────────────────────────
    let efectivo = 0, transferencias = 0, cheques = 0, devueltos = 0, noPagaron = 0;
    const localidadesCount = {};

    pedidos.forEach(p => {
      const p1  = Number(p.importePagado1) || 0;
      const p2  = Number(p.importePagado2) || 0;
      const fp1 = p.formaPago1 || '';
      const fp2 = p.formaPago2 || '';
      if (fp1.includes('fectivo'))  efectivo       += p1;
      if (fp2.includes('fectivo'))  efectivo       += p2;
      if (fp1.includes('ransfer'))  transferencias += p1;
      if (fp2.includes('ransfer'))  transferencias += p2;
      if (fp1.includes('heque'))    cheques        += p1;
      if (fp2.includes('heque'))    cheques        += p2;
      if (fp1 === 'No pagó')        noPagaron++;
      if (p.devolucion)             devueltos++;
      const loc = String(p.localidad || '').trim();
      if (loc) localidadesCount[loc] = (localidadesCount[loc] || 0) + 1;
    });

    // ── Detalle por cliente (en orden de reparto) ─────────────────────────────
    const pedidosOrdenados = [...pedidos].sort((a, b) => (a.orden || 0) - (b.orden || 0));

    const detalleLineas = pedidosOrdenados.map((p, i) => {
      const fp1 = p.formaPago1 || '';
      const a1  = Number(p.importePagado1) || 0;
      const a2  = Number(p.importePagado2) || 0;
      let pago;
      if (fp1 === 'No pagó') {
        pago = 'No pagó';
      } else {
        const partes = [];
        if (a1 > 0) partes.push(`$${fmt(a1)} en ${fp1}`);
        if (a2 > 0) partes.push(`$${fmt(a2)} en ${p.formaPago2}`);
        pago = partes.join(' + ') || '—';
      }
      let linea = `• #${i + 1} — ${p.nombre || 'Cliente'} (${p.localidad || 'zona desc.'}): ${pago}`;
      if (!p.entregado) linea += ' | ❌ sin entregar';
      if (p.devolucion) linea += ` | devolvió artículo: "${p.notasDevolucion || 'sin detalle'}"`;
      return linea;
    });

    // ── Tiempos entre entregas (si hay confirmedAt) ───────────────────────────
    const conTimestamp = pedidosOrdenados
      .filter(p => p.entregado && p.confirmedAt)
      .sort((a, b) => new Date(a.confirmedAt) - new Date(b.confirmedAt));

    let tiemposStr = '';
    if (conTimestamp.length >= 2) {
      const lineas = [];
      for (let i = 1; i < conTimestamp.length; i++) {
        const diff = (new Date(conTimestamp[i].confirmedAt) - new Date(conTimestamp[i - 1].confirmedAt)) / 60000;
        if (diff > 0 && diff < 120) {
          lineas.push(`  • ${conTimestamp[i - 1].nombre} → ${conTimestamp[i].nombre}: ~${Math.round(diff)} min`);
        }
      }
      if (lineas.length > 0) tiemposStr = `\nTiempos entre entregas:\n${lineas.join('\n')}`;
    }

    // ── Historial reciente para contexto ─────────────────────────────────────
    let historialCtx = '';
    try {
      const hist = await sbSelect(env, 'copiloto_historial',
        `repartidor=eq.${encodeURIComponent(repartidor)}&order=fecha.desc&limit=8` +
        `&select=fecha,turno,total_clientes,devueltos,no_pagaron,efectivo,transferencias,localidades,consejo`
      );
      if (hist.length > 0) {
        historialCtx = `\n\nHistorial reciente de ${repartidor}:\n`;
        hist.forEach(h => {
          const locs = Object.keys(h.localidades || {}).join(', ') || '—';
          historialCtx +=
            `• ${h.fecha} turno ${h.turno}: ${h.total_clientes} clientes, ` +
            `${h.devueltos} dev, ${h.no_pagaron} no pagaron — zonas: ${locs}\n`;
          if (h.consejo) historialCtx += `  → Copiloto dijo: "${h.consejo}"\n`;
        });
      }
    } catch (_) { /* historial no disponible — no crítico */ }

    // ── Prompt para Gemini ────────────────────────────────────────────────────
    const zonas = Object.entries(localidadesCount)
      .map(([l, c]) => `${l} (${c} ${c === 1 ? 'cliente' : 'clientes'})`)
      .join(', ') || 'sin datos de zona';

    const prompt =
`Sos el Copiloto Mercado Limpio, el asistente de confianza de ${repartidor}, repartidor de Mercado Limpio.
Terminó su turno ${turno} del día ${fecha || 'hoy'}.

Resumen del turno:
- Clientes: ${pedidos.length} | Zonas: ${zonas}
- Efectivo: $${fmt(efectivo)} | Transferencias: $${fmt(transferencias)} | Cheques: $${fmt(cheques)}
- No pagaron: ${noPagaron} | Devoluciones parciales (artículos que el cliente devolvió dentro de la entrega; el pedido igual se entregó): ${devueltos}

Detalle de entregas en orden de reparto:
${detalleLineas.join('\n')}
${tiemposStr}${historialCtx}

Escribí UN mensaje breve (máximo 2-3 oraciones) para ${repartidor} al cerrar su turno.
Estilo: colega experimentado que le da un tip práctico antes de irse.
Tono: informal argentino, positivo, concreto. No empieces con "¡Excelente!" ni frases genéricas.
Si hay historial, hacé una comparación específica y útil con turnos anteriores.
Podés mencionar clientes por nombre si es relevante (ej: el que no pagó, el que devolvió artículo).
Si no hay historial, dá un consejo práctico basado en los datos de hoy.
Solo el mensaje, sin firma ni encabezado.`;

    // ── Llamar a Gemini ───────────────────────────────────────────────────────
    const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        contents         : [{ parts: [{ text: prompt }] }],
        generationConfig : { maxOutputTokens: 150, temperature: 0.85 },
      }),
    });
    const gData   = await geminiRes.json();
    const consejo = gData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    // ── Guardar en Supabase en background (no bloquea la respuesta) ───────────
    ctx.waitUntil(
      sbInsert(env, 'copiloto_historial', {
        fecha          : fecha || new Date().toISOString().split('T')[0],
        turno,
        repartidor,
        total_clientes : pedidos.length,
        devueltos,
        no_pagaron     : noPagaron,
        efectivo,
        transferencias,
        cheques,
        localidades    : localidadesCount,
        pedidos_raw    : pedidos,
        consejo,
      }).catch(() => {})
    );

    return new Response(JSON.stringify({ consejo }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (_) {
    // Nunca rompemos la rendición — silencioso para el usuario
    return new Response(JSON.stringify({ consejo: null }), {
      status : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Copiloto Mercado Limpio endpoints ─────────────────────────────────────
    if (url.pathname === '/consejo-turno' && request.method === 'POST') {
      return handleConsejoTurno(request, env, ctx, corsHeaders);
    }

    if (url.pathname === '/update-entrega' && request.method === 'POST') {
      return handleUpdateEntrega(request, env, corsHeaders);
    }

    // ── Proxy GAS (todos los demás POST) ──────────────────────────────────────
    if (request.method === 'POST') {
      try {
        const body        = await request.text();
        const gasUrl      = env?.GAS_URL || GAS_WEBAPP_URL;
        const gasResponse = await fetch(gasUrl, {
          method  : 'POST',
          headers : { 'Content-Type': 'text/plain' },
          body,
          redirect: 'follow',
        });
        const responseText = await gasResponse.text();
        let responseBody;
        try   { responseBody = JSON.parse(responseText); }
        catch { responseBody = { success: false, message: 'GAS devolvió respuesta no-JSON', raw: responseText.substring(0, 200) }; }
        return new Response(JSON.stringify(responseBody), {
          status : 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, message: 'Error en proxy: ' + err.message }), {
          status : 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ service: 'Copiloto Mercado Limpio', status: 'running' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
