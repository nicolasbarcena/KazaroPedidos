// Carga supervisores y arma la UI para elegir servicio, luego navega al catálogo filtrado.
const DATA_URL = '/data/supervisores.json';

let DATA = null;
let supSel = null;
let servSel = null;

const $ = (q)=>document.querySelector(q);
const inpSupervisor = $('#inpSupervisor');
const dlSupervisores = $('#dlSupervisores');
const selServicio    = $('#selServicio');
const btnCatalogo    = $('#btnCatalogo');

async function loadData(){
  const res = await fetch(DATA_URL);
  if(!res.ok) throw new Error('No pude cargar supervisores.json');
  DATA = await res.json();
}

function normaliza(s){ return String(s||'').trim().toLowerCase(); }

function fillDatalist(){
  dlSupervisores.innerHTML = '';
  (DATA.supervisores||[]).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s.nombre;
    dlSupervisores.appendChild(opt);
  });
}

function onSupervisorChanged(){
  const nombre = inpSupervisor.value.trim();
  const found = (DATA.supervisores||[]).find(s => normaliza(s.nombre) === normaliza(nombre));
  supSel = found || null;

  selServicio.innerHTML = '<option value="">— selecciona un servicio —</option>';
  selServicio.disabled = !supSel;

  if (supSel){
    (supSel.servicios||[]).forEach(sv=>{
      const op = document.createElement('option');
      op.value = sv.id;          // ID corto que pasamos por URL
      op.textContent = sv.nombre;
      selServicio.appendChild(op);
    });
  }

  btnCatalogo.disabled = true;
  servSel = null;
}

function onServicioChanged(){
  const id = selServicio.value;
  servSel = id && supSel ? (supSel.servicios||[]).find(s => s.id === id) : null;
  btnCatalogo.disabled = !servSel;
}

function goCatalogo(){
  if (!supSel || !servSel) return;
  const url = `/index.html?service=${encodeURIComponent(servSel.id)}&supervisor=${encodeURIComponent(supSel.nombre)}`;
  location.href = url;
}

document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadData();
    fillDatalist();
  }catch(e){
    alert(e.message);
  }

  inpSupervisor.addEventListener('change', onSupervisorChanged);
  inpSupervisor.addEventListener('blur', onSupervisorChanged);
  selServicio.addEventListener('change', onServicioChanged);
  btnCatalogo.addEventListener('click', goCatalogo);
});
