const EARTH_RADIUS_M = 6371000;
const DEFAULT_SAMPLE_STEP_M = 10;
const MAX_DIRECTION_DIFFERENCE_DEGREES = 50;
const MIN_MATCH_RATIO = 0.55;

/**
 * Confronta un percorso con tutti gli altri GPX salvati.
 * Un tratto è considerato già percorso quando la maggioranza dei punti
 * campionati si trova vicino a un segmento di riferimento con direzione
 * compatibile. Il confronto funziona anche se il percorso è stato fatto
 * nel verso opposto.
 */
export function compareRoute(targetRoute, allRoutes, toleranceMeters = 30) {
  const targetPoints = Array.isArray(targetRoute?.points) ? targetRoute.points : [];
  const referenceRoutes = allRoutes.filter(route =>
    route.id !== targetRoute.id && Array.isArray(route.points) && route.points.length > 1
  );

  const referenceIndex = buildSegmentIndex(referenceRoutes, toleranceMeters);
  const rawSegments = [];

  for (let index = 1; index < targetPoints.length; index += 1) {
    const start = targetPoints[index - 1];
    const end = targetPoints[index];
    const lengthMeters = distanceMeters(start, end);
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) continue;

    const samples = sampleSegment(start, end, Math.min(DEFAULT_SAMPLE_STEP_M, toleranceMeters / 2));
    let matchedSamples = 0;

    for (const sample of samples) {
      if (hasMatchingReference(sample, start, end, referenceIndex, toleranceMeters)) {
        matchedSamples += 1;
      }
    }

    const matchRatio = samples.length ? matchedSamples / samples.length : 0;
    rawSegments.push({
      start,
      end,
      lengthMeters,
      matchRatio,
      alreadyWalked: referenceRoutes.length > 0 && matchRatio >= MIN_MATCH_RATIO
    });
  }

  const segments = smoothIsolatedClassifications(rawSegments);
  let newMeters = 0;
  let knownMeters = 0;

  for (const segment of segments) {
    if (segment.alreadyWalked) knownMeters += segment.lengthMeters;
    else newMeters += segment.lengthMeters;
  }

  const totalMeters = newMeters + knownMeters;
  return {
    algorithmVersion: 2,
    toleranceMeters,
    comparedAt: new Date().toISOString(),
    referenceRouteCount: referenceRoutes.length,
    totalKm: totalMeters / 1000,
    newKm: newMeters / 1000,
    knownKm: knownMeters / 1000,
    newPercent: totalMeters ? (newMeters / totalMeters) * 100 : 0,
    knownPercent: totalMeters ? (knownMeters / totalMeters) * 100 : 0,
    segments
  };
}

function buildSegmentIndex(routes, cellSizeMeters) {
  const cells = new Map();

  for (const route of routes) {
    for (let index = 1; index < route.points.length; index += 1) {
      const start = route.points[index - 1];
      const end = route.points[index];
      if (distanceMeters(start, end) <= 0) continue;

      const segment = { start, end };
      const samplePoints = sampleSegment(start, end, Math.max(10, cellSizeMeters / 2));
      const keys = new Set(samplePoints.map(point => cellKey(point, cellSizeMeters)));

      for (const key of keys) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(segment);
      }
    }
  }

  return { cells, cellSizeMeters };
}

function hasMatchingReference(point, targetStart, targetEnd, index, toleranceMeters) {
  const { x, y } = projectedCell(point, index.cellSizeMeters);
  const checked = new Set();

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const candidates = index.cells.get(`${x + dx}:${y + dy}`) || [];

      for (const candidate of candidates) {
        if (checked.has(candidate)) continue;
        checked.add(candidate);

        if (!directionsAreCompatible(targetStart, targetEnd, candidate.start, candidate.end)) continue;
        if (pointToSegmentDistanceMeters(point, candidate.start, candidate.end) <= toleranceMeters) return true;
      }
    }
  }

  return false;
}

function directionsAreCompatible(firstStart, firstEnd, secondStart, secondEnd) {
  const first = localVector(firstStart, firstEnd);
  const second = localVector(secondStart, secondEnd);
  const firstLength = Math.hypot(first.x, first.y);
  const secondLength = Math.hypot(second.x, second.y);
  if (!firstLength || !secondLength) return true;

  // Valore assoluto: stesso sentiero riconosciuto anche nel verso opposto.
  const cosine = Math.min(1, Math.max(-1,
    Math.abs((first.x * second.x + first.y * second.y) / (firstLength * secondLength))
  ));
  const angle = Math.acos(cosine) * 180 / Math.PI;
  return angle <= MAX_DIRECTION_DIFFERENCE_DEGREES;
}

function pointToSegmentDistanceMeters(point, start, end) {
  const originLat = point.lat * Math.PI / 180;
  const toLocal = candidate => ({
    x: EARTH_RADIUS_M * (candidate.lon - point.lon) * Math.PI / 180 * Math.cos(originLat),
    y: EARTH_RADIUS_M * (candidate.lat - point.lat) * Math.PI / 180
  });

  const a = toLocal(start);
  const b = toLocal(end);
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const denominator = abX * abX + abY * abY;
  if (!denominator) return Math.hypot(a.x, a.y);

  const t = Math.max(0, Math.min(1, -(a.x * abX + a.y * abY) / denominator));
  const closestX = a.x + t * abX;
  const closestY = a.y + t * abY;
  return Math.hypot(closestX, closestY);
}

function smoothIsolatedClassifications(segments) {
  if (segments.length < 3) return segments;
  const result = segments.map(segment => ({ ...segment }));

  for (let index = 1; index < result.length - 1; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    const next = result[index + 1];

    if (previous.alreadyWalked === next.alreadyWalked && current.alreadyWalked !== previous.alreadyWalked) {
      // Corregge solo piccoli falsi cambi di colore, non tratti lunghi reali.
      if (current.lengthMeters <= 45) current.alreadyWalked = previous.alreadyWalked;
    }
  }

  return result;
}

function sampleSegment(start, end, stepMeters) {
  const length = distanceMeters(start, end);
  const steps = Math.max(1, Math.ceil(length / Math.max(1, stepMeters)));
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    points.push({
      lat: start.lat + (end.lat - start.lat) * ratio,
      lon: start.lon + (end.lon - start.lon) * ratio
    });
  }

  return points;
}

function localVector(start, end) {
  const middleLat = ((start.lat + end.lat) / 2) * Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * (end.lon - start.lon) * Math.PI / 180 * Math.cos(middleLat),
    y: EARTH_RADIUS_M * (end.lat - start.lat) * Math.PI / 180
  };
}

function projectedCell(point, cellSizeMeters) {
  const latitudeRadians = point.lat * Math.PI / 180;
  const xMeters = EARTH_RADIUS_M * point.lon * Math.PI / 180 * Math.cos(latitudeRadians);
  const yMeters = EARTH_RADIUS_M * point.lat * Math.PI / 180;
  return {
    x: Math.floor(xMeters / cellSizeMeters),
    y: Math.floor(yMeters / cellSizeMeters)
  };
}

function cellKey(point, cellSizeMeters) {
  const { x, y } = projectedCell(point, cellSizeMeters);
  return `${x}:${y}`;
}

export function distanceMeters(first, second) {
  const toRadians = Math.PI / 180;
  const deltaLat = (second.lat - first.lat) * toRadians;
  const deltaLon = (second.lon - first.lon) * toRadians;
  const firstLat = first.lat * toRadians;
  const secondLat = second.lat * toRadians;
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
