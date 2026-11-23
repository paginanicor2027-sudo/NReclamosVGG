const mapStatus = document.getElementById('map-status');
const legend = document.getElementById('boundary-legend');
const resetView = document.getElementById('reset-view');
const zoomIn = document.getElementById('zoom-in');
const zoomOut = document.getElementById('zoom-out');

const cityCenter = [-33.0317, -60.6241];
const cityZoom = 13;
const worldRing = [[-85, -180], [-85, 180], [85, 180], [85, -180]];

function polygonRings(geojson) {
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  const rings = features.flatMap((feature) => {
    const geometry = feature.geometry;
    if (geometry?.type === 'Polygon') return geometry.coordinates;
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat();
    return [];
  });

  if (rings.length === 0) throw new Error('El archivo no contiene un límite municipal.');
  return rings.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

async function loadBoundary(map) {
  const response = await fetch('./data/villa-gobernador-galvez.geojson');
  if (!response.ok) throw new Error(`Error al cargar el límite municipal (${response.status}).`);

  const geojson = await response.json();
  const mask = L.polygon([worldRing, ...polygonRings(geojson)], {
    interactive: false,
    stroke: false,
    fillColor: '#63b6aa',
    fillOpacity: 0.20,
    fillRule: 'evenodd',
    smoothFactor: 0,
  });
  const outline = L.geoJSON(geojson, {
    interactive: false,
    style: { color: '#02807d', weight: 3, opacity: 1, fill: false, smoothFactor: 0 },
  });
  const bounds = outline.getBounds();
  if (!bounds.isValid()) throw new Error('Las coordenadas del límite municipal no son válidas.');

  mask.addTo(map);
  outline.addTo(map);
  map.attributionControl.addAttribution(
    'Límite: <a href="https://www.argentina.gob.ar/georef">Servicio Georef</a> (DPE–INDEC), ' +
    '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
  );
  legend.hidden = false;
  return { bounds, geojson };
}

function fitCity(map, bounds) {
  if (!bounds) {
    map.setView(cityCenter, cityZoom, { animate: false });
    return;
  }

  const mapHeight = map.getSize().y;
  const inset = mapHeight < 480 ? 26 : 44;
  map.fitBounds(bounds, {
    paddingTopLeft: [inset, mapHeight < 480 ? 54 : 94],
    paddingBottomRight: [inset, inset],
    maxZoom: 14,
    animate: false,
  });
}

function addStreetMap(map, bounds) {
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    noWrap: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Colaboradores de OpenStreetMap</a>',
  });
  let receivedTiles = false;

  tiles.on('loading', () => { receivedTiles = false; });
  tiles.on('tileload', () => { receivedTiles = true; });
  tiles.on('load', () => {
    if (!receivedTiles) {
      mapStatus.textContent = bounds ? 'No se pudo cargar el mapa de calles.' : 'No se pudieron cargar las calles ni el límite municipal.';
      return;
    }
    mapStatus.textContent = bounds ? '' : 'No se pudo cargar el límite municipal.';
  });
  tiles.addTo(map);
}

async function initializeMap() {
  if (!window.L) {
    mapStatus.textContent = 'No se pudo iniciar el mapa. Volvé a cargar la página.';
    return;
  }

  mapStatus.textContent = 'Cargando el mapa…';
  const map = L.map('map', {
    zoomControl: false,
    minZoom: 9,
    maxZoom: 19,
    zoomSnap: 0.25,
    maxBoundsViscosity: 0.8,
  });
  map.attributionControl.setPrefix(false);

  let boundary = null;
  try {
    boundary = await loadBoundary(map);
  } catch (error) {
    console.warn(error);
  }

  const bounds = boundary?.bounds ?? null;
  fitCity(map, bounds);
  if (bounds) map.setMaxBounds(bounds.pad(2));

  const updateZoom = () => {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
  };
  map.on('zoomend', updateZoom);
  resetView.disabled = false;
  resetView.addEventListener('click', () => {
    map.stop();
    fitCity(map, bounds);
  });
  zoomIn.addEventListener('click', () => map.zoomIn());
  zoomOut.addEventListener('click', () => map.zoomOut());
  updateZoom();

  addStreetMap(map, bounds);
  if (bounds) {
    try {
      const [{ initializeReportForm }, { initializeReportDirectory }, { initializeReportAddress }] = await Promise.all([
        import('./report-form.js?v=selector-1'),
        import('./report-directory.js?v=selector-1'),
        import('./report-address.js?v=vecinos-2'),
      ]);
      const reportForm = initializeReportForm(map, L, boundary.geojson);
      if (reportForm) {
        initializeReportAddress(reportForm);
        map.on('contextmenu', ({ latlng }) => reportForm.openAt(latlng));
      }
      initializeReportDirectory(map, L);
    } catch (error) {
      console.warn('No se pudieron iniciar las funciones de reclamos.', error);
    }
  }
}

initializeMap();
