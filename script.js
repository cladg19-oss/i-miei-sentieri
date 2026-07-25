const COLORS = ['#2f7d4f', '#d97706', '#2563eb', '#9333ea', '#dc2626', '#0891b2'];
const DB_NAME = 'sentieriDB';
const STORE_NAME = 'routes';

let db = null;
let map = null;
let routes = [];
let routeLayers = new Map();
let currentView = 'home';
let startEndMarkers = [];
let mapResizeObserver = null;

const $ = (id) => document.getElementById(id);

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
  $('searchRoutes').addEventListener('input', renderRouteList);
  $('closeInfoIcon').addEventListener('click', closeRouteInfo);
  $('closeInfoPanel').addEventListener('click', closeRouteInfo);
  $('saveRouteDetails').addEventListener('click', saveRouteDetails);
  $('infoColor').addEventListener('input', event => { $('infoColorValue').textContent = event.target.value.toUpperCase(); });
  $('routeInfoOverlay').addEventListener('click', event => {
    if (event.target === $('routeInfoOverlay')) closeRouteInfo();
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

function normalizeRoutes(items) {
  return items.map(route => ({
    ...route,
    visible: route.visible !== false,
    favorite: route.favorite === true,
    notes: route.notes || '',
    hikeDate: route.hikeDate || '',
    createdAt: route.createdAt || Date.now(),
    durationSeconds: Number(route.durationSeconds) || 0
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
    ele: node.querySelector('ele') ? Number(node.querySelector('ele').textContent) : null,
    time: node.querySelector('time')?.textContent?.trim() || null
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
  const validTimes = points.map(point => point.time ? Date.parse(point.time) : NaN).filter(Number.isFinite);
  const durationSeconds = validTimes.length >= 2 ? Math.max(0, Math.round((validTimes[validTimes.length - 1] - validTimes[0]) / 1000)) : 0;
  const nameNode = xml.querySelector('trk > name') || xml.querySelector('rte > name');
  return {
    name: nameNode?.textContent?.trim() || fileName.replace(/\.gpx$/i, ''),
    fileName,
    points,
    distanceKm,
    elevationGain: Math.round(elevationGain),
    durationSeconds,
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
  startEndMarkers.forEach(marker => map.removeLayer(marker));
  startEndMarkers = [];
  routes.forEach(route => {
    if (!Array.isArray(route.points) || route.points.length < 2) return;
    const layer = L.polyline(route.points.map(p => [p.lat, p.lon]), { color: route.color || COLORS[0], weight: 5, opacity: 0.9, lineJoin: 'round' });
    layer.bindTooltip(escapeHtml(route.name));
    layer.on('click', () => openRouteInfo(route));
    routeLayers.set(route.id, layer);
    if (route.visible !== false) layer.addTo(map);
  });
  refreshMapSize(false);
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
  const first = route.points?.[0];
  const last = route.points?.[route.points.length - 1];
  $('infoStart').textContent = formatCoordinate(first);
  $('infoEnd').textContent = formatCoordinate(last);
  $('infoDuration').textContent = formatDuration(route.durationSeconds);
  const speed = route.durationSeconds > 0 ? Number(route.distanceKm) / (route.durationSeconds / 3600) : 0;
  $('infoSpeed').textContent = speed > 0 ? `${speed.toFixed(1)} km/h` : 'Non disponibile';
  $('infoColor').value = route.color || COLORS[0];
  $('infoColorValue').textContent = (route.color || COLORS[0]).toUpperCase();
  $('infoDate').value = route.hikeDate || '';
  $('infoFavorite').checked = route.favorite === true;
  $('infoNotes').value = route.notes || '';
  $('routeInfoOverlay').hidden = false;
}

function closeRouteInfo() {
  $('routeInfoOverlay').hidden = true;
  window.currentRoute = null;
}

async function saveRouteDetails() {
  const route = window.currentRoute;
  if (!route) return;
  route.hikeDate = $('infoDate').value;
  route.favorite = $('infoFavorite').checked;
  route.notes = $('infoNotes').value.trim();
  route.color = $('infoColor').value;
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

function renderSettings() {
  $('settingsInfo').textContent = db ? 'Archivio locale attivo sul dispositivo.' : 'Archivio locale non disponibile.';
}

function showMessage(text) {
  const box = $('messageBox');
  box.textContent = text;
  box.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { box.hidden = true; }, 3500);
}

function formatCoordinate(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return '-';
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function formatDuration(seconds) {
  const total = Number(seconds) || 0;
  if (total <= 0) return 'Non disponibile';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
