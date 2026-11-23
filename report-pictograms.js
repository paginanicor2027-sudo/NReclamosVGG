const svgNamespace = 'http://www.w3.org/2000/svg';

const pictogramPaths = Object.freeze({
  baches: 'M4 9h16v6H4zM6 15v4m12-4v4M7 15l4-6m1 6 4-6m1 6 3-4.5',
  luminarias: 'M6 20h6m-3 0V8a4 4 0 0 1 4-4h3m0 0 3 5h-6l3-5m-4 8-1 2m5-2v2m4-2 1 2',
  residuos: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13m-6 4v5m3-5v5',
  desagues: 'M6 11h11a3 3 0 0 0 .4-6 4.6 4.6 0 0 0-8.9 1A2.6 2.6 0 0 0 6 11Zm3 2-1 2m5-2-1 2m5-2-1 2M4 19c2-2 4-2 6 0s4 2 6 0 3-2 4-1',
  agua: 'M12 4c-1.7 3.1-5.7 7.4-5.7 11a5.7 5.7 0 1 0 11.4 0C17.7 11.4 13.7 7.1 12 4Zm-3 11a3 3 0 0 0 2.2 2.9',
  arbolado: 'M10 20h4m-2 0v-6m-2 1H6a3 3 0 0 1-1.2-5.7A4 4 0 0 1 8.6 7 3.6 3.6 0 0 1 15.4 7a4 4 0 0 1 3.8 2.3A3 3 0 0 1 18 15h-4m-2-1-2-2m2 2 2-3',
  cloacas: 'M4 9h16v8H4zM5 12h14m-14 2.5h14M8 9v8m4-8v8m4-8v8M7 6h10m-10 14h10',
  cableado: 'M12 4v16m-3 0h6M5 7h14M7 7V5m10 2V5M5 11h14M7 11v2m10-2v2',
  comercios: 'M4 20v-9l5-3v4l5-3v3l4-2V5h2v15H4Zm4-4h1m2 0h1m2 0h1m2 0h1',
  ambiente: 'M10 4h4m-4 0v5l-4 6a2 2 0 0 0 1.7 3h8.6a2 2 0 0 0 1.7-3l-4-6V4m-6 9h8m-5 3h.01m2-5h.01',
  educacion: 'M12 7c-2-2-5-3-8-2v13c3-1 6 0 8 2 2-2 5-3 8-2V5c-3-1-6 0-8 2v13M7 9l2 1m6 0 2-1',
  gas: 'M12.8 3c1.9 2.6 3.1 5.2 2.8 7.8 1.3-.6 2.1-1.8 2.4-3.1 1.4 2.5 2.5 4.5 2.5 7 0 4.2-3.5 6.9-8 6.9-4.6 0-8.3-2.8-8.3-7 0-2.5 1.4-4.6 3.3-6.2-.2 1.8.1 3.1 1 3.9.4-3.8 3.2-6 4.3-9.3Zm-.3 10.3c-.3 1.8-2.8 3.2-2.8 5 0 1.3 1.1 2.1 2.8 2.1 1.6 0 2.9-.9 2.9-2.3 0-1.3-1.3-3.7-2.9-4.8Z',
  electricidad: 'M13.5 2.5 5 13.8h5.9l-1 7.7L19 9.8h-6.1l.6-7.3Z',
  espacios_publicos: 'M5 10h14v5H5zM4 15h16v3H4zM6 18v3m12-3v3M8 10V7m8 3V7M5 12.5h14m-7-9v3',
  plagas: 'M8.5 9a3.5 3.5 0 0 1 7 0v6a3.5 3.5 0 1 1-7 0V9ZM12 10v8m-2-12L8 4m6 2 2-2M5 8l3.5 2m-3.5 3h3.5M5 18l3.5-2M19 8l-3.5 2m3.5 3h-3.5m3.5 5-3.5-2',
  salud: 'M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4Z',
  seguridad: 'M12 4 5.5 7v4.5c0 4 2.7 7.3 6.5 8.5 3.8-1.2 6.5-4.5 6.5-8.5V7L12 4Zm-3 8 2 2 4-4',
  tramites: 'M8 6H6v14h12V6h-2m-8-2h8v4H8zM9 12h6m-6 3h6m-6 3h4',
  transito: 'M8 4h8v16H8zM5 6l3 3m-3 2 3 3m8-5 3-3m-3 8 3-3M12 7h.01m0 4h.01m0 4h.01',
  veredas: 'M13.5 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-2.5 3-3 2-1 3m4.5-4 2.5 3 3 1m-5.5-4-1 6-3 4m3-4 3 2 1 2.5M4 21h16',
  otros: 'M12 8h.01M12 11v5m8-4a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
});

const filledPictograms = new Set(['gas', 'electricidad', 'salud']);

export const reportPictogramCategories = Object.freeze(Object.keys(pictogramPaths));

export function createReportPictogram(category) {
  const key = Object.hasOwn(pictogramPaths, category) ? category : 'otros';
  const filled = filledPictograms.has(key);
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('class', 'report-pictogram');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', filled ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const shape = document.createElementNS(svgNamespace, 'path');
  shape.setAttribute('d', pictogramPaths[key]);
  if (filled) shape.setAttribute('fill-rule', 'evenodd');
  svg.append(shape);
  return svg;
}
