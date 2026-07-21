import { openDB, getAll, add, save, remove } from './js/database.js';
import { parseGPX } from './js/gpx.js';
import { compareRoute } from './js/comparison.js';

const COLORS = ['#2f7d4f', '#d97706', '#2563eb', '#9333ea', '#dc2626', '#0891b2'];
const COMPARISON_TOLERANCE_METERS = 30;
const NEW_COLOR = '#16a34a';
const KNOWN_COLOR = '#6b7280';

let db;
let map;
let routes = [];
let layers = new Map();
let currentRoute = null;

const elements = {};

document.addEventListener('DOMContentLoaded', async () => {
  Object.assign(elements, {
    gpxInput: document.getElementById('gpxInput'),
    importButton: document.getElementById('importButton'),
    showAllButton: document.getElementById('showAllButton'),
    searchRoutes: document.getElementById('searchRoutes'),
    routeInfoOverlay: document.getElementById('routeInfoOverlay'),
    closeInfoIcon: document.getElementById('closeInfoIcon'),
    closeInfoPanel: document.getElementById('closeInfoPanel'),
    saveRouteDetails: document.getElementById('saveRouteDetails'),
    analyzeRoute: document.getElementById('analyzeRoute'),
    recentRoutes: document.getElementById('recentRoutes'),
    routeCount: document.getElementById('routeCount'),
    totalDistance: document.getElementById('totalDistance'),
    totalElevation: document.getElementById('totalElevation'),
    zoneCount: document.getElementById('zoneCount'),
    infoTitle: document.getElementById('infoTitle'),
    infoDistance: document.getElementById('infoDistance'),
    infoElevation: document.getElementById('infoElevation'),
    infoZone: document.getElementById('infoZone'),
    infoFileName: document.getElementById('infoFileName'),
    infoDate: document.getElementById('infoDate'),
    infoFavorite: document.getElementById('infoFavorite'),
    infoNotes: document.getElementById('infoNotes'),
    analysisResult: document.getElementById('analysisResult'),
    analysisTotal: document.getElementById('analysisTotal'),
    analysisNew: document.getElementById('analysisNew'),
    analysisKnown: document.getElementById('analysisKnown'),
    analysisReferences: document.getElementById('analysisReferences'),
    messageBox: document.getElementById('messageBox')
  });

  document.querySelectorAll('.menu-item').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
    };
  });

  map = L.map('map').setView([45.714, 9.465], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  db = await openDB();
  routes = (await getAll(db))
    .map(route => ({
      ...route,
      visible: route.visible !== false,
      favorite: route.favorite === true,
      notes: route.notes || '',
      hikeDate: route.hikeDate || '',
      comparison: route.comparison || null
    }))
    .sort((first, second) => second.createdAt - first.createdAt);

  elements.importButton.onclick = () => elements.gpxInput.click();
  elements.gpxInput.onchange = event => importFiles([...event.target.files]);
  elements.showAllButton.onclick = showAllRoutes;
  elements.searchRoutes.oninput = () => filterRoutes(elements.searchRoutes.value);
  elements.closeInfoIcon.onclick = closeRouteInfo;
  elements.closeInfoPanel.onclick = closeRouteInfo;
  elements.saveRouteDetails.onclick = saveRouteDetails;
  elements.analyzeRoute.onclick = analyzeCurrentRoute;
  elements.routeInfoOverlay.onclick = event => {
    if (event.target === elements.routeInfoOverlay) closeRouteInfo();
  };

  render();
  fitVisibleRoutes();
});

async function importFiles(files) {
  let importedCount = 0;
  for (const file of files) {
    try {
      const route = {
        ...parseGPX(await file.text(), file.name),
        color: COLORS[routes.length % COLORS.length],
        visible: true,
        favorite: false,
        notes: '',
        hikeDate: '',
        comparison: null,
        createdAt: Date.now() + importedCount
      };
      route.id = await add(db, route);
      routes.unshift(route);
      importedCount += 1;
    } catch (error) {
      console.error(`Errore nel file ${file.name}:`, error);
    }
  }
  elements.gpxInput.value = '';
  render();
  fitVisibleRoutes();
  showMessage(importedCount ? `${importedCount} percorso/i importato/i.` : 'Nessun GPX valido.');
}

async function showAllRoutes() {
  routes.forEach(route => { route.visible = true; });
  await Promise.all(routes.map(route => save(db, route)));
  render();
  fitVisibleRoutes();
}

function render() {
  layers.forEach(layer => removeLayerFromMap(layer));
  layers.clear();

  routes.forEach(route => {
    const layer = createRouteLayer(route);
    if (route.visible) addLayerToMap(layer);
    layers.set(route.id, layer);
  });

  elements.recentRoutes.innerHTML = '';
  routes.forEach(route => {
    const item = document.createElement('article');
    item.className = 'route-item';
    item.dataset.name = route.name.toLowerCase();
    const analysisBadge = route.comparison ? ` · 🟢 ${route.comparison.newPercent.toFixed(0)}% nuovo` : '';
    item.innerHTML = `<div class="route-main"><span class="route-color" style="background:${route.color}"></span><div class="route-info"><span class="route-name">${escapeHtml(route.name)} ${route.favorite ? '⭐' : ''}</span><span class="route-details">${route.distanceKm.toFixed(2)} km · ${route.elevationGain} m${analysisBadge}</span></div></div><div class="route-actions"><button class="route-toggle">${route.visible ? '👁️' : '🙈'}</button><button class="route-delete">🗑️</button></div>`;

    item.querySelector('.route-main').onclick = () => {
      const layer = layers.get(route.id);
      map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      openRouteInfo(route);
    };
    item.querySelector('.route-toggle').onclick = async () => {
      route.visible = !route.visible;
      await save(db, route);
      render();
    };
    item.querySelector('.route-delete').onclick = async () => {
      if (!confirm(`Eliminare "${route.name}"?`)) return;
      await remove(db, route.id);
      routes = routes.filter(itemRoute => itemRoute.id !== route.id);
      render();
      fitVisibleRoutes();
    };
    elements.recentRoutes.appendChild(item);
  });

  elements.routeCount.textContent = routes.length;
  elements.totalDistance.textContent = `${routes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)} km`;
  elements.totalElevation.textContent = `${Math.round(routes.reduce((sum, route) => sum + route.elevationGain, 0))} m`;
  elements.zoneCount.textContent = new Set(routes.map(route => route.zone)).size;
  filterRoutes(elements.searchRoutes.value);
}

