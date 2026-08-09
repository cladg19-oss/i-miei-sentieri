const COLORS = ['#2f7d4f', '#d97706', '#2563eb', '#9333ea', '#dc2626', '#0891b2'];
const DB_NAME = 'sentieriDB';
const STORE_NAME = 'routes';
const SUPABASE_URL = 'https://afczunizjfdyhsmfmvvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kDxLRsC8d696HNCyQU6T-g_UP7wLJg4';
const cloud = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let db = null;
let map = null;
let routes = [];
let routeLayers = new Map();
let currentView = 'home';
let startEndMarkers = [];
let mapResizeObserver = null;
let elevationMapMarker = null;
let elevationChartState = null;
let heatmapEnabled = false;
let heatmapLayer = null;
let discoverMap = null;
let discoverCandidate = null;
let discoverLayers = [];

const $ = (id) => document.getElementById(id);
function setCloudStatus(message, error = false) {
  const el = $('cloudStatus');
  if (!el) return;

  el.textContent = message;
  el.dataset.state = error ? 'error' : 'ok';
}

function renderCloudSession(session) {
  const loginButton = $('cloudLoginButton');
  const logoutButton = $('cloudLogoutButton');
  const emailInput = $('cloudEmail');
  const passwordInput = $('cloudPassword');

  if (!loginButton || !logoutButton) return;

  if (session?.user) {
    setCloudStatus(`☁️ Cloud connesso: ${session.user.email}`);
    loginButton.hidden = true;
    logoutButton.hidden = false;

    if (emailInput) {
      emailInput.value = session.user.email || '';
      emailInput.disabled = true;
    }

    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.disabled = true;
    }
  } else {
    setCloudStatus('Cloud non connesso');
    loginButton.hidden = false;
    logoutButton.hidden = true;

    if (emailInput) emailInput.disabled = false;
    if (passwordInput) {
      passwordInput.disabled = false;
      passwordInput.value = '';
    }
  }
}

async function cloudLogin() {
  const email = $('cloudEmail')?.value.trim();
  const password = $('cloudPassword')?.value || '';

  if (!email || !password) {
    setCloudStatus('Inserisci email e password.', true);
    return;
  }

  setCloudStatus('Connessione al cloud...');

  const { data, error } = await cloud.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    setCloudStatus(`Errore di accesso: ${error.message}`, true);
    return;
  }

  renderCloudSession(data.session);
}

async function cloudLogout() {
  setCloudStatus('Disconnessione...');

  const { error } = await cloud.auth.signOut({ scope: 'local' });

  if (error) {
    setCloudStatus(`Errore: ${error.message}`, true);
    return;
  }

  renderCloudSession(null);
}

async function initCloudAuth() {
  const loginButton = $('cloudLoginButton');
  const logoutButton = $('cloudLogoutButton');

  if (!loginButton || !logoutButton) return;

  loginButton.addEventListener('click', cloudLogin);
  logoutButton.addEventListener('click', cloudLogout);

  cloud.auth.onAuthStateChange((_event, session) => {
    renderCloudSession(session);
  });

  const { data, error } = await cloud.auth.getSession();

  if (error) {
    setCloudStatus(`Errore Cloud: ${error.message}`, true);
    return;
  }

  renderCloudSession(data.session);
}

initCloudAuth();

