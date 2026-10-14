/* =====================================================================
   PARCHE 2: el contenido del PDF cabe completo en la hoja.
   Cárgalo DESPUÉS de parche_mapa_general.js (sustituye generarPDF).

   Qué hace:
   - Los estilos de ajuste solo se aplican a la copia del PDF, no a la pantalla.
   - Las filas flexibles pueden saltar de línea (la leyenda ya no se corta).
   - La tabla general tiene anchos de columna fijos.
   - Si algo aún sobresale, la copia se ensancha y html2pdf la reduce completa
     a la hoja, así que nada queda recortado.
   ===================================================================== */

(function () {
  const estilo = document.createElement('style');
  estilo.id = 'estilo-pdf-ajuste';
  estilo.textContent = `
    .pdf-ajuste, .pdf-ajuste * { box-sizing: border-box; min-width: 0; }
    .pdf-ajuste .overflow-x-auto { overflow: visible; }
    .pdf-ajuste .flex { flex-wrap: wrap; }
    .pdf-ajuste img { max-width: 100%; }
    .pdf-general table { table-layout: fixed; width: 100%; }
    .pdf-general th, .pdf-general td { overflow-wrap: anywhere; }
    .pdf-general #pdf-tabla-general th:nth-child(1) { width: 19%; }
    .pdf-general #pdf-tabla-general th:nth-child(2) { width: 25%; }
    .pdf-general #pdf-tabla-general th:nth-child(3) { width: 13%; }
    .pdf-general #pdf-tabla-general th:nth-child(4) { width: 35%; }
    .pdf-general #pdf-tabla-general th:nth-child(5) { width: 8%; }
  `;
  document.head.appendChild(estilo);
})();

async function generarPDF() {
  const btn = document.getElementById('btn-pdf');
  const txt = document.getElementById('btn-pdf-txt');
  const esGeneral = selectRuta.value === GENERAL;
  btn.disabled = true;
  txt.textContent = 'Generando mapa y PDF...';
  let holder = null;
  try {
    // Vista general: hoja horizontal. Ruta: hoja vertical.
    let ANCHO = esGeneral ? 1040 : 760;

    holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${ANCHO}px;`;
    const doc = document.getElementById('pdf-area').cloneNode(true);
    doc.removeAttribute('id');
    doc.style.width = ANCHO + 'px';
    doc.classList.remove('shadow', 'rounded-xl');
    doc.classList.add('pdf-ajuste', esGeneral ? 'pdf-general' : 'pdf-ruta');
    holder.appendChild(doc);
    document.body.appendChild(holder);

    await esperarImagenes(doc);
    ajustarLogos(doc);

    // Si algo sobresale del ancho, ensanchamos la copia: html2pdf la reduce entera a la hoja
    ANCHO = Math.max(ANCHO, doc.scrollWidth);
    doc.style.width = ANCHO + 'px';
    holder.style.width = ANCHO + 'px';

    doc.querySelector('#pdf-fecha').textContent =
      new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

    // Alto de la hoja en px según el ancho real de la copia
    const ALTO_HOJA = esGeneral
      ? ANCHO * (200 / 287) * 0.985
      : ANCHO * (287 / 200) * 0.985;

    const cont = doc.querySelector('#pdf-map-container');
    const img = doc.querySelector('#pdf-map-img');
    cont.classList.remove('hidden');
    img.style.height = '0px';

    const MIN_MAP = 300, MAX_MAP = 720;
    let altoMapa;
    if (esGeneral) {
      // Medimos sin la tabla: el mapa ocupa la página 1 y la tabla pasa a la página 2
      const tablaEl = doc.querySelector('#pdf-tabla-general');
      tablaEl.style.display = 'none';
      const base = doc.offsetHeight;
      tablaEl.style.display = '';
      altoMapa = Math.max(MIN_MAP, Math.min(ALTO_HOJA - base - 10, 640));
    } else {
      let base = doc.offsetHeight;
      altoMapa = ALTO_HOJA - base;
      if (altoMapa < MIN_MAP) {            // muchas casillas: tabla compacta
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
        scale: esGeneral ? 2 : 3,
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
