// public/main.js
// ========= Utilidades de "Recordar" en el navegador =========
const STORAGE_KEY = 'loginapp_credentials';

function saveRemembered(username, password) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ username, password }));
}
function getRemembered() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}
function clearRemembered() {
  localStorage.removeItem(STORAGE_KEY);
}

// ================== App ==================
document.addEventListener('DOMContentLoaded', () => {
  // ---------- Elementos comunes (dashboard y demás) ----------
  const who = document.getElementById('who');
  const btnAdmin = document.getElementById('btnAdmin');
  const btnSupervisor = document.getElementById('btnSupervisor');
  const btnLogout = document.getElementById('btnLogout');

  // ---------- Página de acceso (form unificado) ----------
  const authForm = document.getElementById('authForm');            // único formulario
  const modeButtons = document.querySelectorAll('[data-mode]');    // botones "Iniciar sesión" / "Crear cuenta"
  const rememberWrap = document.getElementById('rememberWrap');    // contenedor del "Recordar"
  const rememberChk = document.getElementById('remember');         // checkbox "Recordar"
  const formTitle = document.getElementById('formTitle');          // <h2> del formulario
  const submitBtn = document.getElementById('submitBtn');          // botón submit

  let authMode = 'login'; // 'login' | 'register'

  function setMode(mode) {
    authMode = mode;

    if (formTitle) formTitle.textContent = (mode === 'login') ? 'Inicio de sesión' : 'Crear cuenta';
    if (submitBtn) submitBtn.textContent = (mode === 'login') ? 'Ingresar' : 'Crear cuenta';

    // Mostrar "Recordar" sólo en login
    if (rememberWrap) rememberWrap.style.display = (mode === 'login') ? 'flex' : 'none';

    // Marcar botón activo (opcional)
    modeButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // Listeners del conmutador
  if (modeButtons.length) {
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
  }

  // Submit del formulario unificado
  if (authForm) {
    setMode('login'); // arranca en login por defecto

    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const username = document.getElementById('authUser')?.value.trim();
      const password = document.getElementById('authPass')?.value;

      if (!username || !password) {
        alert('Completá usuario y contraseña.');
        return;
      }

      const endpoint = (authMode === 'login') ? '/api/login' : '/api/register';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!data.ok) {
          alert((authMode === 'login' ? 'Login fallido: ' : 'Error en registro: ') + (data.error || 'Desconocido'));
          return;
        }

        if (authMode === 'login') {
          if (rememberChk && rememberChk.checked) {
            saveRemembered(username, password);
          }
          window.location.href = '/dashboard';
        } else {
          // Registro OK -> pasar a login
          alert('Usuario registrado. Ahora iniciá sesión.');
          setMode('login');
          document.getElementById('authUser')?.focus();
        }
      } catch (err) {
        console.error(err);
        alert('Error de red/servidor.');
      }
    });
  }

  // ---------- Página dashboard: elegir rol ----------
  if (who || btnAdmin || btnSupervisor) {
    fetch('/api/session')
      .then(r => r.json())
      .then(s => {
        if (!s.loggedIn) {
          window.location.href = '/';
          return;
        }
        if (who) who.textContent = `Usuario: ${s.user.username}`;
      });

    if (btnAdmin) {
      btnAdmin.addEventListener('click', async () => {
        const res = await fetch('/api/choose-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'administrativos' })
        });
        const data = await res.json();
        if (data.ok) window.location.href = '/admin';
      });
    }

    if (btnSupervisor) {
      btnSupervisor.addEventListener('click', async () => {
        const res = await fetch('/api/choose-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'supervisores' })
        });
        const data = await res.json();
        if (data.ok) window.location.href = '/supervisor';
      });
    }
  }

  // ---------- Logout (si existe el botón) ----------
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }
});
