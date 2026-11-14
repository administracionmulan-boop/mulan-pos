// Configuración del negocio: datos del comprobante, impuestos, mesas, medios de pago y topes.
import * as api from '../api.js';
import { $, esc, toast, formData, validar, errorMsg } from '../ui.js';

export async function render(root, app) {
  const cat = await app.catalogo(true);
  const c = cat.config;
  const campo = (k, label, attrs = '') => `<label>${label}<input name="${k}" value="${esc(c[k] ?? '')}" ${attrs}></label>`;
  root.innerHTML = `<form class="card form" id="fc" style="max-width:860px">
    <h3>Datos del negocio (comprobante)</h3>
    <div class="row">${campo('negocio_nombre', 'Nombre', 'required')}${campo('negocio_nit', 'NIT')}</div>
    <div class="row">${campo('negocio_direccion', 'Dirección')}${campo('negocio_telefono', 'Teléfono')}</div>
    ${campo('mensaje_comprobante', 'Mensaje al pie del comprobante')}
    <h3>Impuestos</h3>
    <div class="row">${campo('impuesto_nombre', 'Nombre del impuesto')}${campo('impuesto_pct', 'Porcentaje incluido en el precio (0 = no aplica)', 'type="number" min="0" max="100" step="any"')}</div>
    <p class="muted small" style="margin:0">Los precios de los productos incluyen el impuesto; el comprobante muestra el valor discriminado. Este comprobante es interno y no reemplaza la factura electrónica DIAN.</p>
    <h3>Operación</h3>
    ${campo('mesas', 'Mesas (separadas por coma)', 'placeholder="Mesa 1,Mesa 2"')}
    ${campo('metodos_pago', 'Medios de pago (separados por coma; EFECTIVO es obligatorio)')}
    ${campo('turnos', 'Turnos de caja (separados por coma)')}
    <div class="row">${campo('max_descuento_cajero', 'Descuento máximo sin autorización (%)', 'type="number" min="0" max="100"')}${campo('domicilio_valor', 'Valor sugerido del domicilio', 'type="number" min="0"')}</div>
    <div><button class="btn btn-primary btn-lg">Guardar configuración</button></div>
  </form>`;
  $('#fc').onsubmit = async (e) => {
    e.preventDefault();
    if (!validar(e.target)) return;
    const d = formData(e.target);
    d.metodos_pago = d.metodos_pago.split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
    if (!d.metodos_pago.includes('EFECTIVO')) d.metodos_pago.unshift('EFECTIVO');
    d.metodos_pago = d.metodos_pago.join(',');
    try {
      await api.call('config.guardar', d);
      await api.catalogo(true);
      toast('Configuración guardada');
    } catch (err) { toast(errorMsg(err), 'error'); }
  };
}
