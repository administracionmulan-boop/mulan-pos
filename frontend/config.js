// Configuración de despliegue de MULAN POS.
// API_PRODUCCION la escribe automáticamente "npm run publicar" (URL /exec de la aplicación web de Apps Script).
// En el computador de desarrollo (localhost) se usa el servidor local simulado.
const API_PRODUCCION = 'https://script.google.com/macros/s/AKfycbxYL6hAXyE_ZOd0Ufk4g3FdWhBbZo9ap9gICX5X-bjuq9yABE1SS2BwMzmEuxLoYeIa/exec';

window.MULAN_CONFIG = {
  API_URL: /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !API_PRODUCCION ? '/api' : API_PRODUCCION
};