function startApp() {
  bindInterface();
  initMap();
  window.addEventListener('load', () => refreshMapSize(true), { once: true });
  window.addEventListener('resize', () => refreshMapSize(false));
  openDatabase()
    .then(async database => {
      db = database;
      routes = normalizeRoutes(await dbGetAll());
      renderAll();
    })
    .catch(error => {
      console.error('Database non disponibile:', error);
      showMessage('Archivio locale non disponibile. L’app resta utilizzabile, ma i dati non verranno salvati.');
      renderAll();
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  startApp();
}

function bindInterface() {
  document.querySelectorAll('.menu-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view || 'home'));
  });

  $('importButton').addEventListener('click', () => $('gpxInput').click());
  $('gpxInput').addEventListener('change', event => importFiles(Array.from(event.target.files || [])));
  $('showAllButton').addEventListener('click', showAllRoutes);
  $('heatmapButton').addEventListener('click', toggleHeatmap);
  $('searchRoutes').addEventListener('input', renderRouteList);
  $('closeInfoIcon').addEventListener('click', closeRouteInfo);
  $('closeInfoPanel').addEventListener('click', closeRouteInfo);
  $('saveRouteDetails').addEventListener('click', saveRouteDetails);
  $('exportBackupButton').addEventListener('click', exportBackup);
  $('importBackupButton').addEventListener('click', () => $('backupInput').click());
  $('backupInput').addEventListener('change', importBackup);
  $('discoverFileButton').addEventListener('click', () => $('discoverFileInput').click());
  $('discoverFileInput').addEventListener('change', analyzeDiscoverFile);
  $('discoverTolerance').addEventListener('change', () => { if (discoverCandidate) runDiscoverComparison(discoverCandidate); });
  $('saveDiscoveredRoute').addEventListener('click', saveDiscoveredRoute);
  $('clearDiscoveredRoute').addEventListener('click', clearDiscoveredRoute);
  $('routeInfoOverlay').addEventListener('click', event => {
    if (event.target === $('routeInfoOverlay')) closeRouteInfo();
  });
  const elevationCanvas = $('elevationChart');
  elevationCanvas.addEventListener('mousemove', handleElevationPointer);
  elevationCanvas.addEventListener('mouseleave', clearElevationPointer);
  elevationCanvas.addEventListener('click', handleElevationPointer);
  elevationCanvas.addEventListener('touchstart', handleElevationPointer, { passive: false });
  elevationCanvas.addEventListener('touchmove', handleElevationPointer, { passive: false });
  window.addEventListener('resize', () => {
    if (window.currentRoute && !$('elevationSection').hidden) drawElevationProfile(window.currentRoute);
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.menu-item').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  const titles = {
    home: ['Dashboard personale', 'Benvenuto nei tuoi sentieri'],
    map: ['Esplorazione', 'Mappa dei tuoi percorsi'],
    archive: ['Archivio personale', 'Tutti i percorsi GPX'],
    stats: ['Riepilogo', 'Statistiche dei tuoi sentieri'],
    favorites: ['Raccolta', 'Percorsi preferiti'],
    discover: ['Pianificazione', 'Scopri nuovi sentieri'],
    settings: ['Configurazione', 'Impostazioni']
  };
  const [small, title] = titles[view] || titles.home;
  $('pageSmallTitle').textContent = small;
  $('pageTitle').textContent = title;

  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });

  moveMapToView(view);
  renderAll();
  refreshMapSize(view === 'map');
  if (view === 'discover') initDiscoverMap();
}

function initMap() {
  if (!window.L) {
    showMessage('La mappa non è stata caricata. Controlla la connessione Internet.');
    return;
  }
  map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([45.714, 9.465], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  const mapElement = $('map');
  if ('ResizeObserver' in window) {
    mapResizeObserver = new ResizeObserver(() => refreshMapSize(false));
    mapResizeObserver.observe(mapElement);
  }
  setTimeout(() => refreshMapSize(false), 0);
  setTimeout(() => refreshMapSize(false), 150);
  setTimeout(() => refreshMapSize(false), 500);
}

function moveMapToView(view) {
  const card = $('mapCard');
  const target = view === 'map' ? $('fullMapHost') : $('homeMapHost');
  if (card && target && card.parentElement !== target) target.appendChild(card);
}

function refreshMapSize(shouldFit = false) {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize({ pan: false, debounceMoveend: true });
    if (shouldFit) fitVisibleRoutes();
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB non supportato'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = event => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Errore apertura database'));
    request.onblocked = () => reject(new Error('Database bloccato da un’altra scheda'));
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Errore database'));
  });
}

function dbGetAll() {
  if (!db) return Promise.resolve([]);
  return requestPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
}
function dbAdd(route) {
  if (!db) return Promise.resolve(Date.now() + Math.random());
  return requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(route));
}
function dbPut(route) {
  if (!db) return Promise.resolve(route.id);
  return requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(route));
}
function dbDelete(id) {
  if (!db) return Promise.resolve();
  return requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id));
}

function dbClear() {
  if (!db) return Promise.resolve();
  return requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear());
}

