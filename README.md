# Corte Laser — visor y conversor vectorial

Visor web estático para archivos vectoriales de corte láser. La conversión se hace desde el mismo flujo de trabajo: cargas un archivo DXF/SVG/PDF vectorial, eliges el formato de salida y descargas.

## Formatos soportados

- Entrada: DXF, SVG y PDF vectorial.
- Salida: DXF, SVG y PDF.
- El PDF de entrada debe contener trazos vectoriales. No se convierten escaneos, fotografías ni PDFs rasterizados.

## Flujo de uso

1. Abrir la aplicación en un servidor local.
2. Cargar un archivo `.dxf`, `.svg` o `.pdf` vectorial.
3. Revisar dimensiones, capas y trazos en el visor.
4. Seleccionar salida: SVG, DXF o PDF.
5. Descargar.

## Estructura actual

- `index.html`: interfaz principal.
- `styles.css`: tema visual claro, pensado para alto contraste con líneas de corte.
- `js/main.js`: arranque de módulos y descarga de archivos.
- `js/ui.js`: carga de archivos y estado de botones.
- `js/viewer.js`: visor canvas, lectura DXF/SVG/PDF y exportación desde la geometría cargada.
- `js/vector-utils.js`: representación geométrica común, importadores SVG/PDF y exportadores DXF/SVG/PDF.

## Cambios de interfaz recientes

- Encabezado simplificado a “Corte Laser”.
- Se eliminó el modo separado “Convertir formatos”.
- Se eliminaron los controles visibles de calidad de curvas y unión de segmentos para evitar ambigüedad en el flujo principal.
- Descarga mediante una sola lista de formato de salida: SVG, DXF o PDF.
- Botón único “Descargar”, habilitado cuando hay geometría vectorial cargada.
- Reset de vista movido al área del visor como control discreto.
- Fondo claro para mejorar contraste con líneas SVG/DXF/PDF.

## Notas técnicas

La geometría interna se normaliza como polilíneas en milímetros con eje Y hacia arriba. Los SVG se interpretan con escala automática cuando declaran `width`, `height` o `viewBox`. Los PDF se leen desde comandos vectoriales básicos de contenido (`m`, `l`, `c`, `re`, `S`, `s`, `f`).
