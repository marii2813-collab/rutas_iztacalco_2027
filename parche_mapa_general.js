/* =====================================================================
   PARCHE: mapa general (PDF)
   - Las etiquetas de ruta quedan dentro de su polígono y NUNCA tapan
     una casilla (si hay espacio; ver nota al final).
   - Calles realzadas: apagado (CALLES.activo = false).
   Cárgalo ANTES de parche_pdf_ajuste.js (que contiene generarPDF).
   ===================================================================== */

const CALLES = { activo: false, umbral: 200, saturacion: 0.5 };

// Oscurece el fondo del mapa base y aclara la red de calles (apagado por defecto)
function realzarCalles(ctx, W, H) {
  if (!CALLES.activo) return;
  try {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const u = CALLES.umbral, rango = 255 - u, sat = CALLES.saturacion;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      if (L <= 0) continue;
      const Ln = Math.max(0, Math.min(255, (L - u) * 255 / rango));
      const f = Ln / L;
      d[i]     = Ln + (r * f - Ln) * sat;
      d[i + 1] = Ln + (g * f - Ln) * sat;
      d[i + 2] = Ln + (b * f - Ln) * sat;
    }
    ctx.putImageData(img, 0, 0);
  } catch (e) {
    console.warn('No se pudo realzar el mapa base', e);
  }
}

// Centro geométrico de un polígono (lista de [x, y])
function centroide(poly) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cr = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    A += cr;
    cx += (poly[j][0] + poly[i][0]) * cr;
    cy += (poly[j][1] + poly[i][1]) * cr;
  }
  if (Math.abs(A) < 1e-6) {
    return [
      poly.reduce((s, p) => s + p[0], 0) / poly.length,
      poly.reduce((s, p) => s + p[1], 0) / poly.length
    ];
  }
  return [cx / (3 * A), cy / (3 * A)];
}

// Máscara del polígono (coordenadas del lienzo) con tabla de sumas:
// permite saber en tiempo constante si un rectángulo cabe completo dentro
function crearMascara(rings, W, H) {
  const xs = [], ys = [];
  rings.forEach(r => r.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)) + 2);
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)) + 2);
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return null;

  const c = document.createElement('canvas');
  c.width = bw; c.height = bh;
  const cx = c.getContext('2d');
  cx.translate(-x0, -y0);
  cx.beginPath();
  rings.forEach(r => {
    r.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])));
    cx.closePath();
  });
  cx.fillStyle = '#000';
  cx.fill('evenodd');
  const datos = cx.getImageData(0, 0, bw, bh).data;

  const S = bw + 1;
  const sat = new Int32Array(S * (bh + 1));
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const dentro = datos[(y * bw + x) * 4 + 3] > 127 ? 1 : 0;
      sat[(y + 1) * S + (x + 1)] = dentro + sat[y * S + (x + 1)] + sat[(y + 1) * S + x] - sat[y * S + x];
    }
  }
  return { x0, y0, bw, bh, S, sat };
}

// Fracción del rectángulo que cae dentro del polígono (1 = cabe completo)
function fraccionDentro(m, x1, y1, x2, y2) {
  const ix1 = Math.floor(x1 - m.x0), iy1 = Math.floor(y1 - m.y0);
  const ix2 = Math.ceil(x2 - m.x0), iy2 = Math.ceil(y2 - m.y0);
  if (ix1 < 0 || iy1 < 0 || ix2 > m.bw || iy2 > m.bh) return 0;
  const S = m.S, s = m.sat;
  const suma = s[iy2 * S + ix2] - s[iy1 * S + ix2] - s[iy2 * S + ix1] + s[iy1 * S + ix1];
  return suma / ((ix2 - ix1) * (iy2 - iy1));
}

