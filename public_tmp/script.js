// EmailJS 
const EMAILJS_PUBLIC_KEY = "g94YTgSjLp2km1bcS";
const SERVICE_ID = "service_40ttmon";
const TEMPLATE_ID = "template_462n4v4";

emailjs.init(EMAILJS_PUBLIC_KEY);

// Variables
let carrito = [];
let remitoActual = null;


let paginaActual = 1;
const productosPorPagina = 15;

// URL  de Google Sheets como CSV
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1HKNgbMYLHPpw8c9y7D9ENdWsTy2CPTFjhENiTSlIkMc/export?format=csv&gid=0";

let productos = [];

// Convierte CSV a array de objetos
function csvToJSON(csvText) {
  const rows = csvText.trim().split("\n").map(r => r.split(","));
  const headers = rows.shift().map(h => h.trim().toLowerCase()); 
  return rows.map(r =>
    headers.reduce((obj, h, i) => {
      obj[h] = r[i] ? r[i].trim() : "";
      return obj;
    }, {})
  );
}

// Cargar productos desde Google Sheets
async function cargarProductos() {
  try {
    const res = await fetch(SHEET_URL);
    const text = await res.text();

    const data = Papa.parse(text, {
      header: true,   // primera fila como cabeceras
      skipEmptyLines: true
    });

    productos = data.data.map(p => ({
      code: p.code,
      description: p.description,
      category: p.category,
      price: parseFloat(p.price || 0),
      stock: parseInt(p.stock || 0)
    }));

    console.log("Productos cargados desde Sheets:", productos);
  } catch (err) {
    console.error("Error cargando productos desde Google Sheets:", err);
  }
}

// Mostrar productos filtrados por categoria
function mostrarProductos(categoria, pagina = 1) {
  const contenedor = document.getElementById("productos");
  contenedor.innerHTML = "";

  const filtrados = productos.filter(p => p.category === categoria);

  if (filtrados.length === 0) {
    contenedor.innerHTML = "<p>No hay productos en esta categoría.</p>";
    return;
  }

  // Paginacion
  const inicio = (pagina - 1) * productosPorPagina;
  const fin = inicio + productosPorPagina;
  const paginaProductos = filtrados.slice(inicio, fin);

  // Mostrar productos
  paginaProductos.forEach(prod => {
    const div = document.createElement("div");
    div.classList.add("producto");

    div.innerHTML = `
      <h3>${prod.description}</h3>
      <p>Código: ${prod.code}</p>
      <p>Precio: $${prod.price}</p>
      <button id="btn-${prod.code}" 
      ${prod.stock <= 0 ? "disabled" : ""} 
      onclick="agregarAlCarrito('${prod.code}','${prod.description}',${prod.price})">
      Agregar
      </button>
      `;
      
      contenedor.appendChild(div);
    });
    // <p>Stock: <span id="stock-${prod.code}">${prod.stock}</span></p> para mostar el stock entre linea 55 - 56
    
  // Controles de paginacion
  const paginacion = document.createElement("div"); 
  paginacion.classList.add("paginacion");

  if (pagina > 1) {
    const btnPrev = document.createElement("button");
    btnPrev.textContent = "⬅ Anterior";
    btnPrev.onclick = () => mostrarProductos(categoria, pagina - 1);
    paginacion.appendChild(btnPrev);
  }

  if (fin < filtrados.length) {
    const btnNext = document.createElement("button");
    btnNext.textContent = "Siguiente ➡";
    btnNext.onclick = () => mostrarProductos(categoria, pagina + 1);
    paginacion.appendChild(btnNext);
  }

  contenedor.appendChild(paginacion);
}

// Agregar al carrito según stock
function agregarAlCarrito(code, description, price) {
  const producto = productos.find(p => p.code === code);

  //  Validación de stock
  if (!producto || producto.stock <= 0) {
    alert("Este producto no tiene stock disponible.");
    return;
  }

  let existente = carrito.find(p => p.code === code);

  if (existente) {
    if (existente.cantidad < producto.stock) {
      existente.cantidad++;
      existente.subtotal = existente.cantidad * existente.price;
      producto.stock--;
    } else {
      alert(`Solo quedan ${producto.stock} unidades disponibles.`);
    }
  } else {
    carrito.push({
      code,
      description,
      price,
      cantidad: 1,
      subtotal: price
    });
    producto.stock--; 
  }

  // Actualizar stock en pantalla
  const stockSpan = document.getElementById(`stock-${code}`);
  if (stockSpan) stockSpan.textContent = producto.stock;

  // Si llega a 0 - desactivar boton
  if (producto.stock <= 0) {
    const btn = document.getElementById(`btn-${code}`);
    if (btn) btn.disabled = true;
  }

  renderCarrito();
}