function normalizeRoutes(items) {
  return items.map(route => ({
    ...route,
    visible: route.visible !== false,
    favorite: route.favorite === true,
    notes: route.notes || '',
    hikeDate: route.hikeDate || '',
    createdAt: route.createdAt || Date.now()
  })).sort((a, b) => b.createdAt - a.createdAt);
}

async function importFiles(files) {
  if (!files.length) return;
  let imported = 0;
  for (const file of files) {
    try {
      const parsed = parseGPX(await file.text(), file.name);
      const route = {
        ...parsed,
        color: COLORS[routes.length % COLORS.length],
        visible: true,
        favorite: false,
        notes: '',
        hikeDate: '',
        createdAt: Date.now() + imported
      };
      route.id = await dbAdd(route);
      routes.unshift(route);
      imported += 1;
    } catch (error) {
      console.error(`Errore nel file ${file.name}:`, error);
    }
  }
  $('gpxInput').value = '';
  renderAll();
  fitVisibleRoutes();
  showMessage(imported ? `${imported} percorso/i importato/i.` : 'Nessun file GPX valido.');
}

function parseGPX(text, fileName) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('XML non valido');
  let nodes = Array.from(xml.querySelectorAll('trkpt'));
  if (!nodes.length) nodes = Array.from(xml.querySelectorAll('rtept'));
  const points = nodes.map(node => ({
    lat: Number(node.getAttribute('lat')),
    lon: Number(node.getAttribute('lon')),
    ele: node.querySelector('ele') ? Number(node.querySelector('ele').textContent) : null
  })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (points.length < 2) throw new Error('Percorso non valido');

  let distanceKm = 0;
  let elevationGain = 0;
  for (let i = 1; i < points.length; i += 1) {
    distanceKm += haversine(points[i - 1], points[i]);
    if (Number.isFinite(points[i - 1].ele) && Number.isFinite(points[i].ele) && points[i].ele > points[i - 1].ele) {
      elevationGain += points[i].ele - points[i - 1].ele;
    }
  }
  const nameNode = xml.querySelector('trk > name') || xml.querySelector('rte > name');
  return {
    name: nameNode?.textContent?.trim() || fileName.replace(/\.gpx$/i, ''),
    fileName,
    points,
    distanceKm,
    elevationGain: Math.round(elevationGain),
    zone: `${points[0].lat.toFixed(2)}, ${points[0].lon.toFixed(2)}`
  };
}

function haversine(a, b) {
  const radius = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function renderAll() {
  renderStats();
  renderMapRoutes();
  renderRouteList();
  renderSettings();
}

function renderStats() {
  const totalKm = routes.reduce((sum, route) => sum + (Number(route.distanceKm) || 0), 0);
  const totalElevation = routes.reduce((sum, route) => sum + (Number(route.elevationGain) || 0), 0);
  const zones = new Set(routes.map(route => route.zone).filter(Boolean));
  $('routeCount').textContent = routes.length;
  $('totalDistance').textContent = `${totalKm.toFixed(1)} km`;
  $('totalElevation').textContent = `${Math.round(totalElevation)} m`;
  $('zoneCount').textContent = zones.size;
  $('statsDetails').innerHTML = `<div class="big-stat"><strong>${routes.length}</strong><span>Percorsi</span></div><div class="big-stat"><strong>${totalKm.toFixed(1)} km</strong><span>Distanza</span></div><div class="big-stat"><strong>${Math.round(totalElevation)} m</strong><span>Dislivello</span></div><div class="big-stat"><strong>${routes.filter(r => r.favorite).length}</strong><span>Preferiti</span></div>`;
}

function renderMapRoutes() {
  if (!map) return;
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers.clear();
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }
  startEndMarkers.forEach(marker => map.removeLayer(marker));
  startEndMarkers = [];

  routes.forEach(route => {
    if (!Array.isArray(route.points) || route.points.length < 2) return;
    const layer = L.polyline(route.points.map(p => [p.lat, p.lon]), { color: route.color || COLORS[0], weight: 5, opacity: 0.9, lineJoin: 'round' });
    layer.bindTooltip(escapeHtml(route.name));
    layer.on('click', () => openRouteInfo(route));
    routeLayers.set(route.id, layer);
    if (!heatmapEnabled && route.visible !== false) layer.addTo(map);
  });

  if (heatmapEnabled) renderHeatmap();
  refreshMapSize(false);
}

