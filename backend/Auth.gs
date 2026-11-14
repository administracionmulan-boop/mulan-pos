/**
 * MULAN POS - Usuarios, sesiones y permisos.
 * Roles: ADMIN (todo) y CAJERO (ventas, caja propia, consulta de inventario).
 */
var ROLES = ['ADMIN', 'CAJERO'];
var SESION_DIAS = 30; // larga para permitir trabajo sin conexión en tabletas

var Auth = {
  hash_: function (pwd, salt) {
    var h = salt + ':' + pwd;
    for (var i = 0; i < 50; i++) h = sha256_(h + salt);
    return h;
  },

  crearUsuario_: function (d) {
    req_(d, ['nombre', 'usuario', 'rol', 'password']);
    var usuario = str_(d.usuario).toLowerCase();
    if (ROLES.indexOf(d.rol) < 0) throw AppError('Rol inválido');
    if (Db.find('Usuarios', usuario, 'usuario')) throw AppError('El usuario "' + usuario + '" ya existe');
    var salt = uuid_();
    return Db.insert('Usuarios', {
      id: uuid_(), nombre: str_(d.nombre), usuario: usuario, rol: d.rol,
      salt: salt, hash: Auth.hash_(String(d.password), salt),
      pin_hash: d.pin ? Auth.hash_('PIN' + d.pin, salt) : '',
      activo: true, debe_cambiar: d.debe_cambiar !== false, creado: fecha_()
    });
  },

  publico: function (u) {
    return { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, activo: u.activo, debe_cambiar: u.debe_cambiar, tiene_pin: !!u.pin_hash };
  },

  login: function (d) {
    req_(d, ['usuario', 'password']);
    var u = Db.find('Usuarios', str_(d.usuario).toLowerCase(), 'usuario');
    if (!u || !u.activo || u.hash !== Auth.hash_(String(d.password), u.salt)) {
      throw AppError('Usuario o clave incorrectos', 401);
    }
    var token = uuid_() + uuid_().replace(/-/g, '');
    var exp = new Date(Date.now() + SESION_DIAS * 86400000);
    Db.insert('Sesiones', { token: token, usuario_id: u.id, creado: fecha_(), expira: fecha_(exp), dispositivo: str_(d.dispositivo).substring(0, 120) });
    // limpieza de sesiones vencidas
    var ahora = fecha_();
    Db.removeWhere('Sesiones', function (s) { return s.expira < ahora; });
    auditar_(u, 'LOGIN', 'Usuarios', u.id, d.dispositivo || '');
    return { token: token, usuario: Auth.publico(u) };
  },

  check: function (token) {
    if (!token) throw AppError('Sesión requerida', 401);
    var cache = CacheService.getScriptCache();
    var uid = cache.get('ses_' + token);
    if (!uid) {
      var s = Db.find('Sesiones', token, 'token');
      if (!s || s.expira < fecha_()) throw AppError('Sesión vencida, ingrese de nuevo', 401);
      uid = s.usuario_id;
      cache.put('ses_' + token, uid, 21600);
    }
    var u = Db.find('Usuarios', uid);
    if (!u || !u.activo) throw AppError('Usuario inactivo', 401);
    return u;
  },

  logout: function (d, user, req) {
    CacheService.getScriptCache().remove('ses_' + req.token);
    Db.removeWhere('Sesiones', function (s) { return s.token === req.token; });
    return true;
  },

  cambiarClave: function (d, user) {
    req_(d, ['actual', 'nueva']);
    if (user.hash !== Auth.hash_(String(d.actual), user.salt)) throw AppError('La clave actual no es correcta');
    if (String(d.nueva).length < 6) throw AppError('La nueva clave debe tener al menos 6 caracteres');
    var patch = { hash: Auth.hash_(String(d.nueva), user.salt), debe_cambiar: false };
    if (d.pin) {
      if (!/^\d{4,6}$/.test(String(d.pin))) throw AppError('El PIN debe tener de 4 a 6 dígitos');
      patch.pin_hash = Auth.hash_('PIN' + d.pin, user.salt);
    }
    Db.update('Usuarios', user.id, patch);
    auditar_(user, 'CAMBIO_CLAVE', 'Usuarios', user.id, '');
    return Auth.publico(Db.find('Usuarios', user.id));
  },

  /**
   * Autorización de un administrador para operaciones sensibles (anulaciones, devoluciones, descuentos altos).
   * Si quien opera ya es ADMIN no se pide PIN. Devuelve el usuario que autoriza.
   */
  autorizar: function (aut, user) {
    if (user && user.rol === 'ADMIN') return user;
    if (!aut || !aut.usuario || !aut.pin) throw AppError('Se requiere autorización de un administrador (usuario y PIN)', 403);
    var a = Db.find('Usuarios', str_(aut.usuario).toLowerCase(), 'usuario');
    if (!a || !a.activo || a.rol !== 'ADMIN' || !a.pin_hash || a.pin_hash !== Auth.hash_('PIN' + aut.pin, a.salt)) {
      throw AppError('Autorización rechazada: usuario o PIN de administrador incorrecto', 403);
    }
    return a;
  },

  // ---- administración de usuarios ----
  listar: function () {
    return Db.all('Usuarios').map(Auth.publico);
  },

  guardar: function (d, user) {
    if (!d.id) {
      if (!d.password) throw AppError('Asigne una clave inicial');
      var nu = Auth.crearUsuario_({ nombre: d.nombre, usuario: d.usuario, rol: d.rol, password: d.password, pin: d.pin, debe_cambiar: true });
      auditar_(user, 'CREAR', 'Usuarios', nu.id, nu.usuario);
      return Auth.publico(nu);
    }
    var u = Db.find('Usuarios', d.id);
    if (!u) throw AppError('Usuario no encontrado', 404);
    var patch = {};
    if (d.nombre) patch.nombre = str_(d.nombre);
    if (d.rol) {
      if (ROLES.indexOf(d.rol) < 0) throw AppError('Rol inválido');
      patch.rol = d.rol;
    }
    if (d.activo !== undefined) patch.activo = !!d.activo;
    if (u.id === user.id && (patch.activo === false || (patch.rol && patch.rol !== 'ADMIN'))) {
      throw AppError('No puede desactivarse ni quitarse el rol de administrador a sí mismo');
    }
    if (d.password) {
      if (String(d.password).length < 6) throw AppError('La clave debe tener al menos 6 caracteres');
      patch.hash = Auth.hash_(String(d.password), u.salt);
      patch.debe_cambiar = true;
    }
    if (d.pin) {
      if (!/^\d{4,6}$/.test(String(d.pin))) throw AppError('El PIN debe tener de 4 a 6 dígitos');
      patch.pin_hash = Auth.hash_('PIN' + d.pin, u.salt);
    }
    Db.update('Usuarios', u.id, patch);
    if (patch.activo === false) {
      Db.removeWhere('Sesiones', function (s) { return s.usuario_id === u.id; });
    }
    auditar_(user, 'EDITAR', 'Usuarios', u.id, Object.keys(patch).filter(function (k) { return k !== 'hash' && k !== 'pin_hash'; }).join(','));
    return Auth.publico(Db.find('Usuarios', u.id));
  }
};