function createRouteLayer(route) {
  if (!route.comparison?.segments?.length) {
    return L.polyline(route.points.map(point => [point.lat, point.lon]), {
      color: route.color,
      weight: 5,
      opacity: 0.85
    }).bindPopup(`<strong>${escapeHtml(route.name)}</strong><br>${route.distanceKm.toFixed(2)} km<br>${route.elevationGain} m`).on('click', () => openRouteInfo(route));
  }

  const group = L.featureGroup();
  route.comparison.segments.forEach(segment => {
    L.polyline([[segment.start.lat, segment.start.lon], [segment.end.lat, segment.end.lon]], {
      color: segment.alreadyWalked ? KNOWN_COLOR : NEW_COLOR,
      weight: 6,
      opacity: 0.9
    }).addTo(group);
  });
  group.bindPopup(`<strong>${escapeHtml(route.name)}</strong><br>🟢 Nuovo: ${route.comparison.newKm.toFixed(2)} km<br>⚪ Già percorso: ${route.comparison.knownKm.toFixed(2)} km`);
  group.on('click', () => openRouteInfo(route));
  return group;
}

function addLayerToMap(layer) {
  layer.addTo(map);
}

function removeLayerFromMap(layer) {
  if (map.hasLayer(layer)) map.removeLayer(layer);
}

function openRouteInfo(route) {
  currentRoute = route;
  elements.infoTitle.textContent = route.name;
  elements.infoDistance.textContent = `${route.distanceKm.toFixed(2)} km`;
  elements.infoElevation.textContent = `${route.elevationGain} m`;
  elements.infoZone.textContent = route.zone;
  elements.infoFileName.textContent = route.fileName || '-';
  elements.infoDate.value = route.hikeDate || '';
  elements.infoFavorite.checked = Boolean(route.favorite);
  elements.infoNotes.value = route.notes || '';
  updateAnalysisPanel(route.comparison);
  elements.routeInfoOverlay.hidden = false;
}

function closeRouteInfo() {
  elements.routeInfoOverlay.hidden = true;
  currentRoute = null;
}

async function saveRouteDetails() {
  if (!currentRoute) return;
  currentRoute.hikeDate = elements.infoDate.value;
  currentRoute.favorite = elements.infoFavorite.checked;
  currentRoute.notes = elements.infoNotes.value.trim();
  await save(db, currentRoute);
  closeRouteInfo();
  render();
  showMessage('Dettagli salvati.');
}

async function analyzeCurrentRoute() {
  if (!currentRoute) return;
  elements.analyzeRoute.disabled = true;
  elements.analyzeRoute.textContent = 'Analisi in corso…';
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    currentRoute.comparison = compareRoute(currentRoute, routes, COMPARISON_TOLERANCE_METERS);
    await save(db, currentRoute);
    updateAnalysisPanel(currentRoute.comparison);
    render();
    const layer = layers.get(currentRoute.id);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    showMessage('Confronto completato.');
  } catch (error) {
    console.error(error);
    showMessage('Non è stato possibile completare il confronto.');
  } finally {
    elements.analyzeRoute.disabled = false;
    elements.analyzeRoute.textContent = '🔍 Analizza percorso';
  }
}

function updateAnalysisPanel(comparison) {
  if (!comparison) {
    elements.analysisResult.hidden = true;
    return;
  }
  elements.analysisResult.hidden = false;
  elements.analysisTotal.textContent = `${comparison.totalKm.toFixed(2)} km`;
  elements.analysisNew.textContent = `${comparison.newKm.toFixed(2)} km (${comparison.newPercent.toFixed(0)}%)`;
  elements.analysisKnown.textContent = `${comparison.knownKm.toFixed(2)} km (${comparison.knownPercent.toFixed(0)}%)`;
  elements.analysisReferences.textContent = comparison.referenceRouteCount
    ? `Confrontato con ${comparison.referenceRouteCount} altri percorsi · tolleranza ${comparison.toleranceMeters} m.`
    : `Non ci sono altri percorsi da confrontare: tutto il tracciato risulta nuovo.`;
}

function fitVisibleRoutes() {
  const visibleLayers = routes.filter(route => route.visible).map(route => layers.get(route.id)).filter(Boolean);
  if (visibleLayers.length) map.fitBounds(L.featureGroup(visibleLayers).getBounds(), { padding: [30, 30] });
}

function filterRoutes(text) {
  const query = text.trim().toLowerCase();
  document.querySelectorAll('.route-item').forEach(item => {
    item.style.display = item.dataset.name.includes(query) ? '' : 'none';
  });
}

function showMessage(text) {
  elements.messageBox.textContent = text;
  elements.messageBox.hidden = false;
  setTimeout(() => { elements.messageBox.hidden = true; }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
