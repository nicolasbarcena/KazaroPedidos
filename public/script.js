/* ---------------------------------------------------------
   Catálogo + Remito + Email + Filtro por Servicio (JSON)
   --------------------------------------------------------- */

/* ============= EmailJS (opcional) ============= */
const EMAILJS_PUBLIC_KEY = "g94YTgSjLp2km1bcS";
const SERVICE_ID_EMAILJS = "service_40ttmon";
const TEMPLATE_ID = "template_462n4v4";

if (typeof emailjs !== "undefined") {
  try { emailjs.init(EMAILJS_PUBLIC_KEY); } catch {}
}

/* ============= Estado de la App ============= */
let carrito = [];
let remitoActual = null;

const productosPorPagina = 15;
let productos = [];

/* ============= Origen de datos ============= */
// Google Sheet (CSV)
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1HKNgbMYLHPpw8c9y7D9ENdWsTy2CPTFjhENiTSlIkMc/export?format=csv&gid=0";
// Políticas por servicio/supervisor
const SERVICE_DATA_URL = "/data/supervisores.json";

/* ============= Parámetros de URL ============= */
const urlParams = new URLSearchParams(location.search);
const SERVICE_ID = urlParams.get("service");         // ej: MS-OLIVA
const SUPERVISOR_NAME = urlParams.get("supervisor"); // opcional

/* ================= Utilidades ================= */
const $ = (q) => document.querySelector(q);
const toNum = (x, d=0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
const toInt = (x, d=0) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : d; };

/* ========== Cargar política (supervisores.json) ========== */
async function loadServicePolicy(serviceId) {
  if (!serviceId) return { ok:false, name:null, filter: (p)=>true, expectedCodes: new Set(), mode:"allow" };

  let data;
  // 1) embebido (por si lo pegás en el HTML)
  const embedded = document.getElementById('supervisores-data');
  if (embedded) {
    try { data = JSON.parse(embedded.textContent); } catch {}
  }
  // 2) archivo
  if (!data) {
    const res = await fetch(SERVICE_DATA_URL);
    if (!res.ok) throw new Error("No pude cargar supervisores.json");
    data = await res.json();
  }

  // Buscar servicio
  let servicio = null, supervisor = null;
  for (const sup of data.supervisores || []) {
    const sv = (sup.servicios || []).find(s => s.id === serviceId);
    if (sv) { servicio = sv; supervisor = sup; break; }
  }
  if (!servicio) {
    console.warn("Servicio no encontrado en JSON:", serviceId);
    return { ok:false, name:null, filter: (p)=>true, expectedCodes: new Set(), mode:"allow" };
  }

  const mode = (servicio.modo || "allow").toLowerCase(); // "allow" o "deny"
  const porCodigos    = new Set((servicio.insumos?.porCodigos || []).map(String));
  const porCategorias = new Set((servicio.insumos?.porCategorias || []).map(String));

  // Compilar función filtro
  let filter;
  if (mode === "deny") {
    filter = (p) => {
      const byCode = porCodigos.size    ? porCodigos.has(String(p.code)) : false;
      const byCat  = porCategorias.size ? porCategorias.has(String(p.category)) : false;
      return !(byCode || byCat);
    };
  } else {
    if (porCodigos.size === 0 && porCategorias.size === 0) {
      filter = (p) => true;
    } else {
      filter = (p) => {
        const byCode = porCodigos.size    ? porCodigos.has(String(p.code)) : false;
        const byCat  = porCategorias.size ? porCategorias.has(String(p.category)) : false;
        return byCode || byCat;
      };
    }
  }

  return {
    ok: true,
    name: servicio.nombre || serviceId,
    supervisor: supervisor?.nombre || SUPERVISOR_NAME || null,
    filter,
    expectedCodes: porCodigos,
    mode
  };
}

/* ========== Cargar productos de la hoja + aplicar política ========== */
async function cargarProductos() {
  // 1) Cargar política
  const policy = await loadServicePolicy(SERVICE_ID).catch(err => {
    console.error(err);
    alert('No pude cargar supervisores.json');
    return { ok:false, name:null, filter:(p)=>true, expectedCodes:new Set(), mode:"allow" };
  });

  // 2) Leer hoja (CSV)
  let all = [];
  try {
    const res = await fetch(SHEET_URL);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    all = (parsed.data || []).map(p => ({
      code: (p.code || "").trim(),
      description: (p.description || "").trim(),
      category: (p.category || "").trim(),
      price: toNum(p.price || 0, 0),
      stock: toInt(p.stock || 0, 0)
    }));
  } catch (err) {
    console.error("Error cargando productos desde Google Sheets:", err);
    alert("No se pudieron cargar los productos.");
  }

  // 3) Aplicar filtro de política
  productos = all.filter(policy.filter);

  // 4) Diagnóstico: códigos listados pero no presentes en la hoja
  if (policy.ok && policy.expectedCodes.size) {
    const codesInSheet = new Set(all.map(p => String(p.code)));
    const faltantes = [...policy.expectedCodes].filter(c => !codesInSheet.has(c));
    if (faltantes.length) {
      console.warn("Códigos listados en JSON pero NO presentes en la hoja:", faltantes);
    }
  }

  // 5) Banner opcional
  const info = $("#filtroInfo");
  if (policy.ok && info) {
    info.innerHTML = `
      <div style="padding:10px 12px; border-radius:10px; background:#f1f5ff; color:#223; margin:12px 0;">
        Filtrado por servicio: <strong>${policy.name}</strong>
        ${policy.supervisor ? ` (Supervisor: ${policy.supervisor})` : ""}
        — <em>modo ${policy.mode === "deny" ? "lista negra" : "lista blanca"}</em>.
        <br>Productos visibles: <strong>${productos.length}</strong>.
      </div>
    `;
  }

  console.log("Productos totales en hoja:", all.length, " | visibles:", productos.length);
}

/* =================== Catálogo =================== */
function mostrarProductos(categoria, pagina = 1) {
  const cont = $("#productos");
  if (!cont) return;
  cont.innerHTML = "";

  const filtrados = productos.filter(p => p.category === categoria);
  if (filtrados.length === 0) {
    cont.innerHTML = "<p>No hay productos en esta categoría.</p>";
    return;
  }

  const inicio = (pagina - 1) * productosPorPagina;
  const fin = inicio + productosPorPagina;
  const page = filtrados.slice(inicio, fin);

  page.forEach(prod => {
    const div = document.createElement("div");
    div.classList.add("producto");
    div.innerHTML = `
      <h3>${prod.description}</h3>
      <p><strong>Código:</strong> ${prod.code}</p>
      <p><strong>Precio:</strong> $${toNum(prod.price).toFixed(2)}</p>
      <p>Stock: <span id="stock-${prod.code}">${toInt(prod.stock)}</span></p>
      <button id="btn-${prod.code}" ${prod.stock <= 0 ? "disabled" : ""}
        onclick="agregarAlCarrito('${prod.code}','${prod.description}',${toNum(prod.price)})">
        Agregar
      </button>
    `;
    cont.appendChild(div);
  });

  const pag = document.createElement("div");
  pag.classList.add("paginacion");
  if (pagina > 1) {
    const prev = document.createElement("button");
    prev.textContent = "⬅ Anterior";
    prev.onclick = () => mostrarProductos(categoria, pagina - 1);
    pag.appendChild(prev);
  }
  if (fin < filtrados.length) {
    const next = document.createElement("button");
    next.textContent = "Siguiente ➡";
    next.onclick = () => mostrarProductos(categoria, pagina + 1);
    pag.appendChild(next);
  }
  cont.appendChild(pag);
}

/* =================== Carrito =================== */
window.agregarAlCarrito = function (code, description, price) {
  const producto = productos.find(p => p.code === code);
  if (!producto || producto.stock <= 0) {
    alert("Este producto no tiene stock disponible.");
    return;
    }
  let item = carrito.find(p => p.code === code);
  if (item) {
    if (item.cantidad < producto.stock) {
      item.cantidad++;
      item.subtotal = item.cantidad * item.price;
      producto.stock--;
    } else {
      alert(`Solo quedan ${producto.stock} unidades disponibles.`);
    }
  } else {
    carrito.push({ code, description, price, cantidad: 1, subtotal: price });
    producto.stock--;
  }

  const stockSpan = document.getElementById(`stock-${code}`);
  if (stockSpan) stockSpan.textContent = producto.stock;

  const btn = document.getElementById(`btn-${code}`);
  if (btn && producto.stock <= 0) btn.disabled = true;

  renderCarrito();
};

