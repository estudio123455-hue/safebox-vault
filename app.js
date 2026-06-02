// ==========================================
// 1. VARIABLES GLOBALES Y SELECTORES
// ==========================================
const loginScreen = document.getElementById('login-screen');
const vaultScreen = document.getElementById('vault-screen');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('secret-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const uploadZone = document.querySelector('.upload-zone');

const currentFolderPath = document.getElementById('current-folder-path');
const btnGoRoot = document.getElementById('btn-go-root');
const newFolderNameInput = document.getElementById('new-folder-name');
const btnCreateFolder = document.getElementById('btn-create-folder');
const uploadText = document.getElementById('upload-text');

let masterKey = null; 
let db = null;        
let currentFolder = "root"; 
let inactivityTimeout = null; // Guardará el temporizador de Auto-Lock

const IV_LENGTH = 12; 
const SALT = new TextEncoder().encode("safebox_salt_12345"); 

// CONTRASEÑA DE PÁNICO (Cambia esto por la que tú quieras)
const DURESS_PASSWORD = "PANIClocal666"; 

// ==========================================
// 2. INICIALIZACIÓN DE INDEXEDDB
// ==========================================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("SafeBoxDB", 1);

        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains("files")) {
                database.createObjectStore("files", { keyPath: "id", autoIncrement: true });
            }
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };

        request.onerror = (e) => reject("Error al abrir IndexedDB");
    });
}

// ==========================================
// 3. SEGURIDAD, CRIPTOGRAFÍA Y AUTO-LOCK
// ==========================================
async function generateKeyFromPassword(password) {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const baseKey = await window.crypto.subtle.importKey(
        "raw", passwordBytes, { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: SALT, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Lógica de Autodestrucción Completa
function triggerDuressDestruction() {
    console.warn("💥 SEÑAL DE PÁNICO DETECTADA. EJECUTANDO PURGA DE DATOS.");
    
    if(db) db.close(); // Cerramos conexión activa

    const deleteRequest = indexedDB.deleteDatabase("SafeBoxDB");
    
    deleteRequest.onsuccess = () => {
        alert("⚠️ CRITICAL OVERRIDE: Sistema purgado por completo.");
        window.location.reload(); // Reinicia la app en blanco
    };
    deleteRequest.onerror = () => {
        // En caso de fallo forzamos limpieza manual de interfaz
        window.location.reload();
    };
}

// Gestión del Temporizador de Inactividad (Auto-Lock)
function resetInactivityTimer() {
    if (!masterKey) return; // Si está bloqueado, no hace nada

    clearTimeout(inactivityTimeout);
    
    // Configurado a 60000 ms (1 Minuto) para pruebas rápidas. Puedes subirlo a más.
    inactivityTimeout = setTimeout(() => {
        console.log("⏱️ Auto-Lock activado por inactividad.");
        lockVault();
        alert("🔒 Bóveda bloqueada automáticamente por inactividad.");
    }, 60000); 
}

function lockVault() {
    masterKey = null;
    clearTimeout(inactivityTimeout);
    fileList.innerHTML = '';
    currentFolder = "root";
    vaultScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
}

// Activar monitoreo de actividad humana en la app
function startMonitoringActivity() {
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(eventName => {
        window.addEventListener(eventName, resetInactivityTimer);
    });
}

function stopMonitoringActivity() {
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(eventName => {
        window.removeEventListener(eventName, resetInactivityTimer);
    });
}

// ==========================================
// 4. OPERACIONES DE CARPETAS Y ARCHIVOS
// ==========================================

// Crear carpeta manualmente y devolver su ID mediante una Promesa
function createFolderWithName(name, parentId = "root") {
    return new Promise((resolve) => {
        const folderRecord = { name: name, parent: parentId, isFolder: true };
        const transaction = db.transaction(["files"], "readwrite");
        const store = transaction.objectStore("files");
        const request = store.add(folderRecord);

        request.onsuccess = (e) => resolve(e.target.result); // Retorna el ID generado
    });
}

function createFolder() {
    const name = newFolderNameInput.value.trim();
    if (!name) return;
    createFolderWithName(name, currentFolder).then(() => {
        newFolderNameInput.value = '';
        renderFiles();
    });
}

// Cifrar y Guardar Archivo Genérico
async function encryptAndSaveFile(file, targetFolderId = currentFolder) {
    if (!masterKey) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    
    reader.onload = async (e) => {
        const fileBytes = e.target.result;
        const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));

        const encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            masterKey,
            fileBytes
        );

        const fileRecord = {
            name: file.name,
            type: file.type,
            size: file.size,
            iv: iv,
            encryptedData: encryptedBuffer,
            isFolder: false,
            folder: targetFolderId.toString()
        };

        const transaction = db.transaction(["files"], "readwrite");
        const store = transaction.objectStore("files");
        store.add(fileRecord);
        transaction.oncomplete = () => renderFiles();
    };
}

// ==========================================
// 5. PROCESAMIENTO AVANZADO DE ARRASTRE DE CARPETAS (WEBKIT API)
// ==========================================
async function traverseFileTree(item, pathId = currentFolder) {
    if (item.isFile) {
        // Es un archivo dentro de una estructura arrastrada
        item.file((file) => {
            encryptAndSaveFile(file, pathId);
        });
    } else if (item.isDirectory) {
        // Es una carpeta entera arrastrada. Creamos el reflejo en la BD
        const newId = await createFolderWithName(item.name, pathId);
        
        // Leemos el contenido interior de esa carpeta del sistema operativo
        const dirReader = item.createReader();
        dirReader.readEntries((entries) => {
            for (let i = 0; i < entries.length; i++) {
                traverseFileTree(entries[i], newId);
            }
        });
    }
}

