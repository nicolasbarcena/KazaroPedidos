
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// Persistencia
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const PUBLIC_DIR = path.join(__dirname, 'public'); 
const PORT = process.env.PORT || 3000;

// Middlewares base 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'cambia-este-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// Logger simple
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Frontend estático 
app.use(express.static(PUBLIC_DIR));

// Home explícita
app.get('/', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('NO ENCONTRADO:', indexPath);
    return res.status(500).send('Falta public/index.html en el deploy');
  }
  res.sendFile(indexPath);
});

// Páginas
app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/admin',     (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/supervisor',(_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supervisor.html')));

// lista lo que Render ve en /public
app.get('/__debug', (_req, res) => {
  const exists = fs.existsSync(PUBLIC_DIR);
  const files = exists ? fs.readdirSync(PUBLIC_DIR) : [];
  res.json({ publicDir: PUBLIC_DIR, exists, files });
});

// DB SQLite 
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

// Auth helper 
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  next();
}

// API
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

// Healthcheck y errores
app.get('/healthz', (_req, res) => res.send('ok'));
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
  console.log('PUBLIC_DIR:', PUBLIC_DIR, 'index.html exists:', fs.existsSync(path.join(PUBLIC_DIR, 'index.html')));
});