// Busca dónde colocar la etiqueta:
// - dentro del polígono (completa)
// - sin tapar ninguna casilla (regla estricta)
// - evitando otras etiquetas si se puede
// Prueba tamaños decrecientes; el primero que cumple gana.
function colocarEtiqueta(ctx, m, texto, fsBase, centro, puntos, otras, paso, k) {
  const margen = 3 * k;
  const tamaños = [1, 0.85, 0.7, 0.6];
  let menorTapado = null; // respaldo: dentro del polígono, pero tapa lo menos posible

  for (const t of tamaños) {
    const fs = fsBase * t;
    ctx.font = `bold ${fs}px Arial, sans-serif`;
    const lw = ctx.measureText(texto).width + 8 * k;
    const lh = fs * 1.7;
    let mejor = null;

    for (let y = m.y0; y < m.y0 + m.bh; y += paso) {
      for (let x = m.x0; x < m.x0 + m.bw; x += paso) {
        const frac = fraccionDentro(m,
          x - lw / 2 - margen, y - lh / 2 - margen,
          x + lw / 2 + margen, y + lh / 2 + margen);
        if (frac < 1) continue;

        const r = { x1: x - lw / 2, y1: y - lh / 2, x2: x + lw / 2, y2: y + lh / 2 };
        let tapado = 0;
        puntos.forEach(p => { tapado += areaSolape(r, p); });
        let solapeOtras = 0;
        otras.forEach(o => { solapeOtras += areaSolape(r, o); });
        const puntaje = solapeOtras * 20 + Math.hypot(x - centro[0], y - centro[1]);
        const cand = { x, y, fs, lw, lh, tapado, puntaje };

        if (tapado === 0) {
          if (!mejor || puntaje < mejor.puntaje) mejor = cand;
        } else if (!menorTapado || tapado < menorTapado.tapado ||
                   (tapado === menorTapado.tapado && puntaje < menorTapado.puntaje)) {
          menorTapado = cand;
        }
      }
    }
    if (mejor) return mejor;
  }

  if (menorTapado) return menorTapado;

  // Último recurso: en el centro, al tamaño mínimo (ruta demasiado pequeña)
  const fs = fsBase * 0.6;
  ctx.font = `bold ${fs}px Arial, sans-serif`;
  const lw = ctx.measureText(texto).width + 8 * k;
  return { x: centro[0], y: centro[1], fs, lw, lh: fs * 1.7, tapado: -1 };
}

/* Mapa GENERAL: todas las rutas, cada una con su color */
async function construirMapaGeneralPDF(W, H, k) {
  const d = datosRuta;
  const pts = [];
  d.rutas.forEach(r => {
    if (r.feat) anillos(r.feat.geometry).forEach(ring => ring.forEach(p => pts.push([p[1], p[0]])));
    r.casillas.forEach(c => pts.push([c.lat, c.lng]));
  });
  if (!pts.length) return null;

  const { canvas, ctx, px, trazar, zf, minLat, maxLat } = await lienzoBase(pts, W, H, k);
  realzarCalles(ctx, W, H);

  // Polígonos de cada ruta: relleno suave para que las calles se vean por debajo
  d.rutas.forEach(r => {
    if (!r.feat) return;
    const rings = anillos(r.feat.geometry);
    if (!rings.length) return;
    trazar(rings);
    ctx.fillStyle = colorConAlfa(r.color, 0.10);
    ctx.fill('evenodd');
    ctx.lineWidth = 2.6 * k; ctx.strokeStyle = r.color; ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // Casillas: se dibujan y se guardan como zonas que las etiquetas no pueden tapar
  const RD = 2.8 * k;
  const puntos = [];
  d.rutas.forEach(r => r.casillas.forEach(c => {
    const [x, y] = px(c.lat, c.lng);
    ctx.beginPath(); ctx.arc(x, y, RD, 0, Math.PI * 2);
    ctx.fillStyle = r.color; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    const m = RD + 3 * k; // margen para que la etiqueta no toque el borde blanco
    puntos.push({ x1: x - m, y1: y - m, x2: x + m, y2: y + m });
  }));

  // Etiquetas: dentro de su polígono y sin tapar casillas
  const otras = [];
  const fs = 8 * k;
  d.rutas.forEach(r => {
    if (!r.feat) return;
    const rings = anillos(r.feat.geometry).map(ring => ring.map(p => px(p[1], p[0])));
    if (!rings.length) return;
    const mayor = rings.reduce((m, x) => (x.length > m.length ? x : m), rings[0]);
    const mascara = crearMascara(rings, W, H);
    if (!mascara) return;

    // Solo comparamos con los elementos que caen dentro del área de esta ruta
    const cerca = lista => lista.filter(o =>
      o.x2 > mascara.x0 && o.x1 < mascara.x0 + mascara.bw &&
      o.y2 > mascara.y0 && o.y1 < mascara.y0 + mascara.bh);

    const et = colocarEtiqueta(ctx, mascara, r.nombre, fs, centroide(mayor),
      cerca(puntos), cerca(otras), Math.max(3, 2.5 * k), k);

    const x1 = et.x - et.lw / 2, y1 = et.y - et.lh / 2;
    otras.push({ x1, y1, x2: x1 + et.lw, y2: y1 + et.lh });
    rectRedondo(ctx, x1, y1, et.lw, et.lh, 2.5 * k);
    ctx.fillStyle = r.color; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.font = `bold ${et.fs}px Arial, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.nombre, et.x, et.y + 0.5 * k);
  });

  decorarMapa(ctx, W, H, k, zf, minLat, maxLat);
  return lienzoAUrl(canvas);
}

/* NOTA: generarPDF no está en este archivo; vive en parche_pdf_ajuste.js. */
