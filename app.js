let listaEsperienze = [];
let html5QrCode;
let mappaLeaflet = null;
let markerUtente = null;
let statiPrecedentiAbilitati = { FLY: false, PLAY: false, HEAR: false, IMAGE: false };

const btnConfig = document.getElementById('btn-config');
const qrModal = document.getElementById('qr-modal');
const btnCloseQr = document.getElementById('btn-close-qr');
const btnSaveManual = document.getElementById('btn-save-manual');
const inputManualUrl = document.getElementById('input-manual-url');
const activityTitle = document.getElementById('activity-title');

const btnFly = document.getElementById('btn-fly');
const btnPlay = document.getElementById('btn-play');
const btnHear = document.getElementById('btn-hear');
const btnImage = document.getElementById('btn-image');
const cameraInput = document.getElementById('camera-input');
const audioPlayer = document.getElementById('audio-player');

const mapScreen = document.getElementById('map-screen');
const btnCloseMap = document.getElementById('btn-close-map');

window.addEventListener('DOMContentLoaded', () => {
    const datiSalvati = localStorage.getItem('mab_lighthouse_data');
    if (datiSalvati) {
        listaEsperienze = JSON.parse(datiSalvati);
        if(listaEsperienze.length > 0 && listaEsperienze[0].Nome_Attivita) {
            activityTitle.innerText = listaEsperienze[0].Nome_Attivita;
        }
        avviaGeofencing();
    }
});

function estraiIdUniversale(input) {
    if (!input) return "";
    const matchD = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (matchD) return matchD[1];
    return input.trim();
}

btnSaveManual.addEventListener('click', () => {
    let urlInserito = inputManualUrl.value;
    let sheetId = estraiIdUniversale(urlInserito);
    if (sheetId && sheetId.length > 10) {
        scaricaConfigurazioneDaGoogleSheets(sheetId);
        qrModal.style.display = 'none';
        inputManualUrl.value = "";
    } else {
        alert("Inserisci un link valido di Google Fogli.");
    }
});

function parseCSV(text) {
    const lines = text.split("\n");
    const result = [];
    if (lines.length === 0) return result;
    
    const headers = lines[0].split(",").map(h => h.trim().replace(/\r/g, ""));

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const currentline = lines[i].split(",").map(cell => cell.trim().replace(/\r/g, ""));
        const obj = {};
        
        headers.forEach((header, index) => {
            obj[header] = currentline[index];
        });

        if (obj["Coordinate"]) {
            const coordinatePulite = obj["Coordinate"].split(",");
            obj["Latitudine"] = parseFloat(coordinatePulite[0]);
            obj["Longitudine"] = parseFloat(coordinatePulite[1]);
        }
        if (obj["Raggio_Metri"]) obj["Raggio_Metri"] = parseInt(obj["Raggio_Metri"]);
        
        result.push(obj);
    }
    return result;
}

async function scaricaConfigurazioneDaGoogleSheets(sheetId) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error();
        const dataText = await response.text();
        
        listaEsperienze = parseCSV(dataText);
        localStorage.setItem('mab_lighthouse_data', JSON.stringify(listaEsperienze));
        if(listaEsperienze.length > 0 && listaEsperienze[0].Nome_Attivita) {
            activityTitle.innerText = listaEsperienze[0].Nome_Attivita;
        }
        alert("Rotta memorizzata permanentemente!");
        avviaGeofencing();
    } catch (e) {
        alert("Errore di caricamento. Verifica la condivisione del foglio.");
    }
}

function avviaGeofencing() {
    navigator.geolocation.watchPosition(elaboraPosizioneUtente, (err) => console.log(err), {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 0
    });
}

function elaboraPosizioneUtente(position) {
    const latUtente = position.coords.latitude;
    const lonUtente = position.coords.longitude;
    
    if (mappaLeaflet && markerUtente) markerUtente.setLatLng([latUtente, lonUtente]);

    let statoAttualeBottoni = { FLY: false, PLAY: false, HEAR: false, IMAGE: false };
    let datiPuntoAttivo = null;

    listaEsperienze.forEach(esp => {
        const distanza = calcolaDistanzaMetri(latUtente, lonUtente, esp.Latitudine, esp.Longitudine);
        if (distanza <= esp.Raggio_Metri) {
            const tipo = esp.Tipo_Funzione.toUpperCase();
            statoAttualeBottoni[tipo] = true;
            if (tipo === 'IMAGE') datiPuntoAttivo = esp; // Memorizziamo il record intero del punto attivo
            else if (tipo === 'PLAY' || tipo === 'HEAR' || tipo === 'FLY') {
                btnFly.setAttribute('data-drive-id', estraiIdUniversale(esp.Link_Risorsa_Drive));
                btnPlay.setAttribute('data-drive-id', estraiIdUniversale(esp.Link_Risorsa_Drive));
                btnHear.setAttribute('data-drive-id', estraiIdUniversale(esp.Link_Risorsa_Drive));
            }
        }
    });

    // Se l'utente è in un punto IMAGE, salviamo i dati dinamici nel bottone come attributi HTML
    if (statoAttualeBottoni['IMAGE'] && datiPuntoAttivo) {
        btnImage.disabled = false;
        btnImage.setAttribute('data-mail', datiPuntoAttivo["Contatto_Email"] || "");
        btnImage.setAttribute('data-whatsapp', datiPuntoAttivo["Contatto_WhatsApp"] || "");
    } else {
        btnImage.disabled = true;
        btnImage.removeAttribute('data-mail');
        btnImage.removeAttribute('data-whatsapp');
    }

    let deveVibrare = false;
    ['FLY', 'PLAY', 'HEAR', 'IMAGE'].forEach(tipo => {
        if (statoAttualeBottoni[tipo] && !statiPrecedentiAbilitati[tipo]) deveVibrare = true;
        statiPrecedentiAbilitati[tipo] = statoAttualeBottoni[tipo];
    });
    if (deveVibrare && navigator.vibrate) navigator.vibrate([300, 100, 300]);

    btnFly.disabled = !statoAttualeBottoni['FLY'];
    btnPlay.disabled = !statoAttualeBottoni['PLAY'];
    btnHear.disabled = !statoAttualeBottoni['HEAR'];
}

