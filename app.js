const DB_NAME = 'IncidenciasDB';
const DB_VERSION = 1;
const STORE_NAME = 'incidencias';
let db;

// 1. Inicializar Base de Datos (Memoria del Teléfono)
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => reject("Error al abrir base de datos local");
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
            loadDashboard(); // Mostrar incidencias guardadas
        };
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// 2. Funciones de Interfaz
function openForm() {
    document.getElementById('formModal').classList.add('active');
    // Reiniciar botón de foto
    document.getElementById('photoInput').value = "";
    document.getElementById('photoLabel').innerText = "Tomar Fotografía";
}

function closeForm() {
    document.getElementById('formModal').classList.remove('active');
}

function selectChip(element) {
    let siblings = element.parentElement.getElementsByClassName('chip');
    for(let c of siblings) c.classList.remove('active');
    element.classList.add('active');
}

function selectIssue(element, type) {
    selectChip(element);
    let qtySelector = document.getElementById('qtySelector');
    qtySelector.style.display = (type === 'diferencia') ? 'flex' : 'none';
}

function changeQty(id, delta) {
    let el = document.getElementById(id + '-val');
    let val = parseInt(el.innerText) + delta;
    if(val < 0) val = 0;
    el.innerText = val;
}

// Escuchar captura de cámara
document.getElementById('photoInput').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
        document.getElementById('photoLabel').innerText = "¡Fotografía Capturada! 📸";
    }
});

// 3. Guardar Incidencia Realmente
function submitForm() {
    let groups = document.querySelectorAll('.form-group');
    
    let activeClient = groups[0].querySelector('.chip.active');
    let clientName = activeClient ? activeClient.innerText : '[Sin Cliente]';

    let activeIssue = groups[1].querySelector('.chip.active');
    let issueName = activeIssue ? activeIssue.innerText : '[Sin Problema]';

    let details = '';
    if (issueName === 'Diferencia de bultos') {
        let mani = document.getElementById('mani-val').innerText;
        let llego = document.getElementById('llego-val').innerText;
        details = `\nManifestaba: ${mani}\nLlegaron: ${llego}`;
    } else if (issueName !== '[Sin Problema]') {
        details = `\n${issueName}`;
    }

    // Extraer archivo real de foto
    let photoInput = document.getElementById('photoInput');
    let photoFile = photoInput.files.length > 0 ? photoInput.files[0] : null;

    let incidencia = {
        client: clientName,
        issue: issueName,
        details: details,
        photo: photoFile,
        date: new Date().toISOString(),
        status: 'Pendiente'
    };

    // Escribir en base de datos local
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(incidencia);
    
    tx.oncomplete = () => {
        closeForm();
        loadDashboard(); 
        
        // El texto rápido para el WhatsApp de ahora
        let mensaje = '';
        if (issueName === 'Devolución') {
            mensaje = `¿Cómo se procede con este bulto de ${clientName}?\n\nAdjunto fotografía.`;
        } else {
            mensaje = `Cliente: ${clientName}\nIncidencia:${details}\n\nAdjunto fotografía.`;
        }
        let waLink = `whatsapp://send?text=${encodeURIComponent(mensaje)}`;
        window.location.href = waLink;
    };
}

// 4. Tablero Dinámico (Cargar de la Base de Datos)
function loadDashboard() {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => {
        const incidencias = request.result;
        const container = document.getElementById('incidenciasContainer');
        container.innerHTML = '';
        
        if (incidencias.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center; margin-top: 40px;">No hay incidencias hoy. ¡Buen trabajo!</p>';
            return;
        }

        incidencias.forEach(inc => {
            let statusClass = inc.status === 'Pendiente' ? 'status-pending' : 'status-resolved';
            let issueText = inc.issue === 'Devolución' ? 
                `¿Cómo se procede con este bulto de ${inc.client}?` : 
                `Incidencia: ${inc.details.replace(/\n/g, '<br>')}`;

            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <div class="card-header">
                    <div class="client-name">${inc.client}</div>
                    <div class="status-badge ${statusClass}" onclick="toggleStatus(${inc.id}, '${inc.status}', event)" style="cursor: pointer;">
                        <div class="status-dot"></div>
                        ${inc.status}
                    </div>
                </div>
                <div class="issue-text">
                    ${issueText}
                </div>
                ${inc.photo ? '<div style="font-size: 0.8rem; color: #4ade80; margin-top: 8px;">📸 Foto guardada en memoria</div>' : ''}
            `;
            container.appendChild(card);
        });
    };
}

function toggleStatus(id, currentStatus, event) {
    if(event) event.stopPropagation();
    const newStatus = currentStatus === 'Pendiente' ? 'Corregido' : 'Pendiente';
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const request = store.get(id);
    request.onsuccess = () => {
        let inc = request.result;
        inc.status = newStatus;
        store.put(inc);
        tx.oncomplete = () => loadDashboard();
    };
}

// 5. Compartir con Web Share API (Texto + Fotos Adjuntas)
async function generateEmail() {
    const tx = db.transaction([STORE_NAME], 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = async () => {
        const incidencias = request.result;
        if (incidencias.length === 0) {
            alert("No hay incidencias registradas para reportar.");
            return;
        }

        let bodyText = "Buenos días.\n\nDurante la jornada se registraron las siguientes incidencias.\n\n";
        let filesArray = [];

        incidencias.forEach((inc, index) => {
            let issue = inc.issue === 'Devolución' ? 
                `¿Cómo se procede con este bulto de ${inc.client}?` : 
                `Incidencia: ${inc.details}`;
                
            bodyText += `${index + 1})\nCliente: ${inc.client}\n${issue}\nResultado: ${inc.status}\n--------------------\n\n`;
            
            if (inc.photo) {
                // Renombrar la foto para que quien reciba el correo sepa de qué es
                const ext = inc.photo.name ? inc.photo.name.split('.').pop() : 'jpg';
                const renamedFile = new File([inc.photo], `Incidencia_${index + 1}_${inc.client.replace(/ /g, '_')}.${ext}`, { type: inc.photo.type });
                filesArray.push(renamedFile);
            }
        });
        
        bodyText += "Saludos.\nMarco";
        let today = new Date().toLocaleDateString('es-ES');

        if (navigator.share) {
            try {
                let shareData = {
                    title: `Reporte de Incidencias ${today}`,
                    text: bodyText
                };
                
                // Intentar adjuntar las fotos si el celular lo soporta
                if (filesArray.length > 0 && navigator.canShare && navigator.canShare({ files: filesArray })) {
                    shareData.files = filesArray;
                }
                
                await navigator.share(shareData);
                
                // Opcional: Vaciar la BD después de enviar
                if(confirm("¿Reporte enviado con éxito? ¿Deseas vaciar las incidencias para empezar limpio mañana?")) {
                    const clearTx = db.transaction([STORE_NAME], 'readwrite');
                    clearTx.objectStore(STORE_NAME).clear();
                    clearTx.oncomplete = () => loadDashboard();
                }
            } catch (err) {
                console.error("Error al compartir nativo", err);
                // Fallback si cancela o falla
            }
        } else {
            // Si lo abre en un navegador viejo, usa el método básico (sin fotos adjuntas auto)
            let subject = `Incidencias del día ${today}`;
            let mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
            window.location.href = mailtoLink;
        }
    };
}

window.onload = initDB;
