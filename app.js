// ==================== INICIALIZACIÓN INDEXEDDB ====================
const DB_NAME = 'MercaditoDB';
const DB_VERSION = 1;
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
                const storeProductos = db.createObjectStore('productos', { keyPath: 'id', autoIncrement: true });
                storeProductos.createIndex('nombre', 'nombre', { unique: false });
                storeProductos.createIndex('categoria', 'categoria', { unique: false });
            }
            if (!db.objectStoreNames.contains('ventas')) {
                const storeVentas = db.createObjectStore('ventas', { keyPath: 'id', autoIncrement: true });
                storeVentas.createIndex('fecha', 'fecha', { unique: false });
            }
        };
    });
}

// ==================== UTILIDADES ====================
function obtenerFechaStr() {
    const hoy = new Date();
    return hoy.toISOString().split('T')[0];
}

function obtenerMesActual() {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${hoy.getMonth() + 1}`;
}

// Calcular margen
function calcularMargen(costo, precio) {
    if (precio <= 0) return 0;
    return ((precio - costo) / precio) * 100;
}

// ==================== CRUD PRODUCTOS ====================
async function obtenerProductos() {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('productos', 'readonly');
        const store = transaction.objectStore('productos');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function guardarProducto(producto) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('productos', 'readwrite');
        const store = transaction.objectStore('productos');
        const request = producto.id ? store.put(producto) : store.add(producto);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function eliminarProducto(id) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('productos', 'readwrite');
        const store = transaction.objectStore('productos');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function actualizarStock(id, cantidadRestar) {
    const productos = await obtenerProductos();
    const producto = productos.find(p => p.id === id);
    if (producto && producto.cantidad >= cantidadRestar) {
        producto.cantidad -= cantidadRestar;
        await guardarProducto(producto);
        return true;
    }
    return false;
}

// ==================== VENTAS Y CONTABILIDAD ====================
async function registrarVenta(venta) {
    if (!db) await abrirDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('ventas', 'readwrite');
        const store = transaction.objectStore('ventas');
        venta.fecha = new Date().toISOString();
        venta.mes = obtenerMesActual();
        venta.dia = obtenerFechaStr();
        const request = store.add(venta);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function obtenerVentasPorRango(fechaInicio, fechaFin) {
    if (!db) await abrirDB();
    const ventas = await new Promise((resolve, reject) => {
        const transaction = db.transaction('ventas', 'readonly');
        const store = transaction.objectStore('ventas');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    return ventas.filter(v => {
        const fechaVenta = new Date(v.fecha);
        return fechaVenta >= inicio && fechaVenta <= fin;
    });
}

async function obtenerTotalesHoy() {
    const hoy = obtenerFechaStr();
    const ventas = await obtenerVentasPorRango(`${hoy}T00:00:00`, `${hoy}T23:59:59`);
    let totalVentas = 0, totalEfectivo = 0, totalTransfer = 0;
    ventas.forEach(venta => {
        totalVentas += venta.total;
        totalEfectivo += venta.efectivoRecibido || 0;
        totalTransfer += venta.transferenciaRecibida || 0;
    });
    return { totalVentas, totalEfectivo, totalTransfer };
}

async function obtenerTotalesMes() {
    const mesActual = obtenerMesActual();
    const ventas = await obtenerVentasPorRango(`${mesActual}-01T00:00:00`, `${new Date().toISOString()}`);
    let totalMes = 0;
    ventas.forEach(venta => { totalMes += venta.total; });
    return totalMes;
}

// ==================== RENDERIZAR INVENTARIO ====================
async function renderizarInventario() {
    const productos = await obtenerProductos();
    const filtro = document.getElementById('filtroCategoria').value.toLowerCase();
    const container = document.getElementById('listaInventario');
    const filtrados = filtro ? productos.filter(p => p.categoria.toLowerCase().includes(filtro)) : productos;
    
    container.innerHTML = filtrados.map(p => `
        <div class="producto-card">
            <div class="producto-info">
                <h3>${p.nombre}</h3>
                <div class="producto-detalle">
                    <span>📁 ${p.categoria || 'Sin categoría'}</span>
                    <span>📦 Stock: ${p.cantidad}</span>
                    <span>💰 Precio: $${p.precioVenta}</span>
                    <span>📈 Margen: ${calcularMargen(p.costo, p.precioVenta).toFixed(1)}%</span>
                </div>
            </div>
            <div class="producto-acciones">
                <button class="btn-editar" data-id="${p.id}">✏️ Editar</button>
                <button class="btn-eliminar" data-id="${p.id}">🗑️ Eliminar</button>
            </div>
        </div>
    `).join('');
    
    // Eventos botones
    document.querySelectorAll('.btn-editar').forEach(btn => {
        btn.addEventListener('click', () => editarProducto(parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.btn-eliminar').forEach(btn => {
        btn.addEventListener('click', () => eliminarProducto(parseInt(btn.dataset.id)).then(renderizarInventario));
    });
}

// ==================== MODAL PRODUCTO ====================
let productoEditando = null;
const modal = document.getElementById('modalProducto');
const formProducto = document.getElementById('formProducto');

function editarProducto(id) {
    obtenerProductos().then(productos => {
        productoEditando = productos.find(p => p.id === id);
        if (productoEditando) {
            document.getElementById('productoId').value = productoEditando.id;
            document.getElementById('prodNombre').value = productoEditando.nombre;
            document.getElementById('prodCategoria').value = productoEditando.categoria || '';
            document.getElementById('prodCantidad').value = productoEditando.cantidad;
            document.getElementById('prodCosto').value = productoEditando.costo;
            document.getElementById('prodPrecio').value = productoEditando.precioVenta;
            document.getElementById('modalTitulo').innerText = 'Editar Producto';
            modal.style.display = 'flex';
            actualizarMargenPreview();
        }
    });
}

function actualizarMargenPreview() {
    const costo = parseFloat(document.getElementById('prodCosto').value) || 0;
    const precio = parseFloat(document.getElementById('prodPrecio').value) || 0;
    const margen = calcularMargen(costo, precio);
    document.getElementById('prodMargen').innerText = margen.toFixed(1) + '%';
}

document.getElementById('prodCosto').addEventListener('input', actualizarMargenPreview);
document.getElementById('prodPrecio').addEventListener('input', actualizarMargenPreview);

document.getElementById('btnAgregarProducto').onclick = () => {
    productoEditando = null;
    formProducto.reset();
    document.getElementById('productoId').value = '';
    document.getElementById('modalTitulo').innerText = 'Agregar Producto';
    modal.style.display = 'flex';
    actualizarMargenPreview();
};

formProducto.onsubmit = async (e) => {
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
    renderizarInventario();
};

document.querySelector('.close').onclick = () => modal.style.display = 'none';

// ==================== POS ====================
let carrito = [];

function actualizarCarritoUI() {
    const container = document.getElementById('carritoLista');
    let total = 0;
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
    document.getElementById('carritoTotal').innerText = total.toFixed(2);
    
    // Eventos cantidad
    document.querySelectorAll('.cantidad-control button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(btn.dataset.idx);
            const op = btn.dataset.op;
            if (op === 'mas') {
                carrito[idx].cantidad++;
                actualizarCarritoUI();
            } else if (op === 'menos' && carrito[idx].cantidad > 1) {
                carrito[idx].cantidad--;
                actualizarCarritoUI();
            } else if (op === 'eliminar') {
                carrito.splice(idx, 1);
                actualizarCarritoUI();
            }
        });
    });
    calcularPago();
}

function agregarAlCarrito(producto, cantidad = 1) {
    const existente = carrito.find(p => p.id === producto.id);
    if (existente) {
        existente.cantidad += cantidad;
    } else {
        carrito.push({ ...producto, cantidad });
    }
    actualizarCarritoUI();
}

// Búsqueda autocompletar
const busquedaInput = document.getElementById('busquedaProducto');
const sugerenciasDiv = document.getElementById('sugerencias');

busquedaInput.addEventListener('input', async () => {
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
            const producto = productos.find(p => p.id === id);
            agregarAlCarrito(producto, 1);
            busquedaInput.value = '';
            sugerenciasDiv.innerHTML = '';
        });
    });
});

// Cálculo de pagos
function calcularPago() {
    const total = parseFloat(document.getElementById('carritoTotal').innerText) || 0;
    const efectivo = parseFloat(document.getElementById('pagoEfectivo').value) || 0;
    const transfer = parseFloat(document.getElementById('pagoTransferencia').value) || 0;
    const totalPagado = efectivo + transfer;
    document.getElementById('totalPagado').innerText = totalPagado.toFixed(2);
    
    const msgDiv = document.getElementById('mensajePago');
    const vueltoDiv = document.getElementById('vueltoInfo');
    
    if (totalPagado < total) {
        msgDiv.innerText = `⚠️ Faltan $${(total - totalPagado).toFixed(2)} para completar el pago`;
        vueltoDiv.innerHTML = '';
        return false;
    }
    msgDiv.innerText = '';
    if (efectivo > total) {
        const vuelto = efectivo - total;
        vueltoDiv.innerHTML = `🔄 Vuelto en efectivo: $${vuelto.toFixed(2)}`;
    } else {
        vueltoDiv.innerHTML = '';
    }
    return true;
}

document.getElementById('pagoEfectivo').addEventListener('input', calcularPago);
document.getElementById('pagoTransferencia').addEventListener('input', calcularPago);

document.getElementById('btnCobrar').addEventListener('click', async () => {
    const carritoActual = [...carrito];
    if (carritoActual.length === 0) {
        alert('Carrito vacío');
        return;
    }
    const total = parseFloat(document.getElementById('carritoTotal').innerText);
    const efectivo = parseFloat(document.getElementById('pagoEfectivo').value) || 0;
    const transfer = parseFloat(document.getElementById('pagoTransferencia').value) || 0;
    if (efectivo + transfer < total - 0.01) {
        alert('Pago insuficiente');
        return;
    }
    
    // Verificar stock y restar
    let errorStock = false;
    for (const item of carritoActual) {
        const productos = await obtenerProductos();
        const producto = productos.find(p => p.id === item.id);
        if (!producto || producto.cantidad < item.cantidad) {
            alert(`Stock insuficiente para ${item.nombre}`);
            errorStock = true;
            break;
        }
    }
    if (errorStock) return;
    
    // Restar stock y registrar venta
    for (const item of carritoActual) {
        await actualizarStock(item.id, item.cantidad);
    }
    
    const venta = {
        items: carritoActual,
        total: total,
        efectivoRecibido: efectivo,
        transferenciaRecibida: transfer,
        vuelto: efectivo > total ? efectivo - total : 0
    };
    await registrarVenta(venta);
    
    // Resetear POS
    carrito = [];
    actualizarCarritoUI();
    document.getElementById('pagoEfectivo').value = 0;
    document.getElementById('pagoTransferencia').value = 0;
    calcularPago();
    renderizarInventario();
    actualizarResumen();
    alert('Venta registrada ✅');
});

// ==================== ACTUALIZAR RESÚMENES ====================
async function actualizarResumen() {
    const hoy = await obtenerTotalesHoy();
    const mes = await obtenerTotalesMes();
    document.getElementById('ventasHoy').innerText = `$${hoy.totalVentas.toFixed(2)}`;
    document.getElementById('efectivoHoy').innerText = `$${hoy.totalEfectivo.toFixed(2)}`;
    document.getElementById('transferHoy').innerText = `$${hoy.totalTransfer.toFixed(2)}`;
    document.getElementById('ventasMes').innerText = `$${mes.toFixed(2)}`;
}

// ==================== EXPORTAR / IMPORTAR ====================
async function exportarDatos() {
    const productos = await obtenerProductos();
    const ventas = await new Promise((resolve, reject) => {
        const transaction = db.transaction('ventas', 'readonly');
        const store = transaction.objectStore('ventas');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const datos = { productos, ventas, exportado: new Date().toISOString() };
    return JSON.stringify(datos, null, 2);
}

document.getElementById('btnExportar').addEventListener('click', async () => {
    const json = await exportarDatos();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mercadito_backup_${obtenerFechaStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('btnCompartirWhatsApp').addEventListener('click', async () => {
    const json = await exportarDatos();
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], `backup.json`, { type: 'application/json' });
    if (navigator.share) {
        navigator.share({ files: [file], title: 'Respaldo MiMercadito' });
    } else {
        alert('Compartir solo funciona con HTTPS o en dispositivos móviles. Usa exportar manual.');
    }
});

document.getElementById('btnSeleccionarArchivo').addEventListener('click', () => {
    document.getElementById('archivoImportar').click();
});

document.getElementById('archivoImportar').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const texto = await file.text();
    const datos = JSON.parse(texto);
    // Sobrescribir datos
    if (!db) await abrirDB();
    const transaction = db.transaction(['productos', 'ventas'], 'readwrite');
    await transaction.objectStore('productos').clear();
    await transaction.objectStore('ventas').clear();
    for (const prod of datos.productos) {
        await transaction.objectStore('productos').add(prod);
    }
    for (const venta of datos.ventas) {
        await transaction.objectStore('ventas').add(venta);
    }
    await transaction.done;
    alert('Datos importados correctamente');
    renderizarInventario();
    actualizarResumen();
});

document.getElementById('btnImportarUrl').addEventListener('click', async () => {
    const url = document.getElementById('urlGitHub').value;
    if (!url) return;
    try {
        const resp = await fetch(url);
        const datos = await resp.json();
        const transaction = db.transaction(['productos', 'ventas'], 'readwrite');
        await transaction.objectStore('productos').clear();
        await transaction.objectStore('ventas').clear();
        for (const prod of datos.productos) {
            await transaction.objectStore('productos').add(prod);
        }
        for (const venta of datos.ventas) {
            await transaction.objectStore('ventas').add(venta);
        }
        alert('Importado desde URL correctamente');
        renderizarInventario();
        actualizarResumen();
    } catch(e) {
        alert('Error al importar desde URL: ' + e.message);
    }
});

// ==================== NAVEGACIÓN ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(cont => cont.classList.remove('active'));
        document.getElementById(btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'inventario') renderizarInventario();
    });
});

// ==================== INICIO ====================
(async function init() {
    await abrirDB();
    await renderizarInventario();
    await actualizarResumen();
    setInterval(actualizarResumen, 60000); // actualizar cada minuto
})();