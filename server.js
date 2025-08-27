// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// === Persistencia (Render) ===
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const PORT = process.env.PORT || 3000;

// --- Middlewares base ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1); // detrás del proxy de Render

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'cambia-este-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 h
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', // true en Render (HTTPS)
    },
  })
);

// --- Frontend estático ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// --- DB: SQLite ---
const db = new Database(path.join(DATA_DIR, 'db.sqlite'));
db.pragma('journal_mode = wal');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Auth helper ---
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  next();
}

// --- API ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ ok: false, error: 'USUARIO_YA_EXISTE' });

    const password_hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, password_hash);

    res.json({ ok: true, msg: 'REGISTRADO' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });

    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    req.session.user = { id: user.id, username: user.username };
    req.session.role = null;

    res.json({ ok: true, msg: 'LOGIN_OK' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

app.get('/api/session', (req, res) => {
  if (!req.session.user) return res.json({ ok: true, loggedIn: false });
  res.json({ ok: true, loggedIn: true, user: req.session.user, role: req.session.role || null });
});

app.post('/api/choose-role', requireAuth, (req, res) => {
  const { role } = req.body || {};
  if (!['administrativos', 'supervisores'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'ROL_INVALIDO' });
  }
  req.session.role = role;
  res.json({ ok: true, role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Páginas (si existen los HTML en /public) ---
app.get('/dashboard', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);
app.get('/supervisor', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'supervisor.html'))
);

// --- Healthcheck opcional (útil en PaaS) ---
app.get('/healthz', (_req, res) => res.send('ok'));

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});
