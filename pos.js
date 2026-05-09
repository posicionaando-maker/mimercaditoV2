/**
 * ====================================================================
 * MI MERCADITO POS - PUNTO DE VENTA OFFLINE-FIRST
 * ====================================================================
 * Características principales:
 * - Offline first: todos los datos se guardan localmente
 * - Pagos mixtos (efectivo + transferencia) - típico en Cuba
 * - Reportes de ventas diarias, mensuales, ganancias, stock bajo
 * - Exportación manual de inventario (solo stock > 0) y ventas
 * - PWA instalable en el móvil de la empleada
 * ====================================================================
 */
/**
 * FORZAR ACTUALIZACIÓN DESDE SERVICE WORKER
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (let registration of registrations) {
      registration.update();  // Forzar buscar nueva versión
      console.log('Buscando actualización del Service Worker');
    }
  });
  
  // Además, limpiar cachés manualmente
  if ('caches' in window) {
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== 'mi-mercadito-pos-v2') {
            console.log('Eliminando caché:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    });
  }
}
// ====================== ESTADO GLOBAL ======================
// inventario: objeto con la estructura { productos: [...] }
let inventario = { productos: [] };

// carrito: array de productos seleccionados para la venta actual
// cada item: { id, nombre, cantidad, precioUnitario, costoUnitario }
let carrito = [];

// ventas: array con todas las ventas realizadas (histórico)
// cada venta: { id, fecha, items, total, efectivo, transferencia, ganancia }
let ventas = [];

// Clave para guardar las ventas en localStorage (persistencia offline)
const STORAGE_VENTAS = 'ventas_acumuladas';

// ====================== INICIALIZACIÓN ======================
// Cuando el DOM esté completamente cargado, configuramos todo
document.addEventListener('DOMContentLoaded', () => {
  // 1. Cargar el historial de ventas guardado en el teléfono
  cargarVentasDeLocal();
  
  // 2. Configurar todos los botones y eventos
  setupEventListeners();
  
  // 3. Renderizar carrito vacío (muestra "carrito vacío")
  renderCarrito();
  
  // 4. Mostrar la pestaña de ventas (por defecto)
  cambiarTab('vender');
});

/**
 * Configura todos los event listeners de la interfaz
 */
