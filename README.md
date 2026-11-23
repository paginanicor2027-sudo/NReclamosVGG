# NReclamosVGG

Mapa interactivo de Villa Gobernador Gálvez, Santa Fe, para Nicolás Ramírez. La página muestra el límite municipal y permite desplazarse, cambiar el zoom y volver al encuadre inicial.

## Ejecutar localmente

Con Python 3, ejecutá `python -m http.server 8000` desde esta carpeta y abrí [http://localhost:8000/](http://localhost:8000/) en Chrome. Leaflet y el mapa de calles se cargan por internet.

## Publicar en GitHub Pages

Para publicar desde la rama `main`, elegí **Deploy from a branch** en **Settings → Pages** y seleccioná `main` y `/(root)`. El sitio es estático y usa rutas relativas para funcionar bajo `/NReclamosVGG/`. [Guía de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Datos cartográficos

- El contorno es el del municipio 820217 de Santa Fe, con fuente DPE–INDEC. El archivo local conserva las coordenadas del registro oficial y las presenta en un GeoJSON de una sola entidad. [Servicio Georef](https://www.argentina.gob.ar/georef) · [Archivo de origen](https://apis.datos.gob.ar/georef/api/v2.0/gobiernos-locales.ndjson) · [Licencia CC BY 4.0](https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia)
- Las calles y el mapa base provienen de [OpenStreetMap](https://www.openstreetmap.org/copyright). El mapa interactivo utiliza [Leaflet](https://leafletjs.com/).