function toggleHeatmap() {
  heatmapEnabled = !heatmapEnabled;
  const button = $('heatmapButton');
  button.classList.toggle('active', heatmapEnabled);
  button.setAttribute('aria-pressed', String(heatmapEnabled));
  button.textContent = heatmapEnabled ? '🔥 Heatmap attiva' : '🔥 Heatmap';
  $('heatmapLegend').hidden = !heatmapEnabled;
  renderMapRoutes();
  fitVisibleRoutes();
  showMessage(heatmapEnabled ? 'Heatmap attivata.' : 'Heatmap disattivata.');
}

function heatCellKey(point, cellMeters = 35) {
  const latStep = cellMeters / 111320;
  const lonScale = Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
  const lonStep = cellMeters / (111320 * lonScale);
  return `${Math.round(point.lat / latStep)}:${Math.round(point.lon / lonStep)}`;
}

function heatColor(count) {
  if (count >= 4) return '#dc2626';
  if (count === 3) return '#f97316';
  if (count === 2) return '#eab308';
  return '#16a34a';
}

function renderHeatmap() {
  if (!map) return;
  const visibleRoutes = routes.filter(route => route.visible !== false && Array.isArray(route.points) && route.points.length >= 2);
  const frequency = new Map();

  visibleRoutes.forEach(route => {
    const visitedByRoute = new Set();
    for (let index = 1; index < route.points.length; index += 1) {
      const a = route.points[index - 1];
      const b = route.points[index];
      const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      visitedByRoute.add(heatCellKey(midpoint));
    }
    visitedByRoute.forEach(key => frequency.set(key, (frequency.get(key) || 0) + 1));
  });

  const segments = [];
  visibleRoutes.forEach(route => {
    for (let index = 1; index < route.points.length; index += 1) {
      const a = route.points[index - 1];
      const b = route.points[index];
      const midpoint = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      const count = frequency.get(heatCellKey(midpoint)) || 1;
      segments.push(L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
        color: heatColor(count),
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }));
    }
  });

  heatmapLayer = L.layerGroup(segments).addTo(map);
}

function displayedRoutes() {
  const query = $('searchRoutes').value.trim().toLowerCase();
  let list = routes;
  if (currentView === 'favorites') list = list.filter(route => route.favorite);
  if (query) list = list.filter(route => route.name.toLowerCase().includes(query));
  return list;
}

function renderRouteList() {
  const containers = [$('recentRoutes'), $('archiveRoutes'), $('favoriteRoutes')];
  containers.forEach(container => { if (container) container.innerHTML = ''; });
  const list = displayedRoutes();
  const target = currentView === 'archive' ? $('archiveRoutes') : currentView === 'favorites' ? $('favoriteRoutes') : $('recentRoutes');
  if (!target) return;
  if (!list.length) {
    target.innerHTML = '<p class="empty-state">Nessun percorso da mostrare.</p>';
    return;
  }
  list.forEach(route => target.appendChild(createRouteCard(route)));
}

function createRouteCard(route) {
  const item = document.createElement('article');
  item.className = 'route-item';
  item.innerHTML = `<button class="route-main" type="button"><span class="route-color" style="background:${route.color || COLORS[0]}"></span><span class="route-info"><span class="route-name">${escapeHtml(route.name)} ${route.favorite ? '⭐' : ''}</span><span class="route-details">${Number(route.distanceKm).toFixed(2)} km · ${Math.round(route.elevationGain || 0)} m</span></span></button><div class="route-actions"><button class="route-toggle" type="button" title="Mostra o nascondi">${route.visible !== false ? '👁️' : '🙈'}</button><button class="route-delete" type="button" title="Elimina">🗑️</button></div>`;
  item.querySelector('.route-main').addEventListener('click', () => {
    openRouteInfo(route);
    const layer = routeLayers.get(route.id);
    if (layer && map) {
      switchView('map');
      showRouteOnMap(route, layer);
    }
  });
  item.querySelector('.route-toggle').addEventListener('click', async () => {
    route.visible = !route.visible;
    await dbPut(route);
    renderAll();
  });
  item.querySelector('.route-delete').addEventListener('click', async () => {
    if (!confirm(`Eliminare “${route.name}”?`)) return;
    await dbDelete(route.id);
    routes = routes.filter(itemRoute => itemRoute.id !== route.id);
    renderAll();
    showMessage('Percorso eliminato.');
  });
  return item;
}

function openRouteInfo(route) {
  window.currentRoute = route;
  $('infoTitle').textContent = route.name;
  $('infoDistance').textContent = `${Number(route.distanceKm).toFixed(2)} km`;
  $('infoElevation').textContent = `${Math.round(route.elevationGain || 0)} m`;
  $('infoZone').textContent = route.zone || '-';
  $('infoFileName').textContent = route.fileName || '-';
  $('infoDate').value = route.hikeDate || '';
  $('infoFavorite').checked = route.favorite === true;
  $('infoNotes').value = route.notes || '';
  $('routeInfoOverlay').hidden = false;
  requestAnimationFrame(() => drawElevationProfile(route));
}

function closeRouteInfo() {
  $('routeInfoOverlay').hidden = true;
  clearElevationPointer();
  window.currentRoute = null;
}

async function saveRouteDetails() {
  const route = window.currentRoute;
  if (!route) return;
  route.hikeDate = $('infoDate').value;
  route.favorite = $('infoFavorite').checked;
  route.notes = $('infoNotes').value.trim();
  await dbPut(route);
  closeRouteInfo();
  renderAll();
  showMessage('Dettagli salvati.');
}

async function showAllRoutes() {
  for (const route of routes) {
    route.visible = true;
    await dbPut(route);
  }
  renderAll();
  fitVisibleRoutes();
}

function showRouteOnMap(route, layer) {
  if (heatmapEnabled) toggleHeatmap();
  if (!map || !layer || !Array.isArray(route.points) || route.points.length < 2) return;
  startEndMarkers.forEach(marker => map.removeLayer(marker));
  startEndMarkers = [];
  const first = route.points[0];
  const last = route.points[route.points.length - 1];
  const startMarker = L.marker([first.lat, first.lon], { title: 'Partenza' }).bindPopup('<strong>Partenza</strong>');
  const endMarker = L.marker([last.lat, last.lon], { title: 'Arrivo' }).bindPopup('<strong>Arrivo</strong>');
  startMarker.addTo(map);
  endMarker.addTo(map);
  startEndMarkers = [startMarker, endMarker];
  refreshMapSize(false);
  setTimeout(() => map.fitBounds(layer.getBounds(), { padding: [45, 45], maxZoom: 17 }), 80);
}

function fitVisibleRoutes() {
  if (!map) return;
  const visible = routes.filter(route => route.visible !== false).map(route => routeLayers.get(route.id)).filter(Boolean);
  refreshMapSize(false);
  if (visible.length) setTimeout(() => map.fitBounds(L.featureGroup(visible).getBounds(), { padding: [40, 40], maxZoom: 16 }), 60);
}


function buildElevationData(route) {
  if (!route || !Array.isArray(route.points)) return [];
  const data = [];
  let cumulativeKm = 0;
  for (let index = 0; index < route.points.length; index += 1) {
    const point = route.points[index];
    if (index > 0) cumulativeKm += haversine(route.points[index - 1], point);
    if (Number.isFinite(point.ele)) {
      data.push({ index, distanceKm: cumulativeKm, elevation: point.ele, point });
    }
  }
  return data;
}

function drawElevationProfile(route) {
  const section = $('elevationSection');
  const canvas = $('elevationChart');
  const empty = $('elevationEmpty');
  const help = section.querySelector('.elevation-help');
  const data = buildElevationData(route);
  section.hidden = false;
  clearElevationPointer();

  if (data.length < 2) {
    canvas.hidden = true;
    empty.hidden = false;
    help.hidden = true;
    $('elevationMin').textContent = '-';
    $('elevationMax').textContent = '-';
    elevationChartState = null;
    return;
  }

  canvas.hidden = false;
  empty.hidden = true;
  help.hidden = false;
  const minElevation = Math.min(...data.map(item => item.elevation));
  const maxElevation = Math.max(...data.map(item => item.elevation));
  const totalKm = Math.max(data[data.length - 1].distanceKm, 0.001);
  $('elevationMin').textContent = `${Math.round(minElevation)} m`;
  $('elevationMax').textContent = `${Math.round(maxElevation)} m`;

  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(300, Math.round(rect.width || canvas.parentElement.clientWidth || 500));
  const cssHeight = 230;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { left: 48, right: 16, top: 18, bottom: 34 };
  const plotWidth = cssWidth - padding.left - padding.right;
  const plotHeight = cssHeight - padding.top - padding.bottom;
  const elevationRange = Math.max(maxElevation - minElevation, 20);
  const yMin = minElevation - elevationRange * 0.08;
  const yMax = maxElevation + elevationRange * 0.08;
  const xFor = item => padding.left + (item.distanceKm / totalKm) * plotWidth;
  const yFor = item => padding.top + (1 - (item.elevation - yMin) / (yMax - yMin)) * plotHeight;

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#dbe5df';
  ctx.fillStyle = '#718078';
  ctx.font = '12px Arial';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = padding.top + (plotHeight * tick) / 4;
    const value = yMax - ((yMax - yMin) * tick) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(cssWidth - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} m`, padding.left - 7, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let tick = 0; tick <= 4; tick += 1) {
    const x = padding.left + (plotWidth * tick) / 4;
    const km = (totalKm * tick) / 4;
    ctx.fillText(`${km.toFixed(totalKm < 10 ? 1 : 0)} km`, x, cssHeight - padding.bottom + 10);
  }

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
  gradient.addColorStop(0, 'rgba(47, 125, 79, 0.38)');
  gradient.addColorStop(1, 'rgba(47, 125, 79, 0.04)');
  ctx.beginPath();
  data.forEach((item, index) => {
    const x = xFor(item);
    const y = yFor(item);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(data[data.length - 1]), padding.top + plotHeight);
  ctx.lineTo(xFor(data[0]), padding.top + plotHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  data.forEach((item, index) => {
    const x = xFor(item);
    const y = yFor(item);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = route.color || COLORS[0];
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  elevationChartState = { canvas, ctx, data, cssWidth, cssHeight, padding, plotWidth, plotHeight, totalKm, yMin, yMax, xFor, yFor, route };
}

function handleElevationPointer(event) {
  if (!elevationChartState) return;
  if (event.cancelable) event.preventDefault();
  const { canvas, data, padding, plotWidth, totalKm, xFor, yFor, route } = elevationChartState;
  const rect = canvas.getBoundingClientRect();
  const pointer = event.touches?.[0] || event.changedTouches?.[0] || event;
  const localX = Math.max(padding.left, Math.min(rect.width - padding.right, pointer.clientX - rect.left));
  const targetKm = ((localX - padding.left) / plotWidth) * totalKm;
  let nearest = data[0];
  let best = Math.abs(nearest.distanceKm - targetKm);
  for (const item of data) {
    const difference = Math.abs(item.distanceKm - targetKm);
    if (difference < best) {
      best = difference;
      nearest = item;
    }
  }
  drawElevationCursor(nearest);
  showElevationPointOnMap(route, nearest.point);
}

function drawElevationCursor(item) {
  const state = elevationChartState;
  if (!state) return;
  drawElevationProfile(state.route);
  const refreshed = elevationChartState;
  const { ctx, cssHeight, padding, xFor, yFor, canvas } = refreshed;
  const x = xFor(item);
  const y = yFor(item);
  ctx.beginPath();
  ctx.moveTo(x, padding.top);
  ctx.lineTo(x, cssHeight - padding.bottom);
  ctx.strokeStyle = '#1f2a24';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = refreshed.route.color || COLORS[0];
  ctx.lineWidth = 3;
  ctx.stroke();

  const tooltip = $('elevationTooltip');
  tooltip.innerHTML = `<strong>${Math.round(item.elevation)} m</strong><span>${item.distanceKm.toFixed(2)} km</span>`;
  tooltip.hidden = false;
  const tooltipWidth = 105;
  tooltip.style.left = `${Math.max(6, Math.min(canvas.clientWidth - tooltipWidth - 6, x - tooltipWidth / 2))}px`;
  tooltip.style.top = `${Math.max(4, y - 58)}px`;
}

function showElevationPointOnMap(route, point) {
  if (!map || !point) return;
  if (elevationMapMarker) map.removeLayer(elevationMapMarker);
  elevationMapMarker = L.circleMarker([point.lat, point.lon], {
    radius: 7,
    color: '#ffffff',
    weight: 3,
    fillColor: route.color || COLORS[0],
    fillOpacity: 1
  }).addTo(map);
}

function clearElevationPointer() {
  const tooltip = $('elevationTooltip');
  if (tooltip) tooltip.hidden = true;
  if (elevationMapMarker && map) map.removeLayer(elevationMapMarker);
  elevationMapMarker = null;
}


function initDiscoverMap() {
  if (discoverMap || !window.L) {
    if (discoverMap) setTimeout(() => discoverMap.invalidateSize(), 30);
    return;
  }
  discoverMap = L.map('discoverMap', { zoomControl: true, preferCanvas: true }).setView([45.714, 9.465], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(discoverMap);
  setTimeout(() => discoverMap.invalidateSize(), 50);
}

async function analyzeDiscoverFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    discoverCandidate = parseGPX(await file.text(), file.name);
    runDiscoverComparison(discoverCandidate);
    showMessage('Confronto completato.');
  } catch (error) {
    console.error('Errore analisi nuovo percorso:', error);
    clearDiscoveredRoute();
    showMessage('Il file GPX non è valido.');
  }
}

function buildReferenceIndex(cellMeters = 80) {
  const index = new Map();
  const latCell = cellMeters / 111320;
  const add = (key, segment) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(segment);
  };
  routes.forEach(route => {
    const points = Array.isArray(route.points) ? route.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const midLat = (a.lat + b.lat) / 2;
      const lonCell = cellMeters / (111320 * Math.max(0.2, Math.cos(midLat * Math.PI / 180)));
      const minX = Math.floor(Math.min(a.lon, b.lon) / lonCell) - 1;
      const maxX = Math.floor(Math.max(a.lon, b.lon) / lonCell) + 1;
      const minY = Math.floor(Math.min(a.lat, b.lat) / latCell) - 1;
      const maxY = Math.floor(Math.max(a.lat, b.lat) / latCell) + 1;
      const segment = { a, b, routeName: route.name };
      for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) add(`${x}:${y}`, segment);
    }
  });
  return { index, latCell, cellMeters };
}

function pointToSegmentMeters(point, a, b) {
  const lat0 = point.lat * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0);
  const my = 111320;
  const px = point.lon * mx, py = point.lat * my;
  const ax = a.lon * mx, ay = a.lat * my;
  const bx = b.lon * mx, by = b.lat * my;
  const dx = bx - ax, dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function runDiscoverComparison(candidate) {
  initDiscoverMap();
  const tolerance = Number($('discoverTolerance').value) || 30;
  const reference = buildReferenceIndex(Math.max(80, tolerance * 3));
  const classified = [];
  let newKm = 0;
  let knownKm = 0;
  for (let i = 1; i < candidate.points.length; i += 1) {
    const a = candidate.points[i - 1];
    const b = candidate.points[i];
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    const lonCell = reference.cellMeters / (111320 * Math.max(0.2, Math.cos(mid.lat * Math.PI / 180)));
    const cx = Math.floor(mid.lon / lonCell);
    const cy = Math.floor(mid.lat / reference.latCell);
    const candidates = [];
    for (let x = cx - 1; x <= cx + 1; x += 1) for (let y = cy - 1; y <= cy + 1; y += 1) candidates.push(...(reference.index.get(`${x}:${y}`) || []));
    const known = candidates.some(segment => pointToSegmentMeters(mid, segment.a, segment.b) <= tolerance);
    const km = haversine(a, b);
    if (known) knownKm += km; else newKm += km;
    classified.push({ a, b, known, km });
  }
  candidate.discovery = { tolerance, newKm, knownKm, classified };
  renderDiscoverResult(candidate);
}

function renderDiscoverResult(candidate) {
  const result = candidate.discovery;
  const total = result.newKm + result.knownKm;
  const newPct = total ? result.newKm / total * 100 : 0;
  const knownPct = 100 - newPct;
  $('discoverEmpty').hidden = true;
  $('discoverResult').hidden = false;
  $('discoverName').textContent = candidate.name;
  $('discoverTotal').textContent = `${total.toFixed(2)} km`;
  $('discoverNew').textContent = `${result.newKm.toFixed(2)} km · ${newPct.toFixed(0)}%`;
  $('discoverKnown').textContent = `${result.knownKm.toFixed(2)} km · ${knownPct.toFixed(0)}%`;
  $('discoverProgressNew').style.width = `${newPct}%`;
  $('discoverSummary').textContent = newPct >= 70 ? 'Ottima scelta: gran parte del percorso è nuova.' : newPct >= 35 ? 'Percorso misto: contiene diversi tratti nuovi.' : 'Questo itinerario passa soprattutto su sentieri già presenti nel tuo archivio.';
  renderDiscoverMap(candidate);
}

function renderDiscoverMap(candidate) {
  initDiscoverMap();
  if (!discoverMap) return;
  discoverLayers.forEach(layer => discoverMap.removeLayer(layer));
  discoverLayers = [];
  const groups = [];
  let current = null;
  candidate.discovery.classified.forEach(segment => {
    if (!current || current.known !== segment.known) {
      current = { known: segment.known, points: [[segment.a.lat, segment.a.lon], [segment.b.lat, segment.b.lon]] };
      groups.push(current);
    } else current.points.push([segment.b.lat, segment.b.lon]);
  });
  groups.forEach(group => {
    const layer = L.polyline(group.points, { color: group.known ? '#6b7280' : '#16a34a', weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(discoverMap);
    discoverLayers.push(layer);
  });
  if (discoverLayers.length) setTimeout(() => discoverMap.fitBounds(L.featureGroup(discoverLayers).getBounds(), { padding: [35, 35], maxZoom: 17 }), 50);
}

async function saveDiscoveredRoute() {
  if (!discoverCandidate) return;
  const route = {
    ...discoverCandidate,
    color: COLORS[routes.length % COLORS.length],
    visible: true, favorite: false, notes: '', hikeDate: '', createdAt: Date.now()
  };
  delete route.discovery;
  route.id = await dbAdd(route);
  routes.unshift(route);
  renderAll();
  showMessage('Percorso salvato nell’archivio.');
  clearDiscoveredRoute();
}

function clearDiscoveredRoute() {
  discoverCandidate = null;
  $('discoverEmpty').hidden = false;
  $('discoverResult').hidden = true;
  discoverLayers.forEach(layer => { if (discoverMap) discoverMap.removeLayer(layer); });
  discoverLayers = [];
}

function renderSettings() {
  $('settingsInfo').textContent = db
    ? `Archivio locale attivo: ${routes.length} percorso/i salvato/i su questo dispositivo.`
    : 'Archivio locale non disponibile: il backup può essere esportato, ma il ripristino non può essere salvato in modo permanente.';
}

function backupFileName() {
  const date = new Date();
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  return `i-miei-sentieri-backup-${stamp}.json`;
}

function setBackupStatus(text, isError = false) {
  const status = $('backupStatus');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function exportBackup() {
  try {
    const payload = {
      app: 'I Miei Sentieri',
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      routeCount: routes.length,
      routes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupStatus(`Backup creato: ${routes.length} percorso/i esportato/i.`);
    showMessage('Backup esportato correttamente.');
  } catch (error) {
    console.error('Errore esportazione backup:', error);
    setBackupStatus('Non è stato possibile creare il backup.', true);
    showMessage('Errore durante l’esportazione del backup.');
  }
}

async function importBackup(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== 'I Miei Sentieri' || payload?.backupVersion !== 1 || !Array.isArray(payload.routes)) {
      throw new Error('Formato backup non riconosciuto');
    }
    const restored = normalizeRoutes(payload.routes).filter(route => Array.isArray(route.points) && route.points.length >= 2);
    if (!confirm(`Ripristinare ${restored.length} percorso/i? L’archivio attuale verrà sostituito.`)) return;
    await dbClear();
    for (const route of restored) await dbPut(route);
    routes = restored;
    renderAll();
    fitVisibleRoutes();
    setBackupStatus(`Ripristino completato: ${restored.length} percorso/i caricati.`);
    showMessage('Backup ripristinato correttamente.');
  } catch (error) {
    console.error('Errore ripristino backup:', error);
    setBackupStatus('File non valido o danneggiato. Nessun dato è stato modificato.', true);
    showMessage('Impossibile ripristinare questo backup.');
  }
}

function showMessage(text) {
  const box = $('messageBox');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { box.hidden = true; }, 3500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
