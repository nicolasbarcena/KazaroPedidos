require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcrypt');
const cookieSession = require('cookie-session');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ============ DB: PG o SQLite (fallback) ============ */
let DB_MODE = 'sqlite'; // por defecto local
let pgPool = null;
let sqliteDb = null;

const usePostgres = !!process.env.DATABASE_URL;
if (usePostgres) {
  const { Pool } = require('pg');

  // Normaliza URL y fuerza SSL (Neon/Supabase)
  const DB_URL = process.env.DATABASE_URL.trim();
  const urlHasSSL = /\bsslmode=require\b/i.test(DB_URL);
  const normalizedDbUrl = urlHasSSL
    ? DB_URL
    : DB_URL + (DB_URL.includes('?') ? '&' : '?') + 'sslmode=require';

  pgPool = new Pool({
    connectionString: normalizedDbUrl,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  DB_MODE = 'pg';
  console.log('🗄️  DB: Postgres');
} else {
  const sqlite3 = require('sqlite3').verbose();
  const sqlitePath = path.join(__dirname, 'db.sqlite');
  sqliteDb = new sqlite3.Database(sqlitePath);
  DB_MODE = 'sqlite';
  console.log('🗄️  DB: SQLite ->', sqlitePath);
}

// Helpers de consulta
function pgQuery(sql, params = []) {
  return pgPool.query(sql, params); // { rows, rowCount }
}
function sqliteQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    const isSelect = /^\s*select/i.test(sql);
    if (isSelect) {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve({ rows, rowCount: rows.length });
      });
    } else {
      sqliteDb.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ rows: [], rowCount: this.changes });
      });
    }
  });
}
function dbQuery(sqlPg, sqlSqlite, params = []) {
  // Usa el SQL correspondiente según el motor
  if (DB_MODE === 'pg') return pgQuery(sqlPg, params);
  return sqliteQuery(sqlSqlite, params);
}

/* ============ Esquema ============ */
async function ensureSchema() {
  if (DB_MODE === 'pg') {
    console.log('🔗 Conectando a Postgres…');
  } else {
    console.log('🔗 Abriendo SQLite…');
  }

  // Tabla de usuarios
  const createUsersPG = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  const createUsersSQLITE = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `;

  await dbQuery(createUsersPG, createUsersSQLITE);

  console.log('✅ Esquema OK');
}

/* ============ Middlewares base ============ */
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret'],
  maxAge: 1000 * 60 * 60 * 8, // 8h
  sameSite: 'lax',
  secure: IS_PROD,
}));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ============ Estáticos ============ */
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

if (!IS_PROD) {
  app.use(express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    },
  }));
} else {
  app.use(express.static(PUBLIC_DIR));
}

/* ============ HTML directos (opcional) ============ */
app.get('/', (_req, res) => {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file)) return res.status(500).send('Falta public/index.html');
  res.sendFile(file);
});
app.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/admin',     (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/supervisor',(_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'supervisor.html')));

/* ============ Auth helper ============ */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ ok: false, error: 'NO_AUTH' });
  }
  next();
}

/* ============ API ============ */
// Registro
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });
    }

    const exists = await dbQuery(
      'SELECT id FROM users WHERE username = $1',
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    if (exists.rowCount) {
      return res.status(409).json({ ok: false, error: 'USUARIO_YA_EXISTE' });
    }

    const hash = await bcrypt.hash(password, 10);
    await dbQuery(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, hash]
    );

    res.json({ ok: true, msg: 'REGISTRADO' });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'FALTAN_DATOS' });
    }

    const q = await dbQuery(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username]
    );
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

// Sesión
app.get('/api/session', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json({ ok: true, loggedIn: false });
  }
  res.json({ ok: true, loggedIn: true, user: req.session.user, role: req.session.role ?? null });
});

// Elegir rol
app.post('/api/choose-role', requireAuth, (req, res) => {
  const { role } = req.body || {};
  if (!['administrativos', 'supervisores'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'ROL_INVALIDO' });
  }
  req.session.role = role;
  res.json({ ok: true, role });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

/* ============ Salud / Debug ============ */
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/__debug', async (_req, res) => {
  let users = 0;
  try {
    const r = await dbQuery('SELECT COUNT(*) FROM users', 'SELECT COUNT(*) as count FROM users');
    users = Number(r.rows[0].count);
  } catch {}
  res.json({
    publicDir: PUBLIC_DIR,
    dbMode: DB_MODE,
    hasDbUrl: !!process.env.DATABASE_URL,
    users
  });
});

// 404 para /api desconocidas
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));

// Handler de errores
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ ok: false, error: 'ERROR_SERVER' });
});

/* ============ Arranque ============ */
ensureSchema()
  .then(() => app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
  }))
  .catch(err => {
    console.error('❌ No se pudo inicializar DB:', err);
    process.exit(1);
  });


