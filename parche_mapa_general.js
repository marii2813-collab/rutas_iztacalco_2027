/* =====================================================================
   PARCHE: PDF general en horizontal, etiquetas de ruta dentro del
   polígono y calles más visibles.

   CÓMO USARLO
   Pega este contenido al final del bloque <script> de tu HTML, justo
   antes de </script>. Como las funciones tienen el mismo nombre que
   las anteriores (generarPDF, construirMapaGeneralPDF, etc.), las
   nuevas sustituyen a las viejas. Puedes borrar las originales después.

   AJUSTES DE CALLES
   CALLES.umbral: más alto = fondo más oscuro y calles más marcadas
     (prueba entre 185 y 215).
   CALLES.saturacion: 0 = mapa en gris, 1 = color original.
   ===================================================================== */

const CALLES = { umbral: 200, saturacion: 0.5 };

// Oscurece el fondo del mapa base y aclara la red de calles para que se distingan
function realzarCalles(ctx, W, H) {
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

// Coloca la etiqueta dentro del polígono: prueba tamaños decrecientes
// y elige el lugar libre más cercano al centro, sin tapar casillas ni otras etiquetas
function colocarEtiqueta(ctx, m, texto, fsBase, centro, obstaculos, paso, k) {
  const margen = 3 * k;
  let respaldo = null;
  for (const t of [1, 0.85, 0.7, 0.6]) {
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
        if (frac < 1) {
          if (!respaldo || frac > respaldo.frac) respaldo = { frac, x, y, fs, lw, lh };
          continue;
        }
        const r = { x1: x - lw / 2, y1: y - lh / 2, x2: x + lw / 2, y2: y + lh / 2 };
        let solape = 0;
        obstaculos.forEach(o => { solape += areaSolape(r, o); });
        const puntaje = solape * 20 + Math.hypot(x - centro[0], y - centro[1]);
        if (!mejor || puntaje < mejor.puntaje) mejor = { puntaje, x, y, fs, lw, lh };
      }
    }
    if (mejor) return mejor;
  }
  return respaldo;
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

  // Relleno suave para que las calles se vean a través de cada ruta
  d.rutas.forEach(r => {
    if (!r.feat) return;
    const rings = anillos(r.feat.geometry);
    if (!rings.length) return;
    trazar(rings);
    ctx.fillStyle = colorConAlfa(r.color, 0.14);
    ctx.fill('evenodd');
    ctx.lineWidth = 2.6 * k; ctx.strokeStyle = r.color; ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // Casillas como puntos del color de su ruta
  const RD = 2.8 * k;
  const obstaculos = [];
  d.rutas.forEach(r => r.casillas.forEach(c => {
    const [x, y] = px(c.lat, c.lng);
    ctx.beginPath(); ctx.arc(x, y, RD, 0, Math.PI * 2);
    ctx.fillStyle = r.color; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    obstaculos.push({ x1: x - RD - 1, y1: y - RD - 1, x2: x + RD + 1, y2: y + RD + 1 });
  }));

  // Etiqueta de cada ruta dentro de su polígono
  const fs = 8 * k;
  d.rutas.forEach(r => {
    if (!r.feat) return;
    const rings = anillos(r.feat.geometry).map(ring => ring.map(p => px(p[1], p[0])));
    if (!rings.length) return;
    const mayor = rings.reduce((m, x) => (x.length > m.length ? x : m), rings[0]);
    const mascara = crearMascara(rings, W, H);
    if (!mascara) return;
    const et = colocarEtiqueta(ctx, mascara, r.nombre, fs, centroide(mayor),
      obstaculos, Math.max(3, 2.5 * k), k);
    if (!et) return;

    const x1 = et.x - et.lw / 2, y1 = et.y - et.lh / 2;
    obstaculos.push({ x1, y1, x2: x1 + et.lw, y2: y1 + et.lh });
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

/* =====================================================================
   PDF: ruta en vertical; general en horizontal (mapa en la página 1,
   tabla de rutas desde la página 2)
   ===================================================================== */
async function generarPDF() {
  const btn = document.getElementById('btn-pdf');
  const txt = document.getElementById('btn-pdf-txt');
  const esGeneral = selectRuta.value === GENERAL;
  btn.disabled = true;
  txt.textContent = 'Generando mapa y PDF...';
  let holder = null;
  try {
    // A4 con margen de 5 mm. Ruta: vertical (200 x 287 mm). General: horizontal (287 x 200 mm)
    const ANCHO = esGeneral ? 1040 : 760;
    const ALTO_HOJA = esGeneral
      ? ANCHO * (200 / 287) * 0.985
      : ANCHO * (287 / 200) * 0.985;

    holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${ANCHO}px;`;
    const doc = document.getElementById('pdf-area').cloneNode(true);
    doc.removeAttribute('id');
    doc.style.width = ANCHO + 'px';
    doc.classList.remove('shadow', 'rounded-xl');
    holder.appendChild(doc);
    document.body.appendChild(holder);

    await esperarImagenes(doc);
    ajustarLogos(doc);
    doc.querySelector('#pdf-fecha').textContent =
      new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

    const cont = doc.querySelector('#pdf-map-container');
    const img = doc.querySelector('#pdf-map-img');
    cont.classList.remove('hidden');
    img.style.height = '0px';

    const MIN_MAP = 300, MAX_MAP = 720;
    let altoMapa;
    if (esGeneral) {
      // Medimos sin la tabla: el mapa ocupa lo que sobra de la hoja horizontal
      const tablaEl = doc.querySelector('#pdf-tabla-general');
      tablaEl.style.display = 'none';
      const base = doc.offsetHeight;
      tablaEl.style.display = '';
      altoMapa = Math.max(MIN_MAP, Math.min(ALTO_HOJA - base - 10, 640));
    } else {
      let base = doc.offsetHeight;
      altoMapa = ALTO_HOJA - base;
      if (altoMapa < MIN_MAP) {            // muchas casillas: tabla compacta para seguir en 1 hoja
        doc.classList.add('compacto');
        base = doc.offsetHeight;
        altoMapa = ALTO_HOJA - base;
      }
      altoMapa = Math.max(MIN_MAP, Math.min(MAX_MAP, altoMapa - 4));
    }

    const anchoMapa = img.getBoundingClientRect().width;
    const K = 1.7;
    const W = Math.round(anchoMapa * K), H = Math.round(altoMapa * K);
    const url = await construirMapaPDF(W, H, K);

    if (url) {
      const cargada = new Promise(r => { img.onload = r; img.onerror = r; });
      img.src = url;
      img.style.height = altoMapa + 'px';
      await cargada;
    } else {
      cont.classList.add('hidden');
      alert('No se pudo dibujar el mapa de calles. El PDF se generará solo con la tabla.');
    }

    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 150));

    await html2pdf().set({
      margin: 5,
      filename: `Reporte_${selectDistrito.value}_${esGeneral ? 'General' : selectRuta.value.replace(/\s+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: esGeneral ? 2 : 3,          // en general la tabla es larga: escala menor para no saturar el teléfono
        useCORS: true, scrollX: 0, scrollY: 0,
        windowWidth: ANCHO + 40
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: esGeneral ? 'landscape' : 'portrait' },
      enableLinks: true,
      pagebreak: {
        mode: ['css', 'legacy'],
        before: esGeneral ? ['#pdf-tabla-general'] : [],
        avoid: ['tr', '#pdf-map-container']
      }
    }).from(doc).save();
  } finally {
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    btn.disabled = false;
    txt.textContent = textoBtnPDF;
  }
}

/* OPCIONAL: para que también la ruta individual tenga calles realzadas,
   dentro de construirMapaPDF agrega esta línea justo después de
   "const { canvas, ctx, ... } = await lienzoBase(pts, W, H, k);":

   realzarCalles(ctx, W, H);
*/