// Renderizar carrito
function renderCarrito() {
  const tbody = document.getElementById("carrito-body");
  tbody.innerHTML = "";

  carrito.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.code}</td>
      <td>${item.description}</td>
      <td>
        <input type="number" min="1" value="${item.cantidad}" 
               onchange="cambiarCantidad(${index}, this.value)">
      </td>
      <td>$${item.price}</td>
      <td>$${item.subtotal.toFixed(2)}</td>
      <td><button onclick="eliminarDelCarrito(${index})">❌</button></td>
    `;
    tbody.appendChild(tr);
  });

  const total = carrito.reduce((sum, i) => sum + i.subtotal, 0);
  document.getElementById("total").textContent = total.toFixed(2);
}

// Cambiar cantidad en carrito
function cambiarCantidad(index, cantidad) {
  cantidad = parseInt(cantidad);
  const producto = productos.find(p => p.code === carrito[index].code);

  if (cantidad > producto.stock + carrito[index].cantidad) {
    alert(`Stock insuficiente. Solo quedan ${producto.stock + carrito[index].cantidad} unidades.`);
    cantidad = producto.stock + carrito[index].cantidad;
  }

  // Ajustar stock disponible
  const diferencia = cantidad - carrito[index].cantidad;
  producto.stock -= diferencia;

  carrito[index].cantidad = cantidad;
  carrito[index].subtotal = carrito[index].cantidad * carrito[index].price;

  // Actualizar stock en catalogo
  const stockSpan = document.getElementById(`stock-${producto.code}`);
  if (stockSpan) stockSpan.textContent = producto.stock;

  if (producto.stock <= 0) {
    const btn = document.getElementById(`btn-${producto.code}`);
    if (btn) btn.disabled = true;
  }

  renderCarrito();
}

// Eliminar producto del carrito
function eliminarDelCarrito(index) {
  const item = carrito[index];
  const producto = productos.find(p => p.code === item.code);

  // devolver stock al catálogo
  producto.stock += item.cantidad;

  const stockSpan = document.getElementById(`stock-${producto.code}`);
  if (stockSpan) stockSpan.textContent = producto.stock;

  // reactivar boton si vuelve stock
  const btn = document.getElementById(`btn-${producto.code}`);
  if (btn) btn.disabled = false;

  carrito.splice(index, 1);
  renderCarrito();
}

// Remito
function generarNumeroRemito() {
  const fecha = new Date();
  const dd = String(fecha.getDate()).padStart(2, "0");
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const yy = fecha.getFullYear().toString().slice(-2);
  const hh = String(fecha.getHours()).padStart(2, "0");
  const mi = String(fecha.getMinutes()).padStart(2, "0");
  const ss = String(fecha.getSeconds()).padStart(2, "0");
  return `REM-${dd}${mm}${yy}-${hh}${mi}${ss}`;
}

async function finalizarPedido() {
  const cliente = document.getElementById("cliente").value.trim();
  if (!cliente) {
    alert("Ingrese nombre y apellido.");
    return;
  }
  if (carrito.length === 0) {
    alert("El carrito está vacío.");
    return;
  }

  const numeroRemito = generarNumeroRemito();
  const total = carrito.reduce((sum, i) => sum + i.subtotal, 0);

  remitoActual = {
    numero: numeroRemito,
    cliente,
    fecha: new Date().toLocaleString(),
    items: [...carrito],
    total
  };

  mostrarRemito(remitoActual);

  // Google Sheets
try {
    const res = await fetch("https://script.google.com/macros/s/AKfycbym93C9owPRg7Qh-f2SO83qfv_cEHoj0J87VUE6B3AKrXgMFkMVihtE5Q-SPrNXksTVDw/exec", {
      method: "POST",
      body: JSON.stringify({ items: carrito }),
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();

    if (data.success) {
      console.log("Stock actualizado en Sheets:", data.updated);

      // 🔹 Refrescar el stock en la UI
      data.updated.forEach(u => {
        const stockSpan = document.getElementById(`stock-${u.code}`);
        if (stockSpan) stockSpan.textContent = u.stock;

        const btn = document.getElementById(`btn-${u.code}`);
        if (btn && u.stock <= 0) btn.disabled = true;
      });
    } else {
      console.error("Error en respuesta de Apps Script:", data.error);
    }

  } catch (err) {
    console.error("Error actualizando stock:", err);
  }
}

function mostrarRemito(remito) {
  const div = document.getElementById("remito");
  div.innerHTML = `
    <p><strong>Remito N°:</strong> ${remito.numero}</p>
    <p><strong>Cliente:</strong> ${remito.cliente}</p>
    <p><strong>Fecha:</strong> ${remito.fecha}</p>
    <table>
      <thead>
        <tr><th>Código</th><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        ${remito.items.map(i =>
          `<tr><td>${i.code}</td><td>${i.description}</td><td>${i.cantidad}</td><td>$${i.price}</td><td>$${i.subtotal.toFixed(2)}</td></tr>`
        ).join("")}
      </tbody>
    </table>
    <h3>Total: $${remito.total.toFixed(2)}</h3>
  `;

  document.getElementById("remito-section").style.display = "block";
}

// Enviar por mail
async function enviarEmail() {
  if (!remitoActual) return alert("No hay remito para enviar.");

  const detalleHTML = remitoActual.items.map(i => `
  <tr>
    <td style="border:1px solid #ddd; padding:6px;">${i.code}</td>
    <td style="border:1px solid #ddd; padding:6px;">${i.description}</td>
    <td style="border:1px solid #ddd; padding:6px; text-align:center;">${i.cantidad}</td>
    <td style="border:1px solid #ddd; padding:6px; text-align:right;">$${i.price.toFixed(2)}</td>
    <td style="border:1px solid #ddd; padding:6px; text-align:right;">$${i.subtotal.toFixed(2)}</td>
  </tr>
   `).join("");

  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
      numero: remitoActual.numero,
      cliente: remitoActual.cliente,
      fecha: remitoActual.fecha,
      total: remitoActual.total.toFixed(2),
      detalle: detalleHTML
    });
    alert("Remito enviado con éxito.");
  } catch (err) {
    console.error("Error enviando email:", err);
    alert("Error al enviar el remito.");
  }
}

// Eventos
document.getElementById("finalizar").addEventListener("click", finalizarPedido);
document.getElementById("enviar").addEventListener("click", enviarEmail);

// Inicializacion
cargarProductos();
