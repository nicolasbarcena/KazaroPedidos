// server.js — Render (free) + Postgres (Neon) + cookie-session + no-cache en dev
const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcrypt');              // si prefieres 0 nativos: usa 'bcryptjs'
const cookieSession = require('cookie-session');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

/* =========================
   Validación de entorno
   ========================= */
if (!process.env.DATABASE_URL) {
  console.error('❌ Falta la variable de entorno DATABASE_URL');
  process.exit(1);
}
const DB_URL = process.env.DATABASE_URL.trim();
// Asegura SSL con Neon/Supabase (si alguien pegó una URL sin sslmode)
const urlHasSSL = /\bsslmode=require\b/i.test(DB_URL);
const normalizedDbUrl = urlHasSSL
  ? DB_URL
  : DB_URL + (DB_URL.includes('?') ? '&' : '?') + 'sslmode=require';

function mask(str) {
  try {
    const u = new URL(str);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(no parseable)';
  }
}

/* =========================
   Pool PG
   ========================= */
const pool = new Pool({
  connectionString: normalizedDbUrl,
  // Neon requiere SSL; esta opción evita fallos por CA en PaaS
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// Crea esquema en arranque
async function ensureSchema() {
  console.log('🔗 Conectando a Postgres:', mask(normalizedDbUrl));
  const cx = await pool.connect(); // si falla, cae al catch de abajo
  try {
    await cx.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log('✅ Esquema OK');
  } finally {
    cx.release();
  }
}

/* =========================
   Middlewares base
   ========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// Sesión basada en cookie (nada en servidor)
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret'],
  maxAge: 1000 * 60 * 60 * 8,     // 8 horas
  sameSite: 'lax',
  secure: IS_PROD,
}));

// Logs útiles (Render y local)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* =========================
   Frontend estático
   ========================= */
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * MUY IMPORTANTE:
 * Sirve /sw.js con no-store SIEMPRE para que el navegador
 * no lo cachee y tome la versión nueva tras cada deploy.
 * Esta ruta debe ir ANTES del express.static.
 */
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

/**
 * En desarrollo (NODE_ENV !== 'production'), desactiva caché
 * de todo el contenido estático para ver cambios al instante.
 */
if (!IS_PROD) {
  app.use(express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }));
} else {
  app.use(express.static(PUBLIC_DIR));
}

/** Rutas HTML */
app.get('/', (_req, res) => {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file)) return res.status(500).send('Falta public/index.html');
  res.sendFile(file);
});
app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/admin',     (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/supervisor',(_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supervisor.html')));

/* =========================
   Helpers
   ========================= */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  next();
}

/* =========================
   API
   ========================= */
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });

    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rowCount) return res.status(409).json({ ok: false, error: 'USUARIO_YA_EXISTE' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);

    res.json({ ok: true, msg: 'REGISTRADO' });
  } catch (e) {
    console.error('register error:', e);
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

    req.session.user = { id: user.id, username: user.username };
    req.session.role = null;

    res.json({ ok: true, msg: 'LOGIN_OK' });
  } catch (e) {
    console.error('login error:', e);
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
  req.session = null;
  res.json({ ok: true });
});

/* =========================
   Salud / Debug / Errores
   ========================= */
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/__debug', async (_req, res) => {
  let users = 0;
  try { const r = await pool.query('SELECT COUNT(*) FROM users'); users = Number(r.rows[0].count); } catch {}
  res.json({ publicDir: PUBLIC_DIR, hasDbUrl: !!process.env.DATABASE_URL, users });
});

// Evita que /api/* desconocidas caigan al index
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
});

/* =========================
   Arranque
   ========================= */
ensureSchema()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor escuchando en http://0.0.0.0:${PORT}`);
  }))
  .catch(err => {
    console.error('❌ No se pudo inicializar DB:', err);
    process.exit(1);
  });