// ==========================================
// 6. OPERACIONES DE CONTROL BASE (DESCÁRGAS / RENDER)
// ==========================================
async function decryptAndDownloadFile(fileId) {
    const transaction = db.transaction(["files"], "readonly");
    const store = transaction.objectStore("files");
    const request = store.get(fileId);

    request.onsuccess = async (e) => {
        const record = e.target.result;
        if (!record) return;
        try {
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: record.iv },
                masterKey,
                record.encryptedData
            );
            const blob = new Blob([decryptedBuffer], { type: record.type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = record.name;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            alert("Error de descifrado masivo.");
        }
    };
}

function deleteItem(itemId) {
    const transaction = db.transaction(["files"], "readwrite");
    const store = transaction.objectStore("files");
    store.delete(itemId);
    transaction.oncomplete = () => renderFiles();
}

function changeFolder(folderId, folderName) {
    currentFolder = folderId.toString();
    if (currentFolder === "root") {
        currentFolderPath.textContent = "";
        uploadText.textContent = "Arrastra archivos/carpetas aquí para cargarlos en la Raíz";
    } else {
        currentFolderPath.textContent = ` ➔ 📂 ${folderName}`;
        uploadText.textContent = `Cargando dentro de: ${folderName}`;
    }
    renderFiles();
}

function renderFiles() {
    const transaction = db.transaction(["files"], "readonly");
    const store = transaction.objectStore("files");
    const request = store.getAll();

    request.onsuccess = (e) => {
        const items = e.target.result;
        fileList.innerHTML = '';

        const currentItems = items.filter(item => {
            return item.isFolder ? item.parent === currentFolder : item.folder === currentFolder;
        });

        if (currentItems.length === 0) {
            fileList.innerHTML = '<p class="empty-msg">// CARPETA VACÍA - ESPERANDO INYECCIÓN DE DATOS...</p>';
            return;
        }

        currentItems.sort((a, b) => b.isFolder - a.isFolder);

        currentItems.forEach(item => {
            const li = document.createElement('li');
            li.style.display = "flex";
            li.style.justifyContent = "space-between";
            li.style.alignItems = "center";
            li.style.padding = "12px";
            li.style.marginBottom = "6px";

            if (item.isFolder) {
                li.classList.add('item-folder');
                li.innerHTML = `
                    <div onclick="changeFolder(${item.id}, '${item.name}')" style="flex-grow: 1; display: flex; align-items: center; cursor:pointer;">
                        <span class="item-icon">📁</span>
                        <span style="color: #00e5ff; font-weight: 600;">${item.name}/</span>
                    </div>
                    <div>
                        <button onclick="deleteItem(${item.id})" style="width:auto; padding: 4px 10px; font-size:11px;">[X] BORRAR</button>
                    </div>
                `;
            } else {
                const sizeKB = (item.size / 1024).toFixed(1);
                li.innerHTML = `
                    <div style="display: flex; align-items: center;">
                        <span class="item-icon">⚡</span>
                        <div>
                            <span style="color: #e2e8f0;">${item.name}</span>
                            <span style="color: #475569; font-size: 11px; display: block;">SIZE: ${sizeKB} KB</span>
                        </div>
                    </div>
                    <div>
                        <button onclick="decryptAndDownloadFile(${item.id})" style="width:auto; padding: 4px 10px; font-size:11px; margin-right:4px;">DECRYPT</button>
                        <button onclick="deleteItem(${item.id})" style="width:auto; padding: 4px 10px; font-size:11px;">PURGE</button>
                    </div>
                `;
            }
            fileList.appendChild(li);
        });
    };
}

// ==========================================
// 7. LISTENERS DE EVENTOS RECONFIGURADOS
// ==========================================

btnCreateFolder.addEventListener('click', createFolder);
newFolderNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createFolder(); });
btnGoRoot.addEventListener('click', () => changeFolder("root", ""));

// Login con interceptor de pánico
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value;

    // INTERCEPTOR: Si escribe la clave secreta de destrucción
    if (password === DURESS_PASSWORD) {
        passwordInput.value = '';
        triggerDuressDestruction();
        return;
    }

    if (password.length < 4) {
        loginError.textContent = "CONEXIÓN DENEGADA: CLAVE DEMASIADO CORTA.";
        return;
    }

    try {
        masterKey = await generateKeyFromPassword(password);
        passwordInput.value = '';
        loginError.textContent = '';
        loginScreen.classList.add('hidden');
        vaultScreen.classList.remove('hidden');
        
        changeFolder("root", ""); 
        startMonitoringActivity(); // Iniciamos temporizador de inactividad
        resetInactivityTimer();
    } catch (error) {
        loginError.textContent = "ERROR CRÍTICO DE AUTENTICACIÓN.";
    }
});

// Logout manual
logoutBtn.addEventListener('click', () => {
    stopMonitoringActivity();
    lockVault();
});

// Interacción de clicks en la zona de subida
uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => encryptAndSaveFile(file));
});

// DRAG AND DROP AVANZADO (Capaz de mapear carpetas completas)
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = "#00ff66";
});
uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = "rgba(0, 229, 255, 0.3)";
});
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = "rgba(0, 229, 255, 0.3)";
    
    const items = e.dataTransfer.items;
    if (items) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry();
            if (item) {
                traverseFileTree(item); // Analiza si es archivo o carpeta recursiva
            }
        }
    }
});

// Inicializar base de datos
initDB().catch(err => console.error(err));
