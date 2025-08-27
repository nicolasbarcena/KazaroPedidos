// server.js
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
    secret: 'cambia-este-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  })
);

// --- DB: SQLite
const db = new Database(path.join(__dirname, 'db.sqlite'));
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

    const exists = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);

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

    const user = db
      .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
      .get(username);

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

// --- Páginas protegidas (pueden ser estáticas, validación en front)
app.get('/admin', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/supervisor', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'supervisor.html'));
});

// --- Dashboard (protección en front)
app.get('/dashboard', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// --- Inicio
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
