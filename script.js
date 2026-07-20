const emptyState = document.getElementById("emptyState");
const showAllButton = document.getElementById("showAllButton");
const menuItems = document.querySelectorAll(".menu-item");
const importButton = document.getElementById("importButton");
const gpxInput = document.getElementById("gpxInput");
const routeCount = document.getElementById("routeCount");
const totalDistance = document.getElementById("totalDistance");
const recentRoutes = document.getElementById("recentRoutes");
const emptyState = document.getElementById("emptyState");

const routeLayers = [];
const importedRoutes = [];

const routeColors = [
    "#e53935",
    "#1e88e5",
    "#43a047",
    "#fb8c00",
    "#8e24aa",
    "#00897b",
    "#3949ab",
    "#d81b60"
];

const DATABASE_NAME = "I_Miei_Sentieri";
const DATABASE_VERSION = 1;
const STORE_NAME = "percorsi";

let database = null;

/* ---------------------------------
   MENU LATERALE
--------------------------------- */

menuItems.forEach((item) => {
    item.addEventListener("click", () => {
        menuItems.forEach((button) => {
            button.classList.remove("active");
        });

        item.classList.add("active");
    });
});

/* ---------------------------------
   MAPPA
--------------------------------- */

const map = L.map("map").setView([45.714, 9.465], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
}).addTo(map);

const initialMarker = L.marker([45.714, 9.465])
    .addTo(map)
    .bindPopup(
        "<strong>I Miei Sentieri</strong><br>" +
        "Zona iniziale: Villa d'Adda"
    );

/* ---------------------------------
   AVVIO DELL'APPLICAZIONE
--------------------------------- */

startApplication();

async function startApplication() {
    try {
        database = await openDatabase();
        await loadSavedRoutes();
    } catch (error) {
        console.error("Errore durante l'avvio:", error);
        showMessage("Non riesco ad aprire l'archivio dei percorsi.");
    }
}

/* ---------------------------------
   IMPORTAZIONE GPX
--------------------------------- */

importButton.addEventListener("click", () => {
    gpxInput.click();
});

gpxInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
        return;
    }

    let importedNow = 0;
    let duplicates = 0;

    for (const file of files) {
        try {
            const result = await importGpxFile(file);

            if (result === "duplicate") {
                duplicates++;
            } else {
                importedNow++;
            }
        } catch (error) {
            console.error(`Errore nel file ${file.name}:`, error);
            showMessage(`Non riesco a leggere: ${file.name}`);
        }
    }

    if (importedNow > 0) {
        showMessage(
            importedNow === 1
                ? "Percorso importato e salvato."
                : `${importedNow} percorsi importati e salvati.`
        );
    } else if (duplicates > 0) {
        showMessage("I percorsi selezionati erano già presenti.");
    }

    gpxInput.value = "";
});

async function importGpxFile(file) {
    const routeId = createRouteId(file);

    const alreadyExists = await getRouteFromDatabase(routeId);

    if (alreadyExists) {
        return "duplicate";
    }

    const gpxText = await file.text();

    const parser = new DOMParser();
    const gpxDocument = parser.parseFromString(
        gpxText,
        "application/xml"
    );

    const parserError = gpxDocument.querySelector("parsererror");

    if (parserError) {
        throw new Error("File GPX non valido");
    }

    const trackPoints = Array.from(
        gpxDocument.querySelectorAll("trkpt")
    );

    const routePoints = Array.from(
        gpxDocument.querySelectorAll("rtept")
    );

    const points =
        trackPoints.length > 0
            ? trackPoints
            : routePoints;

    if (points.length < 2) {
        throw new Error("Il GPX non contiene un percorso valido");
    }

    const coordinates = points
        .map((point) => {
            const latitude = Number(point.getAttribute("lat"));
            const longitude = Number(point.getAttribute("lon"));

            return [latitude, longitude];
        })
        .filter(([latitude, longitude]) => {
            return (
                Number.isFinite(latitude) &&
                Number.isFinite(longitude)
            );
        });

    if (coordinates.length < 2) {
        throw new Error("Coordinate GPX non valide");
    }

    const name = getRouteName(gpxDocument, file.name);
    const distance = calculateRouteDistance(coordinates);

    const route = {
        id: routeId,
        name: name,
        fileName: file.name,
        distance: distance,
        points: coordinates.length,
        coordinates: coordinates,
        importedAt: new Date().toISOString()
    };

    await saveRouteToDatabase(route);
    displayRoute(route);

    return "imported";
}

