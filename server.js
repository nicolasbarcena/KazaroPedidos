// server.js (para Render free, sin disco, con Postgres externo)
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcrypt');
const cookieSession = require('cookie-session');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ======= DB: Postgres externo (Neon/Supabase/ElephantSQL) =======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // <-- la pones en Render
  // Para proveedores que requieren SSL (Neon, Supabase):
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Creamos tabla si no existe
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}

// ======= Middlewares base =======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Sesión basada en cookies (no guarda nada en servidor)
app.use(
  cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'dev-secret'],
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // true en Render
  })
);

// Logs simples (útil en Render)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ======= Frontend estático =======
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file)) return res.status(500).send('Falta public/index.html');
  res.sendFile(file);
});

app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/admin',     (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/supervisor',(_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supervisor.html')));

// ======= Helpers =======
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  next();
}

// ======= API =======
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });

    const userExists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userExists.rowCount) return res.status(409).json({ ok: false, error: 'USUARIO_YA_EXISTE' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);

    res.json({ ok: true, msg: 'REGISTRADO' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });

    const q = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
    if (!q.rowCount) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'CREDENCIALES' });

    // Guardamos datos mínimos en la cookie
    req.session.user = { id: user.id, username: user.username };
    req.session.role = null;

    res.json({ ok: true, msg: 'LOGIN_OK' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

app.get('/api/session', (req, res) => {
  if (!req.session || !req.session.user) return res.json({ ok: true, loggedIn: false });
  res.json({ ok: true, loggedIn: true, user: req.session.user, role: req.session.role ?? null });
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
  req.session = null; // borra cookie
  res.json({ ok: true });
});

// ======= Salud y Debug =======
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/__debug', async (_req, res) => {
  let users = 0;
  try {
    const r = await pool.query('SELECT COUNT(*) FROM users');
    users = Number(r.rows[0].count);
  } catch {}
  res.json({ publicDir: PUBLIC_DIR, hasDbUrl: !!process.env.DATABASE_URL, users });
});

// ======= Arranque =======
ensureSchema()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
  }))
  .catch(err => {
    console.error('No se pudo inicializar DB', err);
    process.exit(1);
  });