function renderCarrito() {
  const tbody = document.getElementById("carrito-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  carrito.forEach((it, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.code}</td>
      <td>${it.description}</td>
      <td><input type="number" min="1" value="${it.cantidad}" onchange="cambiarCantidad(${i}, this.value)"></td>
      <td>$${toNum(it.price).toFixed(2)}</td>
      <td>$${toNum(it.subtotal).toFixed(2)}</td>
      <td><button onclick="eliminarDelCarrito(${i})">❌</button></td>
    `;
    tbody.appendChild(tr);
  });

  const total = carrito.reduce((s, it) => s + it.subtotal, 0);
  const totalEl = document.getElementById("total");
  if (totalEl) totalEl.textContent = toNum(total).toFixed(2);
}

window.cambiarCantidad = function (i, cant) {
  cant = toInt(cant, 1);
  const prod = productos.find(p => p.code === carrito[i].code);
  if (!prod) return;

  if (cant > prod.stock + carrito[i].cantidad) {
    alert(`Stock insuficiente. Solo quedan ${prod.stock + carrito[i].cantidad} unidades.`);
    cant = prod.stock + carrito[i].cantidad;
  }

  const dif = cant - carrito[i].cantidad;
  prod.stock -= dif;

  carrito[i].cantidad = cant;
  carrito[i].subtotal = cant * carrito[i].price;

  const stockSpan = document.getElementById(`stock-${prod.code}`);
  if (stockSpan) stockSpan.textContent = prod.stock;
  const btn = document.getElementById(`btn-${prod.code}`);
  if (btn) btn.disabled = prod.stock <= 0;

  renderCarrito();
};

window.eliminarDelCarrito = function (i) {
  const it = carrito[i];
  const prod = productos.find(p => p.code === it.code);
  if (!prod) return;

  prod.stock += it.cantidad;

  const stockSpan = document.getElementById(`stock-${prod.code}`);
  if (stockSpan) stockSpan.textContent = prod.stock;
  const btn = document.getElementById(`btn-${prod.code}`);
  if (btn) btn.disabled = false;

  carrito.splice(i, 1);
  renderCarrito();
};

/* ================= Remito + Envío ================= */
function generarNumeroRemito() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `REM-${pad(d.getDate())}${pad(d.getMonth()+1)}${String(d.getFullYear()).slice(-2)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function finalizarPedido() {
  const cliente = document.getElementById("cliente")?.value.trim();
  if (!cliente) return alert("Ingrese nombre y apellido.");
  if (carrito.length === 0) return alert("El carrito está vacío.");

  remitoActual = {
    numero: generarNumeroRemito(),
    cliente,
    fecha: new Date().toLocaleString(),
    items: [...carrito],
    total: carrito.reduce((s, i) => s + i.subtotal, 0)
  };

  mostrarRemito(remitoActual);

  try {
    const res = await fetch("https://script.google.com/macros/s/AKfycbym93C9owPRg7Qh-f2SO83qfv_cEHoj0J87VUE6B3AKrXgMFkMVihtE5Q-SPrNXksTVDw/exec", {
      method: "POST",
      body: JSON.stringify({ items: carrito }),
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (data.success) {
      data.updated.forEach(u => {
        const stockSpan = document.getElementById(`stock-${u.code}`);
        if (stockSpan) stockSpan.textContent = u.stock;
        const btn = document.getElementById(`btn-${u.code}`);
        if (btn && u.stock <= 0) btn.disabled = true;
      });
    }
  } catch (err) {
    console.error("Error actualizando stock:", err);
  }
}

function mostrarRemito(r) {
  const div = document.getElementById("remito");
  const sec = document.getElementById("remito-section");
  if (!div || !sec) return;

  div.innerHTML = `
    <p><strong>Remito N°:</strong> ${r.numero}</p>
    <p><strong>Cliente:</strong> ${r.cliente}</p>
    <p><strong>Fecha:</strong> ${r.fecha}</p>
    <table>
      <thead>
        <tr><th>Código</th><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        ${r.items.map(i => `
          <tr>
            <td>${i.code}</td>
            <td>${i.description}</td>
            <td>${i.cantidad}</td>
            <td>$${toNum(i.price).toFixed(2)}</td>
            <td>$${toNum(i.subtotal).toFixed(2)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <h3>Total: $${toNum(r.total).toFixed(2)}</h3>
  `;
  sec.style.display = "block";
}

async function enviarEmail() {
  if (!remitoActual) return alert("No hay remito para enviar.");

  const detalleHTML = remitoActual.items.map(i => `
    <tr>
      <td style="border:1px solid #ddd; padding:6px;">${i.code}</td>
      <td style="border:1px solid #ddd; padding:6px;">${i.description}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:center;">${i.cantidad}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:right;">$${toNum(i.price).toFixed(2)}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:right;">$${toNum(i.subtotal).toFixed(2)}</td>
    </tr>`).join("");

  try {
    await emailjs.send(SERVICE_ID_EMAILJS, TEMPLATE_ID, {
      numero: remitoActual.numero,
      cliente: remitoActual.cliente,
      fecha: remitoActual.fecha,
      total: toNum(remitoActual.total).toFixed(2),
      detalle: detalleHTML
    });
    alert("Remito enviado con éxito.");
  } catch (err) {
    console.error("Error enviando email:", err);
    alert("Error al enviar el remito.");
  }
}

/* =============== Eventos de inicio =============== */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("finalizar")?.addEventListener("click", finalizarPedido);
  document.getElementById("enviar")?.addEventListener("click", enviarEmail);
  cargarProductos(); 
});
