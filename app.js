// ==================== INDEXEDDB ====================
const DB_NAME = 'MercaditoDB';
const DB_VERSION = 2;
let db = null;

function abrirDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('productos')) {
                const store = db.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
                store.createIndex('nombre', 'nombre');
                store.createIndex('categoria', 'categoria');
            }
            if (!db.objectStoreNames.contains('ventas')) {
                db.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// ==================== UTILIDADES ====================
function obtenerFechaStr() {
    return new Date().toISOString().split('T')[0];
}

function obtenerMesActual() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function calcularMargen(costo, precio) {
    if (precio <= 0) return 0;
    return ((precio - costo) / precio) * 100;
}

// ==================== CRUD PRODUCTOS ====================
async function obtenerProductos() {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('productos', 'readonly');
        const req = tx.objectStore('productos').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function guardarProducto(producto) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('productos', 'readwrite');
        const req = producto.id ? tx.objectStore('productos').put(producto) : tx.objectStore('productos').add(producto);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function eliminarProducto(id) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('productos', 'readwrite');
        const req = tx.objectStore('productos').delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function actualizarStock(id, cantidad) {
    const productos = await obtenerProductos();
    const prod = productos.find(p => p.id === id);
    if (prod && prod.cantidad >= cantidad) {
        prod.cantidad -= cantidad;
        await guardarProducto(prod);
        return true;
    }
    return false;
}

// ==================== VENTAS ====================
async function registrarVenta(venta) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('ventas', 'readwrite');
        venta.fecha = new Date().toISOString();
        venta.dia = obtenerFechaStr();
        venta.mes = obtenerMesActual();
        const req = tx.objectStore('ventas').add(venta);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function obtenerVentasPorRango(inicio, fin) {
    if (!db) await abrirDB();
    const todas = await new Promise((resolve, reject) => {
        const tx = db.transaction('ventas', 'readonly');
        const req = tx.objectStore('ventas').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    const inicioDate = new Date(inicio);
    const finDate = new Date(fin);
    return todas.filter(v => {
        const d = new Date(v.fecha);
        return d >= inicioDate && d <= finDate;
    });
}

// ==================== TOTALES PARA RESÚMENES ====================
async function obtenerTotalesHoy() {
    const hoy = obtenerFechaStr();
    const ventas = await obtenerVentasPorRango(`${hoy}T00:00:00`, `${hoy}T23:59:59`);
    let totalVentas = 0, totalEfectivo = 0, totalTransfer = 0;
    ventas.forEach(v => {
        totalVentas += v.total;
        totalEfectivo += v.efectivoRecibido || 0;
        totalTransfer += v.transferenciaRecibida || 0;
    });
    return { totalVentas, totalEfectivo, totalTransfer };
}

async function obtenerTotalesMes() {
    const mesActual = obtenerMesActual();
    const ventas = await obtenerVentasPorRango(`${mesActual}-01T00:00:00`, new Date().toISOString());
    return ventas.reduce((sum, v) => sum + v.total, 0);
}

async function actualizarResumenUI() {
    const hoy = await obtenerTotalesHoy();
    const mes = await obtenerTotalesMes();
    document.getElementById('ventasHoy').innerText = hoy.totalVentas.toFixed(2);
    document.getElementById('efectivoHoy').innerText = hoy.totalEfectivo.toFixed(2);
    document.getElementById('transferHoy').innerText = hoy.totalTransfer.toFixed(2);
    document.getElementById('ventasMes').innerText = mes.toFixed(2);
}

// ==================== RENDER INVENTARIO ====================
async function renderizarInventario() {
    const productos = await obtenerProductos();
    const filtro = document.getElementById('filtroCategoria')?.value.toLowerCase() || '';
    const filtrados = filtro ? productos.filter(p => p.categoria?.toLowerCase().includes(filtro)) : productos;
    const container = document.getElementById('listaInventario');
    if (!container) return;
    container.innerHTML = filtrados.map(p => `
        <div class="producto-card">
            <div class="producto-info">
                <h4>${p.nombre}</h4>
                <div class="producto-detalle">
                    <span>📁 ${p.categoria || 'Sin categoría'}</span>
                    <span>📦 Stock: ${p.cantidad}</span>
                    <span>💰 $${p.precioVenta}</span>
                    <span>📈 ${calcularMargen(p.costo, p.precioVenta).toFixed(1)}%</span>
                </div>
            </div>
            <div class="producto-acciones">
                <button class="btn-editar" data-id="${p.id}">✏️ Editar</button>
                <button class="btn-eliminar" data-id="${p.id}">🗑️ Eliminar</button>
            </div>
        </div>
    `).join('');
    document.querySelectorAll('.btn-editar').forEach(btn => {
        btn.addEventListener('click', () => editarProducto(parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (confirm('¿Eliminar producto?')) {
                await eliminarProducto(parseInt(btn.dataset.id));
                await renderizarInventario();
            }
        });
    });
}

// ==================== MODAL PRODUCTO ====================
const modal = document.getElementById('modalProducto');
const formProd = document.getElementById('formProducto');
let editandoId = null;

function editarProducto(id) {
    obtenerProductos().then(productos => {
        const p = productos.find(prod => prod.id === id);
        if (p) {
            document.getElementById('productoId').value = p.id;
            document.getElementById('prodNombre').value = p.nombre;
            document.getElementById('prodCategoria').value = p.categoria || '';
            document.getElementById('prodCantidad').value = p.cantidad;
            document.getElementById('prodCosto').value = p.costo;
            document.getElementById('prodPrecio').value = p.precioVenta;
            document.getElementById('modalTitulo').innerText = 'Editar Producto';
            modal.style.display = 'flex';
            actualizarMargenPreview();
            editandoId = id;
        }
    });
}

function actualizarMargenPreview() {
    const costo = parseFloat(document.getElementById('prodCosto').value) || 0;
    const precio = parseFloat(document.getElementById('prodPrecio').value) || 0;
    const margen = calcularMargen(costo, precio);
    document.getElementById('prodMargen').innerText = `Margen: ${margen.toFixed(1)}%`;
}

document.getElementById('btnNuevoProducto')?.addEventListener('click', () => {
    formProd.reset();
    document.getElementById('productoId').value = '';
    document.getElementById('modalTitulo').innerText = 'Agregar Producto';
    modal.style.display = 'flex';
    actualizarMargenPreview();
    editandoId = null;
});

document.querySelector('.cerrar')?.addEventListener('click', () => {
    modal.style.display = 'none';
});

formProd?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const producto = {
        id: parseInt(document.getElementById('productoId').value) || undefined,
        nombre: document.getElementById('prodNombre').value,
        categoria: document.getElementById('prodCategoria').value,
        cantidad: parseInt(document.getElementById('prodCantidad').value),
        costo: parseFloat(document.getElementById('prodCosto').value),
        precioVenta: parseFloat(document.getElementById('prodPrecio').value)
    };
    await guardarProducto(producto);
    modal.style.display = 'none';
    await renderizarInventario();
    await actualizarResumenUI();
});

document.getElementById('prodCosto')?.addEventListener('input', actualizarMargenPreview);
document.getElementById('prodPrecio')?.addEventListener('input', actualizarMargenPreview);

// ==================== POS - CARRITO Y PAGOS ====================
let carrito = [];

function actualizarCarritoUI() {
    const container = document.getElementById('carrito-lista');
    let total = 0;
    if (!container) return;
    container.innerHTML = carrito.map((item, idx) => {
        const subtotal = item.cantidad * item.precio;
        total += subtotal;
        return `
            <div class="carrito-item">
                <div><strong>${item.nombre}</strong><br>$${item.precio} c/u</div>
                <div class="cantidad-control">
                    <button data-idx="${idx}" data-op="menos">-</button>
                    <span>${item.cantidad}</span>
                    <button data-idx="${idx}" data-op="mas">+</button>
                    <span>$${subtotal}</span>
                    <button data-idx="${idx}" data-op="eliminar">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
    document.getElementById('totalCarrito').innerText = total.toFixed(2);
    calcularPago();
    document.querySelectorAll('.cantidad-control button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.dataset.idx);
            const op = btn.dataset.op;
            if (op === 'mas') carrito[idx].cantidad++;
            else if (op === 'menos' && carrito[idx].cantidad > 1) carrito[idx].cantidad--;
            else if (op === 'eliminar') carrito.splice(idx, 1);
            actualizarCarritoUI();
        });
    });
}

function agregarAlCarrito(producto, cantidad = 1) {
    const existe = carrito.find(p => p.id === producto.id);
    if (existe) existe.cantidad += cantidad;
    else carrito.push({ ...producto, cantidad });
    actualizarCarritoUI();
}

// Buscador y autocompletar
const busquedaInput = document.getElementById('buscarProducto');
const sugerenciasDiv = document.getElementById('sugerencias');
busquedaInput?.addEventListener('input', async () => {
    const texto = busquedaInput.value.toLowerCase();
    if (texto.length < 1) {
        sugerenciasDiv.innerHTML = '';
        return;
    }
    const productos = await obtenerProductos();
    const filtrados = productos.filter(p => p.nombre.toLowerCase().includes(texto) && p.cantidad > 0);
    sugerenciasDiv.innerHTML = filtrados.map(p => `
        <div class="sugerencia-item" data-id="${p.id}">${p.nombre} - $${p.precioVenta} (stock: ${p.cantidad})</div>
    `).join('');
    document.querySelectorAll('.sugerencia-item').forEach(el => {
        el.addEventListener('click', async () => {
            const id = parseInt(el.dataset.id);
            const productos = await obtenerProductos();
            const prod = productos.find(p => p.id === id);
            if (prod) agregarAlCarrito(prod, 1);
            busquedaInput.value = '';
            sugerenciasDiv.innerHTML = '';
        });
    });
});

// Cálculo de pagos
function calcularPago() {
    const total = parseFloat(document.getElementById('totalCarrito')?.innerText) || 0;
    const efectivo = parseFloat(document.getElementById('pagoEfectivo')?.value) || 0;
    const transfer = parseFloat(document.getElementById('pagoTransferencia')?.value) || 0;
    const totalPagado = efectivo + transfer;
    const totalPagadoSpan = document.getElementById('totalPagado');
    if (totalPagadoSpan) totalPagadoSpan.innerText = totalPagado.toFixed(2);
    const vueltoDiv = document.getElementById('vuelto-info');
    if (efectivo > total) vueltoDiv.innerHTML = `🔄 Vuelto en efectivo: $${(efectivo - total).toFixed(2)}`;
    else vueltoDiv.innerHTML = '';
    return totalPagado >= total;
}

document.getElementById('pagoEfectivo')?.addEventListener('input', calcularPago);
document.getElementById('pagoTransferencia')?.addEventListener('input', calcularPago);

document.getElementById('btnCobrar')?.addEventListener('click', async () => {
    if (carrito.length === 0) return alert('Carrito vacío');
    const total = parseFloat(document.getElementById('totalCarrito').innerText);
    const efectivo = parseFloat(document.getElementById('pagoEfectivo').value) || 0;
    const transfer = parseFloat(document.getElementById('pagoTransferencia').value) || 0;
    if (efectivo + transfer < total - 0.01) return alert('Pago insuficiente');
    for (const item of carrito) {
        const ok = await actualizarStock(item.id, item.cantidad);
        if (!ok) return alert(`Stock insuficiente para ${item.nombre}`);
    }
    await registrarVenta({
        items: carrito,
        total,
        efectivoRecibido: efectivo,
        transferenciaRecibida: transfer,
        vuelto: efectivo > total ? efectivo - total : 0
    });
    carrito = [];
    actualizarCarritoUI();
    document.getElementById('pagoEfectivo').value = 0;
    document.getElementById('pagoTransferencia').value = 0;
    calcularPago();
    await renderizarInventario();
    await actualizarResumenUI();
    alert('✅ Venta registrada');
});

// ==================== EXPORTAR / IMPORTAR ====================
async function exportarDatos() {
    const productos = await obtenerProductos();
    const ventas = await new Promise((resolve, reject) => {
        const tx = db.transaction('ventas', 'readonly');
        const req = tx.objectStore('ventas').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return JSON.stringify({ productos, ventas, exportado: new Date().toISOString() }, null, 2);
}

document.getElementById('btnExportar')?.addEventListener('click', async () => {
    const json = await exportarDatos();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mercadito_${obtenerFechaStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btnWhatsApp')?.addEventListener('click', async () => {
    const json = await exportarDatos();
    const file = new File([json], 'backup.json', { type: 'application/json' });
    if (navigator.share) navigator.share({ files: [file], title: 'Respaldo' });
    else alert('Compartir requiere HTTPS o móvil');
});

document.getElementById('btnSeleccionarArchivo')?.addEventListener('click', () => {
    document.getElementById('archivoImportar').click();
});

document.getElementById('archivoImportar')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const texto = await file.text();
    const datos = JSON.parse(texto);
    const tx = db.transaction(['productos', 'ventas'], 'readwrite');
    await tx.objectStore('productos').clear();
    await tx.objectStore('ventas').clear();
    for (const p of datos.productos) await tx.objectStore('productos').add(p);
    for (const v of datos.ventas) await tx.objectStore('ventas').add(v);
    alert('Importado correctamente');
    await renderizarInventario();
    await actualizarResumenUI();
});

document.getElementById('btnImportarUrl')?.addEventListener('click', async () => {
    const url = document.getElementById('urlGitHub').value;
    if (!url) return;
    try {
        const resp = await fetch(url);
        const datos = await resp.json();
        const tx = db.transaction(['productos', 'ventas'], 'readwrite');
        await tx.objectStore('productos').clear();
        await tx.objectStore('ventas').clear();
        for (const p of datos.productos) await tx.objectStore('productos').add(p);
        for (const v of datos.ventas) await tx.objectStore('ventas').add(v);
        alert('Sincronizado desde URL');
        await renderizarInventario();
        await actualizarResumenUI();
    } catch (err) {
        alert('Error al importar desde URL');
    }
});

// ==================== NAVEGACIÓN POR TABS ====================
function cambiarTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
    if (tabId === 'pos') document.querySelector('.tab[data-tab="pos"]')?.classList.add('active');
    if (tabId === 'inventario') document.querySelector('.tab[data-tab="inventario"]')?.classList.add('active');
    if (tabId === 'datos') document.querySelector('.tab[data-tab="datos"]')?.classList.add('active');
}

document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab === 'pos') cambiarTab('pos');
        if (tab === 'inventario') cambiarTab('inventario');
        if (tab === 'datos') cambiarTab('datos');
    });
});

// ==================== INICIALIZACIÓN ====================
(async function init() {
    await abrirDB();
    await renderizarInventario();
    await actualizarResumenUI();
    setInterval(actualizarResumenUI, 60000);
    // Muestra POS por defecto
    cambiarTab('pos');
})();