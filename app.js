"use strict";

/* =========================================================================
   MAB Lighthouse — logica applicativa
   ========================================================================= */

const STORAGE_KEYS = {
  sheetUrl: "mab_sheet_url",
  alerts: "mab_alerts",
};

const EXPERIENCE_TYPES = ["fly", "hear", "play", "read", "image"];

const ICONS = {
  fly: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l8-2 5-7 2 1-3 6.5 6-1 1.5 1.5-7 3-2 5-2-1 .5-4-7 1.5z"/></svg>`,
  hear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 16 0"/><path d="M4 12v4a2 2 0 0 0 2 2h1v-7H5a1 1 0 0 0-1 1z"/><path d="M20 12v4a2 2 0 0 1-2 2h-1v-7h1a1 1 0 0 1 2 1z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`,
  read: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5S6 4 9 4s5 1.5 5 1.5v14S12 18 9 18s-5 1.5-5 1.5z"/><path d="M14 5.5S16 4 19 4s1 1.5 1 1.5v14s-2-1.5-5-1.5-1 1.5-1 1.5"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.3"/></svg>`,
};

const LABELS = { fly: "FLY", hear: "HEAR", play: "PLAY", read: "READ", image: "IMAGE" };

/* -------------------------------------------------------------------------
   State
   ------------------------------------------------------------------------- */

const state = {
  experiences: [],   // parsed rows from the sheet
  position: null,    // {lat, lng, accuracy}
  activeIds: new Set(),
  alerts: loadAlertPrefs(),
  appsScriptUrl: null,
};

/* -------------------------------------------------------------------------
   DOM refs
   ------------------------------------------------------------------------- */

const el = {
  grid: document.getElementById("beacon-grid"),
  empty: document.getElementById("empty-state"),
  banner: document.getElementById("status-banner"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsClose: document.getElementById("settings-close"),
  sheetInput: document.getElementById("sheet-url-input"),
  sheetConnectBtn: document.getElementById("sheet-connect-btn"),
  sheetStatus: document.getElementById("sheet-status"),
  toggleSound: document.getElementById("toggle-sound"),
  toggleVibration: document.getElementById("toggle-vibration"),
  toggleToast: document.getElementById("toggle-toast"),
  toast: document.getElementById("toast"),
  experienceView: document.getElementById("experience-view"),
  experienceBody: document.getElementById("experience-body"),
  experienceClose: document.getElementById("experience-close"),
  appTitle: document.getElementById("app-title"),
  appLogo: document.getElementById("app-logo"),
  qrBtn: document.getElementById("sheet-qr-btn"),
  qrSection: document.getElementById("qr-section"),
  qrCancelBtn: document.getElementById("qr-cancel-btn"),
  qrVideo: document.getElementById("qr-video"),
  settingsDoneBtn: document.getElementById("settings-done-btn"),
};

/* =========================================================================
   Avvio
   ========================================================================= */

init();

function init() {
  el.toggleSound.checked = state.alerts.sound;
  el.toggleVibration.checked = state.alerts.vibration;
  el.toggleToast.checked = state.alerts.toast;

  bindUI();

  const savedUrl = localStorage.getItem(STORAGE_KEYS.sheetUrl);
  if (savedUrl) {
    el.sheetInput.value = savedUrl;
    loadSheet(savedUrl);
  } else {
    showBanner("Collega il foglio dell'attività dalle impostazioni per iniziare.", false);
  }

  startGeolocation();
}

function bindUI() {
  el.settingsBtn.addEventListener("click", () => openSettings());
  el.settingsClose.addEventListener("click", () => closeSettings());
  el.settingsPanel.addEventListener("click", (e) => {
    if (e.target === el.settingsPanel) closeSettings();
  });

  el.sheetConnectBtn.addEventListener("click", () => {
    const url = el.sheetInput.value.trim();
    if (!url) return;
    localStorage.setItem(STORAGE_KEYS.sheetUrl, url);
    loadSheet(url);
  });

  el.toggleSound.addEventListener("change", () => saveAlertPrefs());
  el.toggleVibration.addEventListener("change", () => saveAlertPrefs());
  el.toggleToast.addEventListener("change", () => saveAlertPrefs());

  el.experienceClose.addEventListener("click", () => closeExperience());

  el.qrBtn.addEventListener("click", () => startQrScan());
  el.qrCancelBtn.addEventListener("click", () => stopQrScan());
  el.settingsDoneBtn.addEventListener("click", () => closeSettings());
}

function openSettings() {
  el.settingsPanel.hidden = false;
}
function closeSettings() {
  stopQrScan();
  el.settingsPanel.hidden = true;
}

/* =========================================================================
   Lettura del foglio Google (endpoint pubblico gviz, nessun login richiesto)
   ========================================================================= */

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function loadSheet(rawUrl) {
  const id = extractSheetId(rawUrl);
  if (!id) {
    setSheetStatus("Indirizzo non valido: deve contenere /spreadsheets/d/…", true);
    return;
  }
  setSheetStatus("Connessione in corso…", false);
  showBanner("Carico le esperienze…", false);

  try {
    const expJson = await fetchGvizSheet(id, "Esperienze");
    const experiences = extractExperiences(expJson);

    let settings = {};
    try {
      const setJson = await fetchGvizSheet(id, "Impostazioni");
      settings = extractSettings(setJson);
    } catch (settingsErr) {
      console.warn("Foglio Impostazioni non trovato o non leggibile:", settingsErr);
    }

    state.experiences = experiences;
    state.appsScriptUrl = settings.appsScriptUrl || null;
    applyAppearance(settings.appName, settings.logoUrl);

    setSheetStatus(`Collegato — ${experiences.length} esperienza/e trovate.`, false, true);
    hideBanner();
    renderGrid();
    evaluatePosition();
    setTimeout(() => closeSettings(), 900);
  } catch (err) {
    console.error(err);
    setSheetStatus("Impossibile leggere il foglio. Verifica che sia condiviso come \"chiunque abbia il link\".", true);
    showBanner("Impossibile caricare le esperienze. Controlla la connessione o il foglio collegato.", true);
  }
}

async function fetchGvizSheet(id, sheetName) {
  const endpoint = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Foglio "${sheetName}" non raggiungibile.`);
  const text = await res.text();
  return parseGvizResponse(text);
}

// The gviz endpoint wraps its JSON in `google.visualization.Query.setResponse(...)`
function parseGvizResponse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const jsonStr = text.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

function cellText(cell) {
  if (!cell) return "";
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v).trim();
}

function extractExperiences(json) {
  const experiences = [];
  const rows = (json.table && json.table.rows) || [];
  for (const row of rows) {
    const cells = row.c || [];
    const name = cellText(cells[0]);
    const coordsRaw = cellText(cells[1]);
    const radiusRaw = cellText(cells[2]);
    const typeRaw = cellText(cells[3]).toLowerCase();
    const resource = cellText(cells[4]);

    if (!EXPERIENCE_TYPES.includes(typeRaw)) continue;

    const coords = parseCoords(coordsRaw);
    if (!coords) continue;

    const radius = parseFloat(radiusRaw.replace(",", "."));

    experiences.push({
      id: experiences.length,
      name: name || LABELS[typeRaw],
      type: typeRaw,
      lat: coords.lat,
      lng: coords.lng,
      radius: Number.isFinite(radius) && radius > 0 ? radius : 25,
      resource: resource || null,
    });
  }
  return experiences;
}

// Reads the "Impostazioni" tab: column A = Parametro, column B = Valore
function extractSettings(json) {
  const settings = { appName: null, logoUrl: null, appsScriptUrl: null };
  const rows = (json.table && json.table.rows) || [];
  for (const row of rows) {
    const cells = row.c || [];
    const param = cellText(cells[0]).toLowerCase();
    const value = cellText(cells[1]);
    if (!value) continue;
    if (param.includes("nome app")) settings.appName = value;
    else if (param.includes("logo")) settings.logoUrl = value;
    else if (param.includes("apps script")) settings.appsScriptUrl = value;
  }
  return settings;
}

function parseCoords(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return { lat: parts[0], lng: parts[1] };
}

function applyAppearance(appName, logoUrl) {
  if (appName) {
    document.title = appName;
    el.appTitle.textContent = appName;
  }
  if (logoUrl) {
    const fileId = extractDriveFileId(logoUrl);
    if (fileId) {
      el.appLogo.src = `https://drive.google.com/thumbnail?id=${fileId}&sz=w300`;
      el.appLogo.alt = appName || "Logo";
      el.appLogo.hidden = false;
    }
  }
}

/* =========================================================================
   Geolocalizzazione
   ========================================================================= */

function startGeolocation() {
  if (!("geolocation" in navigator)) {
    showBanner("Il browser non supporta la geolocalizzazione.", true);
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      state.position = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      evaluatePosition();
    },
    (err) => {
      console.warn(err);
      showBanner("Permesso di posizione non concesso: l'app non può attivare le esperienze.", true);
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

// Haversine distance in meters
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function evaluatePosition() {
  if (!state.position || state.experiences.length === 0) return;

  const newlyActivated = [];

  for (const exp of state.experiences) {
    const d = distanceMeters(state.position.lat, state.position.lng, exp.lat, exp.lng);
    const isActive = d <= exp.radius;
    const wasActive = state.activeIds.has(exp.id);

    if (isActive && !wasActive) {
      state.activeIds.add(exp.id);
      newlyActivated.push(exp);
    } else if (!isActive && wasActive) {
      state.activeIds.delete(exp.id);
    }
  }

  renderGrid();

  for (const exp of newlyActivated) {
    notifyActivation(exp);
  }
}

/* =========================================================================
   Rendering
   ========================================================================= */

function renderGrid() {
  if (state.experiences.length === 0) {
    el.grid.hidden = true;
    el.empty.hidden = false;
    return;
  }
  el.empty.hidden = true;
  el.grid.hidden = false;
  el.grid.innerHTML = "";

  for (const exp of state.experiences) {
    const active = state.activeIds.has(exp.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "beacon" + (active ? " active" : "");
    btn.dataset.type = exp.type;
    btn.disabled = !active;
    btn.setAttribute("aria-disabled", String(!active));

    let distLabel = "";
    if (!active && state.position) {
      const d = Math.round(distanceMeters(state.position.lat, state.position.lng, exp.lat, exp.lng));
      distLabel = d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`;
    }

    btn.innerHTML = `
      <span class="beacon-icon">${ICONS[exp.type]}</span>
      <span class="beacon-label">${LABELS[exp.type]}</span>
      ${exp.name && exp.name !== LABELS[exp.type] ? `<span class="beacon-name">${escapeHtml(exp.name)}</span>` : ""}
      ${distLabel ? `<span class="beacon-dist">${distLabel}</span>` : ""}
    `;

    if (active) {
      btn.addEventListener("click", () => openExperience(exp));
    }

    el.grid.appendChild(btn);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* =========================================================================
   Vista esperienza (segnaposto — i contenuti veri arrivano nel prossimo passo)
   ========================================================================= */

function openExperience(exp) {
  el.experienceBody.innerHTML = "";
  el.experienceBody.className = "experience-body";

  if (exp.type === "fly") {
    renderFly(exp);
  } else if (exp.type === "hear" || exp.type === "play") {
    renderAudio(exp);
  } else if (exp.type === "read") {
    renderRead(exp);
  } else if (exp.type === "image") {
    renderImage(exp);
  } else {
    el.experienceBody.innerHTML = `
      <h2>${LABELS[exp.type]}${exp.name && exp.name !== LABELS[exp.type] ? " — " + escapeHtml(exp.name) : ""}</h2>
      <p>Contenuto dell'esperienza in arrivo.</p>
    `;
  }

  el.experienceView.hidden = false;
}

/* =========================================================================
   Link Drive → URL riproducibile / embed
   ========================================================================= */

function extractDriveFileId(url) {
  if (!url) return null;
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

function extractGoogleDocId(url) {
  if (!url) return null;
  const m = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function driveDirectUrl(id) {
  return `https://drive.google.com/uc?export=download&id=${id}`;
}
function drivePreviewUrl(id) {
  return `https://drive.google.com/file/d/${id}/preview`;
}
function docsPreviewUrl(id) {
  return `https://docs.google.com/document/d/${id}/preview`;
}

/* =========================================================================
   HEAR / PLAY — player audio
   ========================================================================= */

function renderAudio(exp) {
  const fileId = extractDriveFileId(exp.resource);
  const title = exp.name && exp.name !== LABELS[exp.type] ? exp.name : LABELS[exp.type];

  if (!fileId) {
    el.experienceBody.innerHTML = `
      <h2>${LABELS[exp.type]}</h2>
      <p>Nessun file audio collegato a questa esperienza (controlla la colonna "Risorsa Drive" nel foglio).</p>
    `;
    return;
  }

  el.experienceBody.innerHTML = `
    <div class="audio-icon" data-type="${exp.type}">${ICONS[exp.type]}</div>
    <h2>${escapeHtml(title)}</h2>
    <audio id="audio-el" preload="metadata" src="${driveDirectUrl(fileId)}"></audio>
    <div class="audio-player" data-type="${exp.type}">
      <button id="audio-toggle" class="audio-toggle" aria-label="Riproduci">
        <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" hidden><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
      </button>
      <div class="audio-progress-wrap">
        <input id="audio-seek" class="audio-seek" type="range" min="0" max="100" value="0" step="0.1">
        <div class="audio-time">
          <span id="audio-current">0:00</span>
          <span id="audio-duration">--:--</span>
        </div>
      </div>
    </div>
    <p id="audio-fallback-msg" class="audio-fallback-msg" hidden>
      Riproduzione diretta non disponibile — apro il lettore di Google Drive qui sotto.
    </p>
    <div id="audio-iframe-wrap" class="audio-iframe-wrap" hidden>
      <iframe src="${drivePreviewUrl(fileId)}" allow="autoplay" loading="lazy"></iframe>
    </div>
  `;

  setupAudioPlayer(fileId);
}

function setupAudioPlayer(fileId) {
  const audio = document.getElementById("audio-el");
  const toggle = document.getElementById("audio-toggle");
  const iconPlay = toggle.querySelector(".icon-play");
  const iconPause = toggle.querySelector(".icon-pause");
  const seek = document.getElementById("audio-seek");
  const current = document.getElementById("audio-current");
  const duration = document.getElementById("audio-duration");
  const fallbackMsg = document.getElementById("audio-fallback-msg");
  const iframeWrap = document.getElementById("audio-iframe-wrap");

  const fmt = (s) => {
    if (!Number.isFinite(s)) return "--:--";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  toggle.addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  audio.addEventListener("play", () => { iconPlay.hidden = true; iconPause.hidden = false; toggle.setAttribute("aria-label", "Metti in pausa"); });
  audio.addEventListener("pause", () => { iconPlay.hidden = false; iconPause.hidden = true; toggle.setAttribute("aria-label", "Riproduci"); });
  audio.addEventListener("loadedmetadata", () => { duration.textContent = fmt(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    current.textContent = fmt(audio.currentTime);
    if (audio.duration) seek.value = String((audio.currentTime / audio.duration) * 100);
  });
  audio.addEventListener("ended", () => { iconPlay.hidden = false; iconPause.hidden = true; });

  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (parseFloat(seek.value) / 100) * audio.duration;
  });

  // Fallback: if the direct Drive stream fails (permessi, formato, limiti), passa al lettore embed di Drive
  audio.addEventListener("error", () => {
    document.querySelector(".audio-player").hidden = true;
    fallbackMsg.hidden = false;
    iframeWrap.hidden = false;
  }, { once: true });
}

function renderFly(exp) {
  el.experienceBody.className = "experience-body experience-body--full";

  const zoom = 19;
  const lat = state.position ? state.position.lat : exp.lat;
  const lng = state.position ? state.position.lng : exp.lng;
  const src = `https://www.google.com/maps?q=${lat},${lng}&z=${zoom}&t=k&output=embed`;

  el.experienceBody.innerHTML = `
    <div class="fly-frame">
      <iframe
        class="fly-map"
        src="${src}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allowfullscreen></iframe>
    </div>
    <p class="fly-caption">${escapeHtml(exp.name && exp.name !== LABELS.fly ? exp.name : "Vista dall'alto del punto in cui ti trovi")}</p>
  `;
}

/* =========================================================================
   READ — documento Google Docs o PDF su Drive
   ========================================================================= */

function renderRead(exp) {
  const docId = extractGoogleDocId(exp.resource);
  const fileId = !docId ? extractDriveFileId(exp.resource) : null;

  if (!docId && !fileId) {
    el.experienceBody.innerHTML = `
      <h2>${LABELS.read}</h2>
      <p>Nessun documento collegato a questa esperienza (controlla la colonna "Risorsa Drive" nel foglio: serve un link a un documento Google Docs o a un PDF su Drive).</p>
    `;
    return;
  }

  const src = docId ? docsPreviewUrl(docId) : drivePreviewUrl(fileId);
  const title = exp.name && exp.name !== LABELS.read ? exp.name : "Lettura";

  el.experienceBody.className = "experience-body experience-body--full";
  el.experienceBody.innerHTML = `
    <div class="read-frame">
      <iframe
        class="read-doc"
        src="${src}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
    <p class="fly-caption">${escapeHtml(title)}</p>
  `;
}

/* =========================================================================
   IMAGE — scatto foto e upload su Drive (tramite Apps Script)
   ========================================================================= */

function renderImage(exp) {
  const title = exp.name && exp.name !== LABELS.image ? exp.name : "Il tuo punto di vista";

  el.experienceBody.innerHTML = `
    <div class="audio-icon" data-type="image">${ICONS.image}</div>
    <h2>${escapeHtml(title)}</h2>
    <p class="image-hint">Scatta una foto del punto in cui ti trovi: entrerà a far parte della visione collettiva.</p>
    <div id="image-preview-wrap" class="image-preview-wrap" hidden>
      <img id="image-preview" class="image-preview" alt="Anteprima della foto scattata">
    </div>
    <input type="file" id="image-input" accept="image/*" capture="environment" hidden>
    <input type="text" id="image-name-input" class="image-name-input" placeholder="Il tuo nome (facoltativo)" maxlength="40" hidden>
    <div id="image-actions" class="image-actions"></div>
    <p id="image-status" class="image-status" aria-live="polite"></p>
  `;

  setupImageCapture(exp);
}

function setupImageCapture(exp) {
  const input = document.getElementById("image-input");
  const nameInput = document.getElementById("image-name-input");
  const previewWrap = document.getElementById("image-preview-wrap");
  const preview = document.getElementById("image-preview");
  const actions = document.getElementById("image-actions");
  const status = document.getElementById("image-status");

  let currentDataUrl = null;
  let currentMime = "image/jpeg";

  function showInitialAction() {
    actions.innerHTML = `<button id="image-take-btn" class="btn-primary image-action-btn" type="button">Scatta una foto</button>`;
    document.getElementById("image-take-btn").addEventListener("click", () => input.click());
  }

  function showPreviewActions() {
    actions.innerHTML = `
      <button id="image-retake-btn" class="btn-secondary" type="button">Rifai foto</button>
      <button id="image-upload-btn" class="btn-primary image-action-btn" type="button">Carica</button>
    `;
    document.getElementById("image-retake-btn").addEventListener("click", () => {
      currentDataUrl = null;
      previewWrap.hidden = true;
      nameInput.hidden = true;
      status.textContent = "";
      status.className = "image-status";
      showInitialAction();
    });
    document.getElementById("image-upload-btn").addEventListener("click", async () => {
      if (!currentDataUrl) return;
      status.textContent = "Caricamento in corso…";
      status.className = "image-status";
      try {
        await uploadPhoto(exp, currentDataUrl, currentMime, nameInput.value);
        status.textContent = "Foto caricata! Grazie per il tuo contributo.";
        status.className = "image-status ok";
        actions.innerHTML = `<button id="image-again-btn" class="btn-secondary" type="button">Scatta un'altra foto</button>`;
        document.getElementById("image-again-btn").addEventListener("click", () => {
          currentDataUrl = null;
          previewWrap.hidden = true;
          nameInput.hidden = true;
          nameInput.value = "";
          status.textContent = "";
          status.className = "image-status";
          showInitialAction();
        });
      } catch (err) {
        console.error(err);
        status.textContent = "Caricamento non riuscito: " + err.message;
        status.className = "image-status error";
      }
    });
  }

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = ""; // consente di riselezionare lo stesso identico file in seguito
    if (!file) return;
    currentMime = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = () => {
      currentDataUrl = reader.result;
      preview.src = currentDataUrl;
      previewWrap.hidden = false;
      nameInput.hidden = false;
      showPreviewActions();
    };
    reader.readAsDataURL(file);
  });

  showInitialAction();
}

async function uploadPhoto(exp, dataUrl, mimeType, personName) {
  if (!state.appsScriptUrl) {
    throw new Error('URL Apps Script non configurato (foglio "Impostazioni").');
  }
  if (!exp.resource) {
    throw new Error('Nessuna cartella Drive collegata a questa esperienza (colonna "Risorsa Drive").');
  }
  const base64 = dataUrl.split(",")[1];
  const payload = {
    folderUrl: exp.resource,
    imageBase64: base64,
    mimeType: mimeType,
    filename: buildPhotoFilename(personName),
  };

  const res = await fetch(state.appsScriptUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita il preflight CORS
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Il server non ha risposto correttamente.");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Errore sconosciuto durante il salvataggio.");
}

// Costruisce il nome del file: "Nome_2026-09-21_1830.jpg" oppure "foto_2026-09-21_1830.jpg" se il nome è vuoto
function buildPhotoFilename(personName) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cleanName = (personName || "")
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  return `${cleanName || "foto"}_${stamp}.jpg`;
}

function closeExperience() {
  el.experienceView.hidden = true;
  el.experienceBody.innerHTML = "";
  el.experienceBody.className = "experience-body";
}

/* =========================================================================
   Avvisi di attivazione (suono / vibrazione / toast)
   ========================================================================= */

function loadAlertPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.alerts);
    if (raw) return { sound: true, vibration: true, toast: true, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
  return { sound: true, vibration: true, toast: true };
}

function saveAlertPrefs() {
  state.alerts = {
    sound: el.toggleSound.checked,
    vibration: el.toggleVibration.checked,
    toast: el.toggleToast.checked,
  };
  localStorage.setItem(STORAGE_KEYS.alerts, JSON.stringify(state.alerts));
}

function notifyActivation(exp) {
  if (state.alerts.sound) playBeep();
  if (state.alerts.vibration && "vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  if (state.alerts.toast) showToast(`Hai raggiunto: ${LABELS[exp.type]}${exp.name && exp.name !== LABELS[exp.type] ? " — " + exp.name : ""}`);

  // Brief highlight animation on the corresponding beacon
  requestAnimationFrame(() => {
    const btn = [...el.grid.children].find((b) => b.dataset.type === exp.type && b.classList.contains("active"));
    if (btn) {
      btn.classList.add("just-activated");
      setTimeout(() => btn.classList.remove("just-activated"), 1200);
    }
  });
}

let audioCtx = null;
function playBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.55);
  } catch (e) { console.warn("Audio non disponibile", e); }
}

let toastTimer = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

/* =========================================================================
   Banner di stato
   ========================================================================= */

function showBanner(message, isError) {
  el.banner.textContent = message;
  el.banner.hidden = false;
  el.banner.classList.toggle("error", !!isError);
}
function hideBanner() {
  el.banner.hidden = true;
}
function setSheetStatus(message, isError, isOk) {
  el.sheetStatus.textContent = message;
  el.sheetStatus.classList.toggle("error", !!isError);
  el.sheetStatus.classList.toggle("ok", !!isOk);
}

/* =========================================================================
   QR code (lettura fotocamera) — attivabile dal pannello impostazioni
   ========================================================================= */

let qrStream = null;
let qrRafId = null;

async function startQrScan() {
  if (!("BarcodeDetector" in window)) {
    setSheetStatus("Lettura QR non supportata da questo browser: incolla l'indirizzo manualmente.", true);
    return;
  }
  el.qrSection.hidden = false;
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    el.qrVideo.srcObject = qrStream;
    await el.qrVideo.play();
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const scan = async () => {
      if (!qrStream) return;
      try {
        const codes = await detector.detect(el.qrVideo);
        if (codes.length > 0) {
          const value = codes[0].rawValue;
          el.sheetInput.value = value;
          stopQrScan();
          localStorage.setItem(STORAGE_KEYS.sheetUrl, value);
          loadSheet(value);
          return;
        }
      } catch (e) { /* keep scanning */ }
      qrRafId = requestAnimationFrame(scan);
    };
    qrRafId = requestAnimationFrame(scan);
  } catch (e) {
    console.warn(e);
    setSheetStatus("Impossibile accedere alla fotocamera per leggere il QR code.", true);
    el.qrSection.hidden = true;
  }
}

function stopQrScan() {
  if (qrRafId) cancelAnimationFrame(qrRafId);
  qrRafId = null;
  if (qrStream) {
    qrStream.getTracks().forEach((t) => t.stop());
    qrStream = null;
  }
  el.qrSection.hidden = true;
}
