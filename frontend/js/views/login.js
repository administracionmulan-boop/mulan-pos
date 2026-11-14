import { call } from '../api.js';
import { $, toast, errorMsg, formData } from '../ui.js';

export function render(root, { onLogin }) {
  root.innerHTML = `
    <div class="login">
      <div class="login-brand">
        <img src="assets/logo.png" alt="Logo MULAN">
        <h1>MUL<span>A</span>N</h1>
        <p>Punto de venta</p>
      </div>
      <div class="login-form">
        <form class="form card" id="login-form" autocomplete="on">
          <h2>Ingresar</h2>
          <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" required></label>
          <label>Clave<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar</button>
          <p class="muted small" id="login-msg"></p>
        </form>
      </div>
    </div>`;
  const form = $('#login-form');
  setTimeout(() => form.usuario.focus(), 50);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    btn.textContent = 'Ingresando…';
    try {
      const f = formData(form);
      const s = await call('auth.login', { ...f, dispositivo: navigator.userAgent.substring(0, 120) });
      onLogin(s);
    } catch (err) {
      toast(errorMsg(err), 'error');
      $('#login-msg').textContent = err.offline ? 'Se necesita internet para iniciar sesión por primera vez en este dispositivo.' : '';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };
}
