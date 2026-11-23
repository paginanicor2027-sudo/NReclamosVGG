const georef = 'https://apis.datos.gob.ar/georef/api/v2.0/direcciones';
const locality = '82084310';

export function initializeReportAddress({ setAddressPoint }) {
  const input = document.getElementById('report-address-query');
  const searchButton = document.getElementById('report-address-search');
  const status = document.getElementById('report-address-status');
  const results = document.getElementById('report-address-results');
  const dialog = document.getElementById('report-dialog');
  let pending = null;

  function resetResults() {
    pending?.abort();
    pending = null;
    results.replaceChildren();
    results.hidden = true;
    status.textContent = '';
    searchButton.disabled = false;
  }

  async function search() {
    resetResults();
    const address = input.value.trim();
    if (address.length < 3) {
      status.textContent = 'Escribí el nombre de una calle o esquina.';
      input.focus();
      return;
    }
    const current = new AbortController();
    pending = current;
    searchButton.disabled = true;
    status.textContent = 'Buscando direcciones…';
    const params = new URLSearchParams({
      direccion: address,
      provincia: '82',
      departamento: '82084',
      localidad_censal: locality,
      max: '5',
    });

    try {
      const response = await fetch(`${georef}?${params}`, {
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(9000)]),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error('Address lookup failed.');
      const { direcciones } = await response.json();
      if (pending !== current) return;
      const seen = new Set();
      for (const result of Array.isArray(direcciones) ? direcciones : []) {
        if (result.localidad_censal?.id !== locality) continue;
        const { lat, lon } = result.ubicacion ?? {};
        const label = result.nomenclatura?.split(/,\s*Villa Gobernador Gálvez\b/i, 1)[0]?.trim();
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !label || seen.has(label)) continue;
        seen.add(label);

        const row = document.createElement('li');
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'report-button report-secondary';
        choose.textContent = label;
        choose.addEventListener('click', () => {
          if (!setAddressPoint({ lat, lng: lon }, label)) {
            status.textContent = 'Ese resultado no está dentro del límite municipal. Probá otro o marcá el punto en el mapa.';
            return;
          }
          resetResults();
          status.textContent = 'Dirección marcada. Podés ajustar el punto en el mapa.';
          input.focus();
        });
        row.append(choose);
        results.append(row);
      }
      results.hidden = seen.size === 0;
      status.textContent = seen.size
        ? 'Elegí un resultado para marcar el punto.'
        : 'No encontramos esa dirección. Probá con otra o marcá el punto en el mapa.';
    } catch {
      if (pending === current) status.textContent = 'La búsqueda no está disponible. Podés marcar el punto en el mapa.';
    } finally {
      if (pending === current) {
        pending = null;
        searchButton.disabled = false;
      }
    }
  }

  input.addEventListener('input', resetResults);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!pending) void search();
  });
  searchButton.addEventListener('click', () => { void search(); });
  dialog.addEventListener('close', resetResults);
}