function setupEventListeners() {
  // ----- IMPORTAR INVENTARIO (desde archivo JSON) -----
  // Creamos un input de tipo file invisible
  const inputFile = document.createElement('input');
  inputFile.type = 'file';
  inputFile.accept = '.json';
  
  // Al hacer clic en el botón, se abre el selector de archivos
  document.getElementById('btnImportarInventario').onclick = () => inputFile.click();
  
  // Cuando se selecciona un archivo
  inputFile.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Leemos el archivo como texto
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // Parseamos el JSON
        const data = JSON.parse(ev.target.result);
        
        // Validamos que tenga la estructura esperada
        if (data.productos) {
          inventario = data;
          
          // Guardamos una copia en localStorage para posible recuperación futura
          localStorage.setItem('inventario_local', JSON.stringify(inventario));
          
          // Actualizamos la vista del catálogo
          renderProductos();
          
          alert('✅ Inventario cargado correctamente');
        } else {
          throw new Error('Formato inválido');
        }
      } catch(err) {
        alert('❌ Archivo inválido: debe ser un JSON con "productos"');
      }
    };
    reader.readAsText(file);
  };

  // ----- EXPORTAR INVENTARIO (solo productos con stock > 0) -----
  document.getElementById('btnExportarInventario').onclick = () => {
    if (!inventario.productos.length) {
      alert('⚠️ No hay inventario cargado');
      return;
    }
    
    // FILTRO CLAVE: solo productos con cantidad > 0
    // Esto asegura que el archivo que se envía por WhatsApp y se sube a GitHub
    // no contenga productos agotados, manteniendo el catálogo limpio
    const inventarioFiltrado = {
      productos: inventario.productos.filter(p => p.cantidad > 0)
    };
    
    if (inventarioFiltrado.productos.length === 0) {
      alert('⚠️ No hay productos con stock > 0 para exportar');
      return;
    }
    
    // Convertimos a JSON bonito (con indentación de 2 espacios)
    const dataStr = JSON.stringify(inventarioFiltrado, null, 2);
    
    // Generamos nombre de archivo con timestamp (año-mes-dia_hora-minuto-segundo)
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    descargarArchivo(dataStr, `inventario_${timestamp}.json`);
  };

  // ----- EXPORTAR VENTAS (historial completo) -----
  document.getElementById('btnExportarVentas').onclick = () => {
    const dataStr = JSON.stringify(ventas, null, 2);
    const fechaHoy = new Date().toISOString().slice(0, 10);
    descargarArchivo(dataStr, `ventas_${fechaHoy}.json`);
  };

  // ----- CAMBIO DE PESTAÑAS -----
  document.getElementById('tabVender').onclick = () => cambiarTab('vender');
  document.getElementById('tabReportes').onclick = () => { 
    cambiarTab('reportes'); 
    actualizarReportes();  // cada vez que se ve reportes, se refrescan los datos
  };

  // ----- BOTONES DEL CARRITO -----
  document.getElementById('finalizarVenta').onclick = finalizarVenta;
  document.getElementById('limpiarCarrito').onclick = limpiarCarrito;

  // ----- PAGOS MIXTOS: cada vez que cambian efectivo o transferencia, verificamos -----
  document.getElementById('efectivo').addEventListener('input', verificarPago);
  document.getElementById('transferencia').addEventListener('input', verificarPago);

  // ----- BÚSQUEDA EN TIEMPO REAL -----
  document.getElementById('buscar').addEventListener('input', () => renderProductos());

  // ----- REPORTES: filtro por mes -----
  document.getElementById('actualizarReportes').onclick = actualizarReportes;
  
  // Establecemos el mes actual como valor por defecto en el filtro
  const hoy = new Date().toISOString().slice(0, 7);  // formato "YYYY-MM"
  document.getElementById('filtroMes').value = hoy;
}

/**
 * Descarga un archivo en el dispositivo del usuario
 * @param {string} contenido - El contenido del archivo (ej. JSON string)
 * @param {string} nombreArchivo - Nombre con el que se guardará
 */
function descargarArchivo(contenido, nombreArchivo) {
  // Blob = Binary Large Object, representa datos en bruto
  const blob = new Blob([contenido], {type: 'application/json'});
  
  // Creamos una URL temporal que apunta al blob
  const url = URL.createObjectURL(blob);
  
  // Creamos un enlace <a> invisible y simulamos clic
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  
  // Liberamos la URL temporal para no consumir memoria
  URL.revokeObjectURL(url);
}

/**
 * Carga el historial de ventas desde localStorage
 * Si no hay nada guardado, inicializa como array vacío
 */
function cargarVentasDeLocal() {
  const guardadas = localStorage.getItem(STORAGE_VENTAS);
  if (guardadas) {
    ventas = JSON.parse(guardadas);
  } else {
    ventas = [];
  }
}

/**
 * Guarda el historial de ventas en localStorage
 * Se llama después de cada venta para persistencia offline
 */
function guardarVentasEnLocal() {
  localStorage.setItem(STORAGE_VENTAS, JSON.stringify(ventas));
}

// ====================== CATÁLOGO DE PRODUCTOS ======================

/**
 * Renderiza la lista de productos según el texto de búsqueda
 * También respeta el stock para mostrar botón "Agregar" o "AGOTADO"
 */
