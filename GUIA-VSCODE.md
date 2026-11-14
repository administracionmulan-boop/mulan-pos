# MULAN POS · Guía paso a paso con VS Code

Esta guía deja el proyecto funcionando desde cero. Al terminar, cualquier cambio se publica con **un solo comando**: `npm run publicar` (o doble clic en `PUBLICAR-MULAN.cmd`).

```
VS Code (tu PC)
 ├─ backend/   ──npm run publicar──▶  Google Apps Script  ──▶  Google Sheet (Drive de la cuenta del negocio)
 └─ frontend/  ──npm run publicar──▶  GitHub  ──▶  GitHub Pages  ──▶  app instalada en celulares, tablets y PC
```

Tiempo estimado: 45 a 60 minutos la primera vez.

---

## ⚡ Instalación automática (recomendada)

Si ya tienes **Node.js** y **Git** (el instalador los instala con *winget* si faltan), la cuenta de Google de MULAN y tu cuenta de GitHub:

1. Abre la carpeta `Documentos\mulan-pos` en el Explorador de archivos.
2. Haz **doble clic en `INSTALAR-MULAN.cmd`**. Si Windows muestra *"Windows protegió su PC"*, elige **Más información → Ejecutar de todas formas**.
3. Sigue la ventana. Hace todo sola y solo se detiene en 5 momentos donde debes actuar tú:

| # | Qué te pide | Qué haces |
|---|---|---|
| 1 | Iniciar sesión en Google | Entras con la **cuenta de MULAN** y pulsas **Permitir** |
| 2 | (Solo si hace falta) activar la API de Apps Script | Activas el interruptor en la página que se abre y presionas Enter |
| 3 | Crear el repositorio de GitHub | Pulsas **Create repository** y pegas la dirección en la ventana |
| 4 | Autorizar el servidor | **Revisar permisos → Configuración avanzada → Ir a MULAN POS → Permitir** |
| 5 | Activar GitHub Pages | En *Source* eliges **GitHub Actions** y presionas Enter |

El instalador crea el Google Sheet en el Drive de la cuenta de MULAN, sube el backend, crea la base de datos, publica la app y te muestra su dirección. Si algo se interrumpe, vuelve a hacer doble clic: **continúa donde quedó**.

Para publicar cambios después: **doble clic en `PUBLICAR-MULAN.cmd`**, o `npm run publicar` en VS Code.

Los pasos siguientes son la **instalación manual**, por si prefieres hacerlo a mano o algo falla.

---

## Lo que necesitas

| Qué | Para qué | Costo |
|---|---|---|
| Cuenta de Gmail **del negocio** (ej. `mulan.pos@gmail.com`) | Es la dueña del Sheet con los datos y del backend | Gratis |
| Cuenta de **GitHub** | Aloja la app (GitHub Pages) | Gratis |
| **Node.js LTS** | Ejecuta las pruebas y los comandos de publicación | Gratis |
| **Git** | Envía los cambios a GitHub | Gratis |
| **Visual Studio Code** | Editor donde trabajas | Gratis |

> Usa una cuenta de Google exclusiva del negocio, no una personal ni la de la empresa. Así los datos no dependen de una persona y puedes compartirlos con quien quieras.

---

## Paso 1 · Instalar los programas (Windows)

1. **Node.js**: https://nodejs.org → botón **LTS** → instalar con las opciones por defecto.
2. **Git**: https://git-scm.com/download/win → instalar con las opciones por defecto. Incluye el *Git Credential Manager*, que facilita el inicio de sesión en GitHub.
3. **VS Code**: https://code.visualstudio.com → instalar. Marca **"Agregar a PATH"** y **"Abrir con Code"** en el menú contextual.
4. Reinicia el computador o, al menos, cierra y abre VS Code.
5. En VS Code abre **Terminal → Nueva terminal** y verifica:
   ```powershell
   node -v      # debe mostrar v20 o superior
   git --version
   ```
6. Dile a Git quién eres. Esto se hace una sola vez:
   ```powershell
   git config --global user.name "Tu Nombre"
   git config --global user.email "tu-correo@ejemplo.com"
   ```

> Si aparece *"la ejecución de scripts está deshabilitada en este sistema"* al usar `npm`, ejecuta una vez:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` y responde **S**.

---

## Paso 2 · Crear las cuentas

1. **Gmail del negocio**: https://accounts.google.com/signup
2. **GitHub**: https://github.com/signup. Puede ser tu cuenta personal o una del negocio. Recuerda el nombre de usuario: será parte de la dirección de la app (`https://USUARIO.github.io/mulan-pos/`).

---

## Paso 3 · Activar la API de Apps Script

Con la **cuenta del negocio** abre https://script.google.com/home/usersettings y activa **"API de Google Apps Script"**.

Sin esto, VS Code no puede subir el código a Google.

---

## Paso 4 · Crear el Sheet y el proyecto de Apps Script

1. Con la cuenta del negocio, en https://sheets.new, crea una hoja y nómbrala **MULAN POS - Datos**.
2. En la hoja: **Extensiones → Apps Script**. Se abre el editor. Ponle de nombre **MULAN POS Backend** (arriba a la izquierda).
3. **Copia la URL del editor** de la barra del navegador. Se ve así:
   `https://script.google.com/home/projects/1AbC...xyz/edit`
   La vas a pegar en el paso 5.

> No pegues código en el editor: VS Code lo sube por ti.

---

## Paso 5 · Abrir el proyecto en VS Code y conectarlo

1. Descomprime `mulan-pos.zip` en una carpeta fija, por ejemplo `C:\Proyectos\mulan-pos`.
2. En VS Code: **Archivo → Abrir carpeta…** y elige `mulan-pos`. Si pregunta *"¿Confía en los autores?"*, responde **Sí**.
   VS Code sugerirá instalar extensiones recomendadas (español, GitHub). Acéptalas.
3. Abre la terminal (**Ctrl + ñ** o **Terminal → Nueva terminal**) y ejecuta:
   ```powershell
   npm install
   ```
   Esto instala `clasp` (la herramienta de Google para Apps Script) dentro del proyecto. Tarda uno o dos minutos.
4. Inicia sesión en Google desde VS Code:
   ```powershell
   npx clasp login
   ```
   Se abre el navegador. Entra con la **cuenta del negocio** y acepta los permisos. Al final verás *"Logged in"*.
5. Conecta la carpeta con tu proyecto de Apps Script:
   ```powershell
   npm run configurar
   ```
   * Pega la URL del editor que copiaste en el paso 4 y presiona Enter.
   * Cuando pregunte por una implementación existente, presiona **Enter** (aún no hay).
6. Sube el código del backend:
   ```powershell
   npm run subir-backend
   ```
   Primero corren las pruebas automáticas y luego se sube el código.
7. **Crea la base de datos**. En el navegador, recarga el editor de Apps Script. Verás los archivos `Auth`, `Caja`, `Main`, etc.
   * Arriba, en la lista de funciones, elige **`setup`** y pulsa **▶ Ejecutar**.
   * Google pedirá permisos: **Revisar permisos** → elige la cuenta del negocio → *"Google no ha verificado esta app"* → **Configuración avanzada** → **Ir a MULAN POS Backend (no seguro)** → **Permitir**.
     *(Es normal: la app es tuya y no está publicada en el catálogo de Google).*
   * En el registro debe aparecer: `MULAN POS listo. Usuario: admin / Clave: mulan2026 / PIN: 1234`.
   * *(Alternativa: al abrir por primera vez la URL `/exec` del paso 8, la base se crea sola).*
   * Vuelve al Sheet: ya tiene las hojas `Config`, `Usuarios`, `Productos`, `Ventas`, etc.

---

## Paso 6 · Subir el proyecto a GitHub

1. En VS Code abre **Control de código fuente** (ícono de ramas a la izquierda, o **Ctrl + Shift + G**).
2. Pulsa **"Publicar en GitHub"**. Si ves "Inicializar repositorio", púlsalo primero.
3. Inicia sesión en GitHub cuando lo pida.
4. Elige **"Publicar en repositorio público"** y deja el nombre **mulan-pos**.

> **¿Público?** El plan gratuito de GitHub Pages lo exige. Queda visible el código, pero **no los datos**: esos están en tu Sheet y para usarlos hace falta iniciar sesión en la app. Si prefieres un repositorio privado, Netlify o Cloudflare Pages lo permiten gratis (pregúntame y lo adapto).

---

## Paso 7 · Activar GitHub Pages

1. En https://github.com/USUARIO/mulan-pos ve a **Settings → Pages**.
2. En **Build and deployment → Source** elige **GitHub Actions**.

Listo. El proyecto ya trae el flujo `.github/workflows/pages.yml`, que publica la carpeta `frontend/` en cada cambio.

---

## Paso 8 · Primera publicación completa

En la terminal de VS Code:

```powershell
npm run publicar
```

También puedes usar **Ctrl + Shift + B** (tarea *"MULAN: Publicar todo"*).

Esto hace, en orden:

1. Corre las pruebas. Si alguna falla, se detiene sin publicar nada.
2. Sube el backend y **crea la aplicación web** en Apps Script. Las siguientes veces la actualiza manteniendo la misma URL.
3. Escribe la URL de la API en `frontend/config.js` y cambia la versión de la app.
4. Hace *commit* y *push* a GitHub, y GitHub Pages publica la app.

Revisa el avance en GitHub, pestaña **Actions**: cuando el círculo quede en verde ✔ (1 o 2 minutos), abre:

**`https://USUARIO.github.io/mulan-pos/`**

Ingresa con **admin / mulan2026**. La app te pedirá crear tu clave y tu PIN de administrador.

---

## Paso 9 · Instalar la app en los dispositivos

| Dispositivo | Cómo |
|---|---|
| PC con Chrome o Edge | Abre la dirección → ícono **Instalar** (⊕) a la derecha de la barra de direcciones |
| Android | Chrome → menú ⋮ → **Instalar aplicación** |
| iPhone / iPad | Safari → **Compartir** → **Agregar a inicio** |

En cada dispositivo inicia sesión una vez con internet. Después funciona aunque se caiga la conexión.

---

## Paso 10 · Respaldo y acceso de otras cuentas al Sheet (recomendado)

* En el Sheet: **Compartir** → agrega tu correo personal (y el de quien administre) como **Editor**. Lo verán en *"Compartido conmigo"* de su Drive.
* Drive guarda historial: **Archivo → Historial de versiones**.
* Los cajeros **no** necesitan cuenta de Google: se crean en la app (**Usuarios**).

---

## Trabajo del día a día

```
editar en VS Code  →  probar en local  →  npm run publicar -- -m "qué cambié"
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Abre la app en http://localhost:8080 con datos **de prueba** (no toca tu Sheet) |
| `npm test` | Pruebas automáticas del backend |
| `npm run publicar` | Pruebas, luego backend y app en línea (**Ctrl + Shift + B**) |
| `npm run publicar -- -m "Agrego mesa 3"` | Lo mismo, con una descripción del cambio |
| `npm run publicar:backend` | Solo Apps Script |
| `npm run publicar:frontend` | Solo la app (GitHub Pages) |
| `npm run configurar` | Volver a conectar (otro PC u otro proyecto de Apps Script) |
| `npm run e2e` | Prueba completa en navegador (la primera vez: `npx playwright install chromium`) |

Todas están también en **Terminal → Ejecutar tarea…** con el prefijo *MULAN:*.

**Después de publicar**, los dispositivos instalados toman la nueva versión al cerrar y volver a abrir la app.

**Si cambias de computador**: instala los programas (paso 1), clona el repositorio desde VS Code (**Control de código fuente → Clonar repositorio**), y ejecuta `npm install`, `npx clasp login` y `npm run configurar` (presiona Enter para mantener el proyecto guardado).

---

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `'npm' no se reconoce…` | Cierra y abre VS Code. Si sigue, reinstala Node.js LTS |
| `…la ejecución de scripts está deshabilitada…` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `User has not enabled the Apps Script API` | Paso 3, y espera un par de minutos |
| `clasp no ha iniciado sesión` | `npx clasp login` con la cuenta del negocio |
| `No se pudo acceder al proyecto` | La sesión de clasp no es la dueña del Sheet: `npx clasp logout` y luego `npx clasp login` con la cuenta correcta |
| La app muestra *"Falta la hoja…"* | No se ejecutó `setup()` (paso 5.7) |
| GitHub Pages da error 404 | Revisa que **Source = GitHub Actions** (paso 7) y que el flujo en **Actions** esté en verde. Puedes reintentarlo con **Run workflow** |
| `No se pudo subir a GitHub … rejected` | Hubo cambios hechos desde la web de GitHub: ejecuta `git pull` y publica de nuevo |
| La app sigue mostrando la versión anterior | Cierra la app por completo y ábrela de nuevo, o recarga con **Ctrl + Shift + R** |
| Pantalla *"Esta aplicación fue creada por otro usuario"* al abrir la URL `/exec` directamente | Es normal: esa URL es la API, no la app. La app es la dirección de GitHub Pages |

---

## Qué no subir ni compartir

* El archivo de sesión de clasp (`C:\Users\TU_USUARIO\.clasprc.json`) da acceso a tu cuenta de Google. **No lo copies ni lo compartas.** No está dentro del proyecto, así que nunca se sube a GitHub.
* `mulan.config.json` y `backend/.clasp.json` sí se suben. Solo contienen identificadores del proyecto, no claves.
