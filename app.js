// =========================================================================
// STATO GLOBALE DELL'APPLICAZIONE
// =========================================================================
let listaEsperienze = []; // Array contenente la rotta attiva scaricata da Google Sheets
let html5QrCode;         // Istanza dello scanner QR Code

// Riferimenti agli elementi HTML
const btnConfig = document.getElementById('btn-config');
const qrModal = document.getElementById('qr-modal');
const btnCloseQr = document.getElementById('btn-close-qr');
const btnFly = document.getElementById('btn-fly');
const btnPlay = document.getElementById('btn-play');
const btnHear = document.getElementById('btn-hear');
const btnImage = document.getElementById('btn-image');
const cameraInput = document.getElementById('camera-input');
const audioPlayer = document.getElementById('audio-player');

// =========================================================================
// 1. INIZIALIZZAZIONE E CARICAMENTO DATI ALL'AVVIO
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
    // Controlliamo se ci sono dati di una rotta precedentemente salvati sul telefono
    const datiSalvati = localStorage.getItem('mab_lighthouse_data');
    if (datiSalvati) {
        listaEsperienze = JSON.parse(datiSalvati);
        console.log("Rotta precedente ripristinata dalla memoria:", listaEsperienze);
        avviaGeofencing();
    }
});

// =========================================================================
// 2. SCANNER QR CODE (CONFIGURAZIONE DA GOOGLE SHEETS)
// =========================================================================
btnConfig.addEventListener('click', () => {
    qrModal.style.display = 'flex';
    html5QrCode = new Html5Qrcode("reader");
    
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    // Forza l'uso della fotocamera posteriore (environment)
    html5QrCode.start(
        { facingMode: "environment" }, 
        config, 
        onQrCodeSuccess, 
        onQrCodeError
    ).catch(err => {
        console.error("Impossibile avviare fotocamera:", err);
        alert("Permesso fotocamera negato o non disponibile.");
        chiudiScanner();
    });
});

function onQrCodeSuccess(decodedText) {
    console.log(`QR Code rilevato: ${decodedText}`);
    let sheetId = estraiIdDaLinkGoogleSheets(decodedText);
    
    if (sheetId) {
        localStorage.setItem('mab_lighthouse_sheet_id', sheetId);
        scaricaConfigurazioneDaGoogleSheets(sheetId);
    } else {
        alert("QR Code non valido. Deve contenere il link o l'ID di un Foglio Google.");
    }
    chiudiScanner();
}

function onQrCodeError(err) { /* Ignorato per non intasare i log dei frame */ }

btnCloseQr.addEventListener('click', chiudiScanner);

function chiudiScanner() {
    qrModal.style.display = 'none';
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => html5QrCode.clear()).catch(err => console.error(err));
    }
}

function estraiIdDaLinkGoogleSheets(url) {
    const matches = url.match(/\/d\/([a-zA-O0-9-_]+)/);
    return matches ? matches[1] : url; // Se non è un link completo, assume sia l'ID puro
}

// =========================================================================
// 3. DOWNLOAD E PARSING DEL FOGLIO GOOGLE (FORMATO CSV)
// =========================================================================
async function scaricaConfigurazioneDaGoogleSheets(sheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Impossibile accedere al file.");
        
        const dataText = await response.text();
        listaEsperienze = parseCSV(dataText);
        
        // Salviamo stabilmente sul dispositivo
        localStorage.setItem('mab_lighthouse_data', JSON.stringify(listaEsperienze));
        alert("Configurazione della rotta completata con successo!");
        
        avviaGeofencing();
    } catch (error) {
        console.error(error);
        alert("Errore nel caricamento. Assicurati che il foglio sia condiviso come 'Chiunque abbia il link può visualizzare'.");
    }
}

function parseCSV(text) {
    const lines = text.split("\n");
    const result = [];
    if (lines.length === 0) return result;
    
    const headers = lines[0].split(",").map(h => h.trim());

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const currentline = lines[i].split(",").map(cell => cell.trim());
        const obj = {};
        
        headers.forEach((header, index) => {
            let value = currentline[index];
            if (header === "Latitudine" || header === "Longitudine" || header === "Raggio_Metri") {
                value = parseFloat(value);
            }
            obj[header] = value;
        });
        result.push(obj);
    }
    return result;
}

// =========================================================================
// 4. MOTORE DI GEOFENCING (GPS ALTA PRECISIONE)
// =========================================================================
function avviaGeofencing() {
    if (!navigator.geolocation) {
        alert("Il dispositivo non supporta il GPS.");
        return;
    }

    const opzioniGps = {
        enableHighAccuracy: true, // Forza l'uso del sensore GPS hardware
        timeout: 10000,
        maximumAge: 0
    };

    navigator.geolocation.watchPosition(elaboraPosizioneUtente, (err) => console.warn(err), opzioniGps);
}

function elaboraPosizioneUtente(position) {
    const latUtente = position.coords.latitude;
    const lonUtente = position.coords.longitude;
    
    resetStatoPulsanti();

    listaEsperienze.forEach(esperienza => {
        const distanza = calcolaDistanzaMetri(latUtente, lonUtente, esperienza.Latitudine, esperienza.Longitudine);
        
        if (distanza <= esperienza.Raggio_Metri) {
            console.log(`Punto sbloccato! Funzione: ${esperienza.Tipo_Funzione} a ${distanza.toFixed(1)}m`);
            attivaEsperienzaDinamica(esperienza.Tipo_Funzione, esperienza.ID_Risorsa_Drive);
        }
    });
}

function resetStatoPulsanti() {
    [btnFly, btnPlay, btnHear, btnImage].forEach(btn => {
        btn.disabled = true;
        btn.removeAttribute('data-drive-id');
    });
}

function attivaEsperienzaDinamica(tipo, idRisorsa) {
    let bottone;
    switch(tipo.toUpperCase()) {
        case 'FLY': bottone = btnFly; break;
        case 'PLAY': bottone = btnPlay; break;
        case 'HEAR': bottone = btnHear; break;
        case 'IMAGE': bottone = btnImage; break;
    }
    
    if (bottone) {
        bottone.disabled = false;
        bottone.setAttribute('data-drive-id', idRisorsa);
    }
}

// Formula di Haversine per calcolo geodetico della distanza
function calcolaDistanzaMetri(lat1, lon1, lat2, lon2) {
    const R = 6371000; 
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// =========================================================================
// 5. LOGICA DELLE AZIONI AL CLICK (FLY, PLAY, HEAR, IMAGE)
// =========================================================================
btnFly.addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const urlMappa = `https://www.google.com/maps/@${lat},${lon},200m/data=!3m1!1e3`;
        window.open(urlMappa, '_blank');
    });
});

function riproduciAudioDaDrive(bottone) {
    const driveId = bottone.getAttribute('data-drive-id');
    if (!driveId) return;

    const urlStreaming = `https://docs.google.com/uc?export=download&id=${driveId}`;
    audioPlayer.src = urlStreaming;
    audioPlayer.play()
        .then(() => alert("Esperienza audio avviata..."))
        .catch(err => alert("Errore di riproduzione. Verifica i permessi del file su Drive."));
}

btnPlay.addEventListener('click', (e) => riproduciAudioDaDrive(e.currentTarget));
btnHear.addEventListener('click', (e) => riproduciAudioDaDrive(e.currentTarget));

btnImage.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const driveFolderId = btnImage.getAttribute('data-drive-id');
        alert(`Foto scattata! Pronta per essere inviata alla cartella Drive: ${driveFolderId || 'Default'}`);
        // Il file Blob è pronto per l'upload tramite le API di Drive o Apps Script
    }
});