function renderProductos() {
  const buscar = document.getElementById('buscar').value.toLowerCase();
  
  // Filtramos productos por nombre o categoría
  const filtrados = inventario.productos.filter(p => 
    p.nombre.toLowerCase().includes(buscar) || 
    (p.categoria && p.categoria.toLowerCase().includes(buscar))
  );
  
  const container = document.getElementById('productList');
  
  if (!filtrados.length) {
    container.innerHTML = '<div style="grid-column:1/-1">📭 No hay productos</div>';
    return;
  }
  
  // Generamos HTML para cada producto
  container.innerHTML = filtrados.map(p => `
    <div class="product-card" data-id="${p.id}">
      <strong>${p.nombre}</strong><br>
      <small>${p.categoria || ''}</small><br>
      <div class="price">$${p.precioVenta.toFixed(2)}</div>
      <span class="stock-badge ${p.cantidad <= 3 ? 'low-stock' : ''}">
        📦 Stock: ${p.cantidad}
      </span>
      ${p.cantidad > 0 
        ? `<button class="add-btn" data-id="${p.id}">➕ Agregar</button>` 
        : '<button disabled>❌ AGOTADO</button>'}
    </div>
  `).join('');
  
  // Agregamos event listeners a los botones "Agregar" (creados dinámicamente)
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();  // Evita que el clic se propague al padre
      agregarAlCarrito(parseInt(btn.dataset.id));
    });
  });
}

/**
 * Agrega un producto al carrito
 * @param {number} id - ID del producto
 */
function agregarAlCarrito(id) {
  const prod = inventario.productos.find(p => p.id === id);
  
  // Validaciones de stock
  if (!prod || prod.cantidad <= 0) {
    alert('❌ Sin stock disponible');
    return;
  }
  
  // Buscar si el producto ya está en el carrito
  const existente = carrito.find(i => i.id === id);
  
  if (existente) {
    // Verificar que no supere el stock disponible
    if (existente.cantidad + 1 > prod.cantidad) {
      alert(`⚠️ Solo hay ${prod.cantidad} unidades disponibles`);
      return;
    }
    existente.cantidad++;
  } else {
    // Agregar nuevo producto al carrito
    carrito.push({
      id: prod.id,
      nombre: prod.nombre,
      cantidad: 1,
      precioUnitario: prod.precioVenta,
      costoUnitario: prod.costo || 0  // Si no tiene costo, se asume 0
    });
  }
  
  // Refrescar la vista del carrito
  renderCarrito();
}

// ====================== CARRITO Y PAGOS ======================

/**
 * Renderiza el carrito con los productos seleccionados
 * Muestra subtotales y permite eliminar items individualmente
 */
function renderCarrito() {
  const container = document.getElementById('cartItems');
  
  if (!carrito.length) {
    container.innerHTML = '<div style="text-align:center; color:#888">🛒 Carrito vacío</div>';
    document.getElementById('totalCarrito').innerText = '0.00';
    return;
  }
  
  let html = '';
  let total = 0;
  
  carrito.forEach((item, idx) => {
    const subtotal = item.cantidad * item.precioUnitario;
    total += subtotal;
    
    html += `
      <div class="cart-item">
        <span>
          <strong>${item.nombre}</strong> x${item.cantidad}
        </span>
        <span>
          $${subtotal.toFixed(2)} 
          <button class="remove-one" data-idx="${idx}">➖ -1</button>
          <button class="remove-all" data-idx="${idx}">🗑 Eliminar</button>
        </span>
      </div>
    `;
  });
  
  container.innerHTML = html;
  document.getElementById('totalCarrito').innerText = total.toFixed(2);
  
  // Botones para quitar una unidad
  document.querySelectorAll('.remove-one').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      if (carrito[idx].cantidad > 1) {
        carrito[idx].cantidad--;
      } else {
        carrito.splice(idx, 1);
      }
      renderCarrito();
      verificarPago();
    };
  });
  
  // Botones para quitar todo el producto
  document.querySelectorAll('.remove-all').forEach(btn => {
    btn.onclick = () => {
      carrito.splice(parseInt(btn.dataset.idx), 1);
      renderCarrito();
      verificarPago();
    };
  });
  
  verificarPago();
}

/**
 * Verifica si el pago (efectivo + transferencia) es suficiente
 * Actualiza el mensaje de cambio y habilita/deshabilita el botón finalizar
 * 
 * LÓGICA DE PAGO MIXTO (común en Cuba):
 * - El cliente puede pagar parte en efectivo y parte por transferencia
 * - Si la suma es mayor o igual al total, se habilita la venta
 * - El cambio siempre se da en efectivo (por simplicidad)
 */
