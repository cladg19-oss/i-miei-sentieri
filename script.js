const DB_NAME = "sentieriDB";
const STORE_NAME = "routes";
const DB_VERSION = 1;

const COLORS = [
    "#2f7d4f",
    "#d97706",
    "#2563eb",
    "#9333ea",
    "#dc2626",
    "#0891b2",
    "#65a30d",
    "#c026d3"
];

let db;
let map;
let routes = [];
let routeLayers = new Map();

document.addEventListener("DOMContentLoaded", async () => {
    initializeMenu();
    initializeMap();
    initializeControls();
    initializeSearch();
    initializeInfoPanel();

    try {
        db = await openDatabase();
        routes = await getAllRoutes();

        renderEverything();
        fitAllRoutes();
    } catch (error) {
        console.error(error);
        showMessage("Errore durante l'apertura dell'archivio.");
    }
});

function initializeMenu() {
    const menuItems = document.querySelectorAll(".menu-item");

    menuItems.forEach((button) => {
        button.addEventListener("click", () => {
            menuItems.forEach((item) => {
                item.classList.remove("active");
            });

            button.classList.add("active");
        });
    });
}

function initializeMap() {
    map = L.map("map").setView([45.714, 9.465], 13);

    L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap"
        }
    ).addTo(map);

    L.marker([45.714, 9.465])
        .addTo(map)
        .bindPopup(
            "<strong>I Miei Sentieri</strong><br>Villa d'Adda"
        );
}

function initializeControls() {
    const importButton =
        document.getElementById("importButton");

    const gpxInput =
        document.getElementById("gpxInput");

    const showAllButton =
        document.getElementById("showAllButton");

    importButton.addEventListener("click", () => {
        gpxInput.click();
    });

    gpxInput.addEventListener("change", async (event) => {
        const files = Array.from(
            event.target.files || []
        );

        if (files.length === 0) {
            return;
        }

        await importFiles(files);

        gpxInput.value = "";
    });

    showAllButton.addEventListener("click", async () => {
        routes.forEach((route) => {
            route.visible = true;
        });

        await Promise.all(
            routes.map((route) => saveRoute(route))
        );

        renderEverything();
        fitAllRoutes();
    });
}

function initializeSearch() {
    const searchInput =
        document.getElementById("searchRoutes");

    if (!searchInput) {
        return;
    }

    searchInput.addEventListener("input", () => {
        filterRouteList(searchInput.value);
    });
}