function createRouteId(file) {
    return `${file.name}_${file.size}_${file.lastModified}`;
}

function getRouteName(gpxDocument, fileName) {
    const trackName = gpxDocument.querySelector("trk > name");
    const routeName = gpxDocument.querySelector("rte > name");
    const metadataName = gpxDocument.querySelector(
        "metadata > name"
    );

    const name =
        trackName?.textContent?.trim() ||
        routeName?.textContent?.trim() ||
        metadataName?.textContent?.trim();

    if (name) {
        return name;
    }

    return fileName.replace(/\.gpx$/i, "");
}

/* ---------------------------------
   VISUALIZZAZIONE DEI PERCORSI
--------------------------------- */

function displayRoute(route) {
    const color =
        routeColors[importedRoutes.length % routeColors.length];

    const routeLine = L.polyline(route.coordinates, {
        color: color,
        weight: 5,
        opacity: 0.85
    }).addTo(map);

    routeLine.bindPopup(
        `<strong>${escapeHtml(route.name)}</strong><br>` +
        `${route.distance.toFixed(2)} km<br>` +
        `${route.points} punti`
    );

    const displayedRoute = {
        ...route,
        color: color,
        layer: routeLine
    };

    importedRoutes.push(displayedRoute);
    routeLayers.push(routeLine);

    if (map.hasLayer(initialMarker)) {
        initialMarker.remove();
    }

    addRouteToList(displayedRoute);
    updateStatistics();
    zoomToAllRoutes();
}

showAllButton.addEventListener("click", () => {
    importedRoutes.forEach((route) => {
        if (!map.hasLayer(route.layer)) {
            route.layer.addTo(map);
        }
    });

    document
        .querySelectorAll(".route-toggle")
        .forEach((button) => {
            button.textContent = "👁️";
            button.title = "Nascondi percorso";
            button.classList.remove("hidden-route");
        });

    zoomToAllRoutes();
});
     {
        const previousPoint = L.latLng(
            coordinates[index - 1][0],
            coordinates[index - 1][1]
        );

        const currentPoint = L.latLng(
            coordinates[index][0],
            coordinates[index][1]
        );

        totalMetres += previousPoint.distanceTo(currentPoint);
    }

    return totalMetres / 1000;
}

/* ---------------------------------
   ARCHIVIO INDEXEDDB
--------------------------------- */

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(
            DATABASE_NAME,
            DATABASE_VERSION
        );

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(
                    STORE_NAME,
                    {
                        keyPath: "id"
                    }
                );

                store.createIndex(
                    "importedAt",
                    "importedAt",
                    {
                        unique: false
                    }
                );
            }
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function saveRouteToDatabase(route) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(route);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function getRouteFromDatabase(routeId) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(routeId);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function getAllRoutesFromDatabase() {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            STORE_NAME,
            "readonly"
        );

        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function loadSavedRoutes() {
    const savedRoutes = await getAllRoutesFromDatabase();

    savedRoutes.sort((firstRoute, secondRoute) => {
        return new Date(firstRoute.importedAt) -
               new Date(secondRoute.importedAt);
    });

    savedRoutes.forEach((route) => {
        displayRoute(route);
    });

    if (savedRoutes.length > 0) {
        showMessage(
            `${savedRoutes.length} percorsi caricati dall'archivio.`
        );
    }
}

/* ---------------------------------
   MESSAGGI E SICUREZZA
--------------------------------- */

function showMessage(text) {
    const oldMessage = document.querySelector(
        ".import-message"
    );

    if (oldMessage) {
        oldMessage.remove();
    }

    const message = document.createElement("div");
    message.className = "import-message";
    message.textContent = text;

    document.body.appendChild(message);

    setTimeout(() => {
        message.remove();
    }, 3000);
}

function escapeHtml(text) {
    const element = document.createElement("div");
    element.textContent = text;
    return element.innerHTML;
}