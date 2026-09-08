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
4. Ajustar, si hace falta, las opciones avanzadas discretas: calidad de curvas y unión de trazos continuos.
5. Seleccionar salida: SVG, DXF o PDF.
6. Descargar.

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
- Se agregó una sección discreta de opciones avanzadas dentro de “Info archivo”.
- Calidad de curvas simplificada a cuatro niveles: Baja, Media, Alta y Muy alta. Al cambiarla, el archivo se reprocesa desde la fuente original para que la vista y la exportación usen la nueva discretización.
- Se agregó el contador “Vértices generados”, útil para verificar el efecto de la calidad de curvas.
- Unión de trazos continuos activada por defecto para favorecer trayectorias limpias de corte láser.
- Descarga mediante una sola lista de formato de salida: SVG, DXF o PDF.
- Botón único “Descargar”, habilitado cuando hay geometría vectorial cargada.
- Reset de vista movido al área del visor como control discreto.
- Fondo claro para mejorar contraste con líneas SVG/DXF/PDF.

## Notas técnicas

La geometría interna se normaliza como polilíneas en milímetros con eje Y hacia arriba. Los SVG se interpretan con escala automática cuando declaran `width`, `height` o `viewBox`. Los PDF se leen desde comandos vectoriales básicos de contenido (`m`, `l`, `c`, `re`, `S`, `s`, `f`).


## Opciones avanzadas

- **Calidad de curvas** controla cuántos puntos se generan al convertir arcos, círculos, elipses, splines o curvas Bézier a polilíneas. “Alta” queda como valor recomendado para corte láser. “Muy alta” produce curvas más suaves, pero también archivos más pesados. Este ajuste sólo cambia geometría curva; archivos formados únicamente por líneas rectas se verán igual en todos los niveles.
- **Unir trazos continuos** intenta fusionar líneas o polilíneas abiertas cuando sus extremos coinciden o están muy cerca. Esto reduce cortes separados y favorece trayectorias continuas, que suelen ser más adecuadas para fabricación láser.

## Actualización de interfaz y uso móvil

- Selector de salida ampliado para mostrar SVG, DXF y PDF sin recortes.
- Encabezado adaptable y visor con herramientas y ayuda fuera del área de dibujo.
- Controles de al menos 44 px, foco visible y botón de carga accesible con teclado.
- Arrastre táctil, zoom con dos dedos y botones +/−; regla mediante dos toques.
- Lectura de la regla junto al dibujo, sin tener que bajar al panel de información.
- Opción **Exportar solo capas visibles**, desactivada inicialmente. Ocultar una capa
  sigue sin eliminarla ni modificar el archivo original.
- Mensajes de carga y exportación; arrastrar archivos usa el mismo manejo de errores
  que el selector. Las unidades manuales vuelven a Auto al abrir otro archivo.

### Instalación de esta actualización

Extraer el ZIP en la raíz del repositorio, reemplazando los archivos existentes.
Conservar la carpeta `js/`. No requiere backend ni nuevas dependencias de producción.
Recargar la página sin caché después de subir los cambios.

### Verificación y límites

Comprobados: sintaxis de JavaScript, exportación de una geometría de prueba a
SVG/DXF/PDF, relectura del PDF generado, filtrado de capas y eventos táctiles
simulados para regla y zoom sin alterar dimensiones. La validación de eventos
se realizó con un DOM simulado, no con un dispositivo físico.
No se pudo completar la inspección visual en navegador en el entorno de trabajo;
queda por confirmar el aspecto final y los gestos en Safari/Chrome móvil reales.
Los límites existentes de importación de PDF y de entidades DXF siguen vigentes.
