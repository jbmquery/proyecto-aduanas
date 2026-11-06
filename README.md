# VUCE Demo – Gestión documentaria y operativa (MVP)

Frontend estático (HTML + Tailwind CDN + JS vanilla) · Backend Google Apps Script · BD Google Sheets · Archivos en Google Drive.

## 1. Backend (5 min)
1. Cree una hoja de cálculo de Google nueva → **Extensiones > Apps Script**.
2. Cree los archivos `Code.gs` y `SchemaInitializer.gs` y pegue su contenido (en *Configuración del proyecto* active "Mostrar appsscript.json" y pegue también `appsscript.json`).
3. Ejecute **`inicializarSistema`** (autorice permisos de Sheets y Drive). En *Registro de ejecución* aparece el usuario `admin` y su contraseña inicial: guárdela.
4. (Opcional) Ejecute **`cargarDatosDemo`** para sembrar clientes, un despacho y una importación de ejemplo.
5. **Implementar > Nueva implementación > Aplicación web** · Ejecutar como: *Yo* · Acceso: *Cualquier persona* → copie la URL `/exec`.
   Cada vez que cambie el código: *Administrar implementaciones > Editar > Nueva versión*.

## 2. Frontend
1. Pegue la URL `/exec` en `js/api.js` (`API_URL`).
2. Sirva la carpeta con un servidor web (no funciona con `file://` porque las vistas se cargan con `fetch`):
   `python3 -m http.server 8080` → http://localhost:8080  (o GitHub Pages / Netlify / Firebase Hosting).

## 3. Usuarios y roles (se gestionan desde el editor de Apps Script)
- `crearUsuario('maria', 'ClaveSegura123', 'OPERADOR')` · `cambiarPassword('admin', 'NuevaClave123')`
- **ADMIN**: todo · **OPERADOR**: crear/editar/subir/emitir · **CONSULTA**: solo lectura.
- Bloqueo de 15 min tras 5 intentos fallidos; sesión por token (6 h máx., 30 min de inactividad en el cliente).

## Notas
- Hojas auxiliares añadidas: `COMPROBANTES` (correlativos), `DOCUMENTOS` (versiones de archivos) y `BITACORA` (auditoría).
- `PADRON_SUNAT_SIMULADO` se edita directamente en la hoja. RUC de prueba: `20600589092` (activo/habido), `20100000009` (no habido), `20100000017` (baja).
- Los archivos quedan **privados** en Drive; la vista previa funciona para quien tenga acceso a esa carpeta en Drive.
- Datos del emisor del comprobante simulado: constante `CFG.EMISOR` en `Code.gs` (confirme la razón social legal).
# proyecto-aduanas