function initializeInfoPanel() {
    const overlay =
        document.getElementById("routeInfoOverlay");

    const closeButton =
        document.getElementById("closeInfoPanel");

    const closeIcon =
        document.getElementById("closeInfoIcon");

    closeButton.addEventListener("click", closeRouteInfo);
    closeIcon.addEventListener("click", closeRouteInfo);

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            closeRouteInfo();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            !overlay.hidden
        ) {
            closeRouteInfo();
        }
    });
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(
            DB_NAME,
            DB_VERSION
        );

        request.onupgradeneeded = (event) => {
            const database =
                event.target.result;

            if (
                !database.objectStoreNames.contains(
                    STORE_NAME
                )
            ) {
                database.createObjectStore(
                    STORE_NAME,
                    {
                        keyPath: "id",
                        autoIncrement: true
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

function getAllRoutes() {
    return new Promise((resolve, reject) => {
        const transaction =
            db.transaction(
                STORE_NAME,
                "readonly"
            );

        const store =
            transaction.objectStore(STORE_NAME);

        const request =
            store.getAll();

        request.onsuccess = () => {
            const storedRoutes =
                request.result
                    .map((route) => ({
                        ...route,
                        visible:
                            route.visible !== false
                    }))
                    .sort(
                        (first, second) =>
                            second.createdAt -
                            first.createdAt
                    );

            resolve(storedRoutes);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function addRoute(route) {
    return new Promise((resolve, reject) => {
        const transaction =
            db.transaction(
                STORE_NAME,
                "readwrite"
            );

        const store =
            transaction.objectStore(STORE_NAME);

        const request =
            store.add(route);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function saveRoute(route) {
    return new Promise((resolve, reject) => {
        const transaction =
            db.transaction(
                STORE_NAME,
                "readwrite"
            );

        const store =
            transaction.objectStore(STORE_NAME);

        const request =
            store.put(route);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function deleteRoute(id) {
    return new Promise((resolve, reject) => {
        const transaction =
            db.transaction(
                STORE_NAME,
                "readwrite"
            );

        const store =
            transaction.objectStore(STORE_NAME);

        const request =
            store.delete(id);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function importFiles(files) {
    let imported = 0;
    let failed = 0;

    for (const file of files) {
        try {
            const text =
                await file.text();

            const parsedRoute =
                parseGPX(text, file.name);

            const route = {
                ...parsedRoute,
                color:
                    COLORS[
                        routes.length %
                        COLORS.length
                    ],
                visible: true,
                createdAt:
                    Date.now() + imported
            };

            route.id =
                await addRoute(route);

            routes.unshift(route);

            imported += 1;
        } catch (error) {
            console.error(
                `Errore nel file ${file.name}`,
                error
            );

            failed += 1;
        }
    }

    renderEverything();
    fitAllRoutes();

    if (
        imported > 0 &&
        failed === 0
    ) {
        showMessage(
            `${imported} percorso/i importato/i correttamente.`
        );
    } else if (
        imported > 0 &&
        failed > 0
    ) {
        showMessage(
            `${imported} importato/i, ${failed} non valido/i.`
        );
    } else {
        showMessage(
            "Nessun file GPX valido importato."
        );
    }
}

function parseGPX(text, fileName) {
    const parser =
        new DOMParser();

    const xml =
        parser.parseFromString(
            text,
            "application/xml"
        );

    if (
        xml.querySelector("parsererror")
    ) {
        throw new Error(
            "Il file XML non è valido."
        );
    }

    let pointElements =
        Array.from(
            xml.querySelectorAll("trkpt")
        );

    if (
        pointElements.length === 0
    ) {
        pointElements =
            Array.from(
                xml.querySelectorAll("rtept")
            );
    }

    if (
        pointElements.length === 0
    ) {
        pointElements =
            Array.from(
                xml.querySelectorAll("wpt")
            );
    }

    const points =
        pointElements
            .map((element) => {
                const elevationElement =
                    element.querySelector("ele");

                return {
                    lat: Number(
                        element.getAttribute("lat")
                    ),
                    lon: Number(
                        element.getAttribute("lon")
                    ),
                    ele: elevationElement
                        ? Number(
                            elevationElement.textContent
                        )
                        : null
                };
            })
            .filter((point) => {
                return (
                    Number.isFinite(point.lat) &&
                    Number.isFinite(point.lon)
                );
            });

    if (points.length < 2) {
        throw new Error(
            "Il GPX non contiene un percorso valido."
        );
    }

    const nameElement =
        xml.querySelector("trk > name") ||
        xml.querySelector("rte > name") ||
        xml.querySelector("metadata > name");

    const routeName =
        nameElement?.textContent?.trim() ||
        fileName.replace(/\.gpx$/i, "");

    const distanceKm =
        calculateDistance(points);

    const elevationGain =
        calculateElevationGain(points);

    const zone =
        `${points[0].lat.toFixed(2)}, ` +
        `${points[0].lon.toFixed(2)}`;

    return {
        name: routeName,
        fileName,
        points,
        distanceKm,
        elevationGain,
        zone
    };
}

function calculateDistance(points) {
    let totalDistance = 0;

    for (
        let index = 1;
        index < points.length;
        index += 1
    ) {
        totalDistance += haversineDistance(
            points[index - 1],
            points[index]
        );
    }

    return totalDistance;
}

function haversineDistance(first, second) {
    const earthRadiusKm = 6371;

    const toRadians = (degrees) =>
        degrees * Math.PI / 180;

    const latitude1 =
        toRadians(first.lat);

    const latitude2 =
        toRadians(second.lat);

    const latitudeDifference =
        toRadians(
            second.lat - first.lat
        );

    const longitudeDifference =
        toRadians(
            second.lon - first.lon
        );

    const value =
        Math.sin(
            latitudeDifference / 2
        ) ** 2 +
        Math.cos(latitude1) *
        Math.cos(latitude2) *
        Math.sin(
            longitudeDifference / 2
        ) ** 2;

    return (
        earthRadiusKm *
        2 *
        Math.atan2(
            Math.sqrt(value),
            Math.sqrt(1 - value)
        )
    );
}

function calculateElevationGain(points) {
    let elevationGain = 0;

    for (
        let index = 1;
        index < points.length;
        index += 1
    ) {
        const previousElevation =
            points[index - 1].ele;

        const currentElevation =
            points[index].ele;

        if (
            Number.isFinite(previousElevation) &&
            Number.isFinite(currentElevation) &&
            currentElevation >
            previousElevation
        ) {
            elevationGain +=
                currentElevation -
                previousElevation;
        }
    }

    return Math.round(elevationGain);
}

function renderEverything() {
    renderMapRoutes();
    renderRouteList();
    renderStatistics();

    const searchInput =
        document.getElementById("searchRoutes");

    if (searchInput) {
        filterRouteList(
            searchInput.value
        );
    }
}

function renderMapRoutes() {
    routeLayers.forEach((layer) => {
        map.removeLayer(layer);
    });

    routeLayers.clear();

    routes.forEach((route) => {
        const coordinates =
            route.points.map((point) => [
                point.lat,
                point.lon
            ]);

        const layer =
            L.polyline(
                coordinates,
                {
                    color: route.color,
                    weight: 5,
                    opacity: 0.85
                }
            );

        layer.bindPopup(
            `<strong>${escapeHTML(route.name)}</strong><br>` +
            `${route.distanceKm.toFixed(2)} km<br>` +
            `Dislivello: ${route.elevationGain} m`
        );

        layer.on("click", () => {
            openRouteInfo(route);
        });

        if (route.visible) {
            layer.addTo(map);
        }

        routeLayers.set(
            route.id,
            layer
        );
    });
}

function renderRouteList() {
    const container =
        document.getElementById(
            "recentRoutes"
        );

    container.innerHTML = "";

    if (routes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span>📂</span>
                <p>
                    I tuoi percorsi GPX appariranno qui.
                </p>
            </div>
        `;

        return;
    }

    routes.forEach((route) => {
        const item =
            document.createElement("article");

        item.className =
            "route-item";

        item.dataset.routeName =
            route.name.toLowerCase();

        item.innerHTML = `
            <div class="route-main">
                <span
                    class="route-color"
                    style="background:${route.color}"
                ></span>

                <div class="route-info">
                    <span class="route-name">
                        ${escapeHTML(route.name)}
                    </span>

                    <span class="route-details">
                        ${route.distanceKm.toFixed(2)} km ·
                        ${route.elevationGain} m
                    </span>
                </div>
            </div>

            <div class="route-actions">
                <button
                    class="route-toggle ${
                        route.visible
                            ? ""
                            : "hidden-route"
                    }"
                    type="button"
                    title="${
                        route.visible
                            ? "Nascondi percorso"
                            : "Mostra percorso"
                    }"
                >
                    ${route.visible ? "👁️" : "🙈"}
                </button>

                <button
                    class="route-delete"
                    type="button"
                    title="Elimina percorso"
                >
                    🗑️
                </button>
            </div>
        `;

        const routeMain =
            item.querySelector(
                ".route-main"
            );

        const toggleButton =
            item.querySelector(
                ".route-toggle"
            );

        const deleteButton =
            item.querySelector(
                ".route-delete"
            );

        routeMain.addEventListener(
            "click",
            () => {
                focusRoute(route);
                openRouteInfo(route);
            }
        );

        toggleButton.addEventListener(
            "click",
            async () => {
                route.visible =
                    !route.visible;

                await saveRoute(route);

                renderEverything();

                if (route.visible) {
                    focusRoute(route);
                }
            }
        );

        deleteButton.addEventListener(
            "click",
            async () => {
                const confirmed =
                    window.confirm(
                        `Vuoi eliminare il percorso "${route.name}"?`
                    );

                if (!confirmed) {
                    return;
                }

                await deleteRoute(
                    route.id
                );

                routes =
                    routes.filter(
                        (savedRoute) =>
                            savedRoute.id !==
                            route.id
                    );

                closeRouteInfo();
                renderEverything();
                fitAllRoutes();

                showMessage(
                    "Percorso eliminato."
                );
            }
        );

        container.appendChild(item);
    });
}

function renderStatistics() {
    const totalDistance =
        routes.reduce(
            (sum, route) =>
                sum +
                route.distanceKm,
            0
        );

    const totalElevation =
        routes.reduce(
            (sum, route) =>
                sum +
                route.elevationGain,
            0
        );

    const zones =
        new Set(
            routes.map(
                (route) =>
                    route.zone
            )
        );

    document.getElementById(
        "routeCount"
    ).textContent =
        routes.length;

    document.getElementById(
        "totalDistance"
    ).textContent =
        `${totalDistance.toFixed(1)} km`;

    document.getElementById(
        "totalElevation"
    ).textContent =
        `${Math.round(totalElevation)} m`;

    document.getElementById(
        "zoneCount"
    ).textContent =
        zones.size;
}

function filterRouteList(searchText) {
    const normalizedText =
        searchText
            .trim()
            .toLowerCase();

    const routeItems =
        document.querySelectorAll(
            ".route-item"
        );

    routeItems.forEach((item) => {
        const routeName =
            item.dataset.routeName || "";

        item.style.display =
            routeName.includes(
                normalizedText
            )
                ? ""
                : "none";
    });
}

function focusRoute(route) {
    const layer =
        routeLayers.get(route.id);

    if (!layer) {
        return;
    }

    if (!route.visible) {
        route.visible = true;
        saveRoute(route);
        layer.addTo(map);
    }

    map.fitBounds(
        layer.getBounds(),
        {
            padding: [30, 30]
        }
    );

    layer.openPopup();
}

function fitAllRoutes() {
    const visibleLayers =
        routes
            .filter(
                (route) =>
                    route.visible
            )
            .map(
                (route) =>
                    routeLayers.get(
                        route.id
                    )
            )
            .filter(Boolean);

    if (
        visibleLayers.length === 0
    ) {
        map.setView(
            [45.714, 9.465],
            13
        );

        return;
    }

    const group =
        L.featureGroup(
            visibleLayers
        );

    map.fitBounds(
        group.getBounds(),
        {
            padding: [30, 30]
        }
    );
}

function openRouteInfo(route) {
    const overlay =
        document.getElementById(
            "routeInfoOverlay"
        );

    document.getElementById(
        "infoTitle"
    ).textContent =
        route.name;

    document.getElementById(
        "infoDistance"
    ).textContent =
        `${route.distanceKm.toFixed(2)} km`;

    document.getElementById(
        "infoElevation"
    ).textContent =
        `${route.elevationGain} m`;

    document.getElementById(
        "infoZone"
    ).textContent =
        route.zone;

    document.getElementById(
        "infoFileName"
    ).textContent =
        route.fileName || "-";

    overlay.hidden = false;
}

function closeRouteInfo() {
    const overlay =
        document.getElementById(
            "routeInfoOverlay"
        );

    overlay.hidden = true;
}

function showMessage(text) {
    const messageBox =
        document.getElementById(
            "messageBox"
        );

    messageBox.textContent =
        text;

    messageBox.hidden =
        false;

    clearTimeout(
        showMessage.timeoutId
    );

    showMessage.timeoutId =
        setTimeout(() => {
            messageBox.hidden =
                true;
        }, 3500);
}

function escapeHTML(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}