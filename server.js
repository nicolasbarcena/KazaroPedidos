// server.js
const fs = require('fs');                    // [Render] nuevo
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// [Render] carpeta persistente para DB/sesiones (se crea sola)
// Si definís DATA_DIR en Render y montás un Disk a ese path, los datos persisten entre deploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = process.env.PORT || 3000;

// --- Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// [Render] atrás de un proxy (HTTPS), necesario si usás cookie "secure"
app.set('trust proxy', 1);

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }), // [Render] dir -> DATA_DIR
    secret: process.env.SESSION_SECRET || 'cambia-este-secreto',       // [Render] toma de env
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', // [Render] true en prod (HTTPS), false local
    },
  })
);

// --- DB: SQLite
const db = new Database(path.join(DATA_DIR, 'db.sqlite')); // [Render] DB en DATA_DIR
db.pragma('journal_mode = wal');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Helpers de auth
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  next();
}

// --- Rutas estáticas (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// --- API: Registro
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      return res.status(409).json({ ok: false, error: 'USUARIO_YA_EXISTE' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, password_hash);

    return res.json({ ok: true, msg: 'REGISTRADO' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

// --- API: Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });
    }

    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    // guardar sesión
    req.session.user = { id: user.id, username: user.username };
    req.session.role = null;

    return res.json({ ok: true, msg: 'LOGIN_OK' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

// --- API: Estado de sesión
app.get('/api/session', (req, res) => {
  if (!req.session.user) return res.json({ ok: true, loggedIn: false });
  return res.json({
    ok: true,
    loggedIn: true,
    user: req.session.user,
    role: req.session.role || null,
  });
});

// --- API: Elegir rol
app.post('/api/choose-role', requireAuth, (req, res) => {
  const { role } = req.body || {};
  if (!['administrativos', 'supervisores'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'ROL_INVALIDO' });
  }
  req.session.role = role;
  return res.json({ ok: true, role });
});

// --- API: Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Páginas (servidas por Express)
app.get('/admin', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/supervisor', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'supervisor.html'));
});
app.get('/dashboard', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- Inicio
app.listen(PORT, '0.0.0.0', () => {            // [Render] escucha en 0.0.0.0
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});
