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

// 1.5. Configuración IA
let geminiApiKey = localStorage.getItem('geminiApiKey') || '';

function openSettings() {
    document.getElementById('apiKeyInput').value = geminiApiKey;
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
    geminiApiKey = document.getElementById('apiKeyInput').value.trim();
    localStorage.setItem('geminiApiKey', geminiApiKey);
    closeSettings();
    alert('Configuración guardada correctamente.');
}

// 2. Funciones de Interfaz
function openForm() {
    document.getElementById('formModal').classList.add('active');
    // Limpiar formulario
    document.getElementById('clientInput').value = "";
    // Limpiar IA
    document.getElementById('aiVerificationGroup').style.display = 'none';
    document.getElementById('aiSummary').style.display = 'none';
    document.getElementById('aiSummary').value = '';
    document.getElementById('aiLoading').style.display = 'none';
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

// Escuchar captura de cámara y activar IA
document.getElementById('photoInput').addEventListener('change', async function(e) {
    if (e.target.files.length > 0) {
        document.getElementById('photoLabel').innerText = "¡Fotografía Capturada! 📸";
        
        if (geminiApiKey) {
            document.getElementById('aiVerificationGroup').style.display = 'block';
            document.getElementById('aiLoading').style.display = 'block';
            document.getElementById('aiSummary').style.display = 'none';
            
            try {
                // Comprimir imagen
                const file = e.target.files[0];
                const base64Image = await compressAndEncodeImage(file);
                
                // Llamar a Gemini
                const result = await analyzeWithGemini(base64Image);
                
                document.getElementById('aiLoading').style.display = 'none';
                document.getElementById('aiSummary').style.display = 'block';
                document.getElementById('aiSummary').value = result;
            } catch (err) {
                document.getElementById('aiLoading').style.display = 'none';
                document.getElementById('aiSummary').style.display = 'block';
                document.getElementById('aiSummary').value = "Error en IA: " + err.message;
            }
        }
    }
});

// Función para comprimir imagen (max 800px)
function compressAndEncodeImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 800;
                let width = img.width;
                let height = img.height;

                if (width > height && width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                } else if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                // Retornar solo el string base64 sin el prefijo
                resolve(dataUrl.split(',')[1]);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// Llamada a la API REST de Gemini
async function analyzeWithGemini(base64Image) {
    let clientName = document.getElementById('clientInput').value.trim() || 'el cliente';
    let groups = document.querySelectorAll('.form-group');
    
    let activeIssue = groups[1].querySelector('.chip.active');
    let issueName = activeIssue ? activeIssue.innerText : '';

    let prompt = `Extrae el número de OT, OD o Id Referencia de esta etiqueta. Escribe ÚNICAMENTE este mensaje: "¿Cómo procedemos con este bulto de ${clientName} con OT [NÚMERO EXTRAÍDO]?". Si no logras leer el número, escribe "No se pudo leer el número de OT en la foto."`;
    
    // Si no es devolución, ajustamos un poco el prompt
    if (issueName !== 'Devolución') {
        prompt = `Extrae el número de OT, OD o Id Referencia de esta etiqueta. Escribe el número extraído o "No detectado".`;
    }

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: base64Image } }
            ]
        }]
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error('No se pudo conectar con Gemini. Revisa tu API Key.');
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0].content.parts[0].text) {
        return data.candidates[0].content.parts[0].text.trim();
    }
    return "Resultado vacío de la IA.";
}

// 3. Guardar Incidencia Realmente
function submitForm() {
    let clientName = document.getElementById('clientInput').value.trim() || '[Sin Cliente]';
    let groups = document.querySelectorAll('.form-group');
    
    let activeIssue = groups[1].querySelector('.chip.active');
    let issueName = activeIssue ? activeIssue.innerText : '[Sin Problema]';

    let aiSummaryVal = document.getElementById('aiSummary').value.trim();
    let details = '';
    
    if (aiSummaryVal && issueName !== 'Devolución') {
        details = `\nIA (OT): ${aiSummaryVal}`;
    } else if (issueName === 'Diferencia de bultos') {
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
        if (aiSummaryVal && issueName === 'Devolución') {
            mensaje = `${aiSummaryVal}\n\nAdjunto fotografía.`;
        } else if (issueName === 'Devolución') {
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