function verificarPago() {
  const total = parseFloat(document.getElementById('totalCarrito').innerText);
  const efectivo = parseFloat(document.getElementById('efectivo').value) || 0;
  const transferencia = parseFloat(document.getElementById('transferencia').value) || 0;
  const suma = efectivo + transferencia;
  
  const restanteDiv = document.getElementById('restanteMsg');
  const finalizarBtn = document.getElementById('finalizarVenta');
  
  if (suma >= total && total > 0) {
    const cambio = suma - total;
    restanteDiv.innerHTML = `✅ Pago completo. Cambio en efectivo: $${cambio.toFixed(2)}`;
    finalizarBtn.disabled = false;
  } else if (total > 0) {
    const faltante = total - suma;
    restanteDiv.innerHTML = `⚠️ Faltan $${faltante.toFixed(2)} para completar el pago`;
    finalizarBtn.disabled = true;
  } else {
    restanteDiv.innerHTML = '';
    finalizarBtn.disabled = true;
  }
}

/**
 * Finaliza la venta actual:
 * 1. Descuenta el stock del inventario
 * 2. Registra la venta en el historial
 * 3. Guarda en localStorage
 * 4. Limpia el carrito
 * 5. Actualiza la interfaz
 */
function finalizarVenta() {
  const total = parseFloat(document.getElementById('totalCarrito').innerText);
  const efectivo = parseFloat(document.getElementById('efectivo').value) || 0;
  const transferencia = parseFloat(document.getElementById('transferencia').value) || 0;
  
  // Validación de seguridad
  if (efectivo + transferencia < total) {
    alert('❌ El pago es insuficiente');
    return;
  }
  
  // ----- DESCONTAR STOCK -----
  // Por cada producto en el carrito, reducimos su cantidad en el inventario
  for (let item of carrito) {
    const prod = inventario.productos.find(p => p.id === item.id);
    if (prod) {
      prod.cantidad -= item.cantidad;
      // Nunca debe quedar negativo, pero por si acaso:
      if (prod.cantidad < 0) prod.cantidad = 0;
    }
  }
  
  // ----- REGISTRAR VENTA -----
  // Calculamos la ganancia de esta venta (precioVenta - costo)
  const gananciaVenta = carrito.reduce((acc, item) => {
    return acc + (item.cantidad * (item.precioUnitario - item.costoUnitario));
  }, 0);
  
  const nuevaVenta = {
    id: Date.now(),  // timestamp único como ID
    fecha: new Date().toISOString(),  // formato ISO: "2025-01-15T10:30:00.000Z"
    items: carrito.map(i => ({
      id: i.id,
      nombre: i.nombre,
      cantidad: i.cantidad,
      precio: i.precioUnitario,
      costo: i.costoUnitario
    })),
    total: total,
    efectivo: efectivo,
    transferencia: transferencia,
    ganancia: gananciaVenta
  };
  
  ventas.push(nuevaVenta);
  guardarVentasEnLocal();
  
  // Notificar a la empleada
  alert(`✅ Venta registrada por $${total.toFixed(2)}\n💰 Efectivo: $${efectivo}\n📲 Transferencia: $${transferencia}\n📈 Ganancia: $${gananciaVenta.toFixed(2)}`);
  
  // ----- LIMPIAR Y REFRESCAR -----
  limpiarCarrito();
  renderProductos();  // Refresca el catálogo con los nuevos stocks
  
  // Si estamos en la pestaña de reportes, la actualizamos
  if (document.getElementById('tabReportes').classList.contains('active')) {
    actualizarReportes();
  }
}

/**
 * Limpia completamente el carrito actual
 */
function limpiarCarrito() {
  carrito = [];
  document.getElementById('efectivo').value = 0;
  document.getElementById('transferencia').value = 0;
  renderCarrito();
}

// ====================== REPORTES ESTADÍSTICOS ======================

/**
 * Actualiza todos los indicadores en la pestaña de reportes
 * Calcula:
 * - Ventas del día
 * - Totales del mes seleccionado
 * - Desglose efectivo/transferencia
 * - Ganancia neta
 * - Productos con stock bajo
 * - Top 5 productos más vendidos
 */
function actualizarReportes() {
  const mes = document.getElementById('filtroMes').value;
  if (!mes) return;
  
  const [year, month] = mes.split('-');
  const monthNum = parseInt(month);
  
  // Filtrar ventas del mes seleccionado
  const ventasMes = ventas.filter(v => {
    const d = new Date(v.fecha);
    return d.getFullYear() == year && (d.getMonth() + 1) == monthNum;
  });
  
  // ----- 1. VENTAS DEL DÍA -----
  const hoy = new Date().toISOString().slice(0, 10);
  const ventasHoy = ventas.filter(v => v.fecha.slice(0, 10) === hoy);
  const totalHoy = ventasHoy.reduce((sum, v) => sum + v.total, 0);
  document.getElementById('ventasHoy').innerHTML = `
    ${ventasHoy.length} venta(s)<br>
    <strong style="font-size:1.3rem">$${totalHoy.toFixed(2)}</strong>
  `;
  
  // ----- 2. TOTALES DEL MES -----
  const totalMesVentas = ventasMes.reduce((sum, v) => sum + v.total, 0);
  const totalEfectivo = ventasMes.reduce((sum, v) => sum + v.efectivo, 0);
  const totalTransferencia = ventasMes.reduce((sum, v) => sum + v.transferencia, 0);
  const gananciaNeta = ventasMes.reduce((sum, v) => sum + v.ganancia, 0);
  
  document.getElementById('totalMes').innerHTML = `<strong>$${totalMesVentas.toFixed(2)}</strong>`;
  document.getElementById('totalEfectivo').innerHTML = `$${totalEfectivo.toFixed(2)}`;
  document.getElementById('totalTransferencia').innerHTML = `$${totalTransferencia.toFixed(2)}`;
  document.getElementById('gananciaNeta').innerHTML = `<strong style="color:#27ae60">$${gananciaNeta.toFixed(2)}</strong>`;
  
  // ----- 3. STOCK BAJO (≤ 3 unidades) -----
  const bajoStock = inventario.productos.filter(p => p.cantidad <= 3);
  if (bajoStock.length) {
    document.getElementById('stockBajoLista').innerHTML = bajoStock
      .map(p => `⚠️ ${p.nombre}: ${p.cantidad} uds`)
      .join('<br>');
  } else {
    document.getElementById('stockBajoLista').innerHTML = '✅ Todos los productos con stock suficiente';
  }
  
  // ----- 4. TOP 5 PRODUCTOS MÁS VENDIDOS (por cantidad de unidades) -----
  const contadorProductos = {};
  
  ventasMes.forEach(venta => {
    venta.items.forEach(item => {
      const nombre = item.nombre;
      contadorProductos[nombre] = (contadorProductos[nombre] || 0) + item.cantidad;
    });
  });
  
  // Convertir a array de [nombre, cantidad] y ordenar descendente
  const topProductos = Object.entries(contadorProductos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (topProductos.length) {
    document.getElementById('topProductos').innerHTML = topProductos
      .map(([nombre, cantidad], idx) => `${idx+1}. ${nombre}: ${cantidad} unidades`)
      .join('<br>');
  } else {
    document.getElementById('topProductos').innerHTML = '📭 No hay ventas en el mes seleccionado';
  }
}

/**
 * Cambia entre la pestaña de ventas y la de reportes
 * @param {string} tab - 'vender' o 'reportes'
 */
function cambiarTab(tab) {
  const venderPanel = document.getElementById('venderPanel');
  const reportesPanel = document.getElementById('reportesPanel');
  const tabVender = document.getElementById('tabVender');
  const tabReportes = document.getElementById('tabReportes');
  
  if (tab === 'vender') {
    venderPanel.classList.add('active');
    reportesPanel.classList.remove('active');
    tabVender.classList.add('active');
    tabReportes.classList.remove('active');
  } else {
    venderPanel.classList.remove('active');
    reportesPanel.classList.add('active');
    tabVender.classList.remove('active');
    tabReportes.classList.add('active');
    actualizarReportes();  // refrescar datos al mostrar
  }
}
