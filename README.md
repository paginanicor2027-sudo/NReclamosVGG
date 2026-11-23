# ReclamosVGG

Mapa interactivo de Villa Gobernador Gálvez, Santa Fe, para Nicolás Ramírez. La página muestra el límite municipal y permite desplazarse, cambiar el zoom y volver al encuadre inicial.

## Ejecutar localmente

Con Python 3, ejecutá `python -m http.server 8000` desde esta carpeta y abrí [http://localhost:8000/](http://localhost:8000/) en Chrome. Leaflet y el mapa de calles se cargan por internet.

## Probar el envío de reclamos

Con Node.js 24 y npm, ejecutá estos comandos desde esta carpeta.

```sh
npm ci
npm run preview:reports
```

Abrí [la vista previa local](http://127.0.0.1:4173/ReclamosVGG/). Elegí **Hacer un reclamo**, marcá un punto en Villa Gobernador Gálvez, elegí una categoría y enviá una descripción de prueba. El envío devuelve un código de seguimiento y queda en estado pendiente de revisión.

La vista previa usa la misma validación del servidor y migración SQL que la función de Supabase. PostgreSQL se ejecuta localmente con PGlite y guarda los reclamos de prueba en `.local/reports-db`.

## Probar el panel y el mapa

Abrí el [panel local de moderación](http://127.0.0.1:4173/ReclamosVGG/admin.html) con el usuario de prueba `moderador@reclamosvgg.test` y la contraseña `reclamos-local`. Este acceso pertenece al servidor de vista previa de tu computadora.

Identificá el reclamo por el código que recibiste y aprobalo. Abrí o recargá el mapa y comprobá que aparece. Podés filtrar por categoría y estado, abrir el marcador y usar **Consultar seguimiento** para ver el estado y la fecha de actualización.

## Conectar Supabase

En un proyecto dedicado, aplicá las migraciones de `supabase/migrations` y desplegá las funciones `submit-report` y `report-directory`. Ejecutá primero `npm run prepare:reports` para incluir en `submit-report` una copia del GeoJSON del mapa. Las funciones usan las credenciales de servidor que provee Supabase.

En `reports-config.js`, configurá `endpoint` y `directoryEndpoint` con las URL HTTPS de las funciones, `supabaseUrl` con la URL del proyecto y `publishableKey` con su clave pública. El formulario, el mapa de reclamos y el panel se habilitan al configurar sus respectivas URL. [Documentación de Edge Functions](https://supabase.com/docs/guides/functions)

Para habilitar a un moderador, creá su usuario desde **Authentication → Users** de Supabase. Con el identificador de ese usuario, registrá su acceso desde el editor SQL del proyecto.

```sql
insert into public.report_moderators (user_id)
values ('ID-DEL-USUARIO'::uuid);
```

## Publicar en GitHub Pages

Para publicar desde la rama `main`, elegí **Deploy from a branch** en **Settings → Pages** y seleccioná `main` y `/(root)`. El sitio es estático y usa rutas relativas para funcionar bajo `/NReclamosVGG/`. [Guía de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Datos cartográficos

- El contorno es el del municipio 820217 de Santa Fe, con fuente DPE–INDEC. El archivo local conserva las coordenadas del registro oficial y las presenta en un GeoJSON de una sola entidad. [Servicio Georef](https://www.argentina.gob.ar/georef) · [Archivo de origen](https://apis.datos.gob.ar/georef/api/v2.0/gobiernos-locales.ndjson) · [Licencia CC BY 4.0](https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia)
- Las calles y el mapa base provienen de [OpenStreetMap](https://www.openstreetmap.org/copyright). El mapa interactivo utiliza [Leaflet](https://leafletjs.com/).