btnFly.addEventListener('click', () => {
    mapScreen.style.display = 'flex';
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude; const lon = pos.coords.longitude;
        if (!mappaLeaflet) {
            mappaLeaflet = L.map('map').setView([lat, lon], 18);
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(mappaLeaflet);
            markerUtente = L.marker([lat, lon]).addTo(mappaLeaflet).bindPopup('Tu sei qui').openPopup();
        } else { mappaLeaflet.setView([lat, lon], 18); markerUtente.setLatLng([lat, lon]); }
    });
});
btnCloseMap.addEventListener('click', () => { mapScreen.style.display = 'none'; });

function playAudio(btn) {
    const id = btn.getAttribute('data-drive-id'); if (!id) return;
    audioPlayer.src = `https://docs.google.com/uc?export=download&id=${id}`;
    audioPlayer.play().catch(() => alert("Errore file audio."));
}
btnPlay.addEventListener('click', (e) => playAudio(e.currentTarget));
btnHear.addEventListener('click', (e) => playAudio(e.currentTarget));

// LOGICA DINAMICA FOTOCAMERA ED INVIO DA FOGLIO GOOGLE
btnImage.addEventListener('click', () => cameraInput.click());

cameraInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Recupera Mail e WhatsApp letti dal foglio di calcolo per quel punto specifico
    const mailDestinatario = btnImage.getAttribute('data-mail');
    const whatsappDestinatario = btnImage.getAttribute('data-whatsapp');

    if (!mailDestinatario && !whatsappDestinatario) {
        alert("Configurazione incompleta: nel Foglio Google non sono inseriti i contatti per questo punto.");
        return;
    }

    const oraLocale = new Date().toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'}).replace(':', 'h');
    const dataLocale = new Date().toISOString().slice(0,10);
    const nomeDefault = `Foto_${dataLocale}_${oraLocale}`;

    let nomeScelto = prompt("Dai un nome a questa foto per riconoscerla:", nomeDefault);
    if (nomeScelto === null) return;
    if (nomeScelto.trim() === "") nomeScelto = nomeDefault;

    const estensione = file.name.split('.').pop() || "jpg";
    const nomeFileFinale = `${nomeScelto.replace(/[^a-zA-Z0-9-_ ]/g, '_')}.${estensione}`;
    const nomeAttivita = activityTitle.innerText;

    // SCELTA AUTOMATICA DEL CANALE IN BASE A COSA È STATO COMPILATO NEL FOGLIO GOOGLE
    if (whatsappDestinatario && whatsappDestinatario.trim() !== "") {
        // Se c'è WhatsApp, predilige WhatsApp
        const numeroPulito = whatsappDestinatario.replace(/[^0-9]/g, '');
        const testo = encodeURIComponent(`*MAB Lighthouse* 📸\n\nEcco la foto per l'attività: _${nomeAttivita}_\n\n👉 *Nota:* Ricordati di allegare l'immagine alla chat!\nNome file assegnato: *${nomeFileFinale}*`);
        window.open(`https://api.whatsapp.com/send?phone=${numeroPulito}&text=${testo}`, '_blank');
    } else if (mailDestinatario && mailDestinatario.trim() !== "") {
        // Altrimenti usa la mail
        const oggetto = encodeURIComponent(`MAB Lighthouse - ${nomeAttivita}`);
        const corpo = encodeURIComponent(`Ciao!\n\nEcco i dettagli della foto scattata.\n\n👉 NOTA PER L'UTENTE: Ricordati di allegare l'ultima foto cliccando sulla graffetta (📎).\n\nNome file assegnato: ${nomeFileFinale}\n\nInviato tramite MAB Lighthouse.`);
        window.location.href = `mailto:${mailDestinatario}?subject=${oggetto}&body=${corpo}`;
    }
});

btnConfig.addEventListener('click', () => {
    qrModal.style.display = 'flex';
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, 
        (txt) => { scaricaConfigurazioneDaGoogleSheets(estraiIdUniversale(txt)); chiudiScanner(); }, () => {}
    ).catch(() => chiudiScanner());
});
btnCloseQr.addEventListener('click', chiudiScanner);
function chiudiScanner() { qrModal.style.display = 'none'; if(html5QrCode&&html5QrCode.isScanning) html5QrCode.stop(); }
function calcolaDistanzaMetri(lat1, lon1, lat2, lon2) {
    const R = 6371000; const p1 = lat1 * Math.PI / 180; const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180; const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
