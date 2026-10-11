"use strict";

const EARTH_RADIUS_KM = 6371;
const COLORS = ["#38bdf8", "#f97316", "#a78bfa", "#22c55e", "#f43f5e", "#facc15"];

const airports = new Map();
let databaseLoaded = false;
let lastRows = [];

const byId = (id) => document.getElementById(id);
const status = byId("status-message");
const columns = byId("route-columns");
const resultsBody = byId("results-body");
const exportButtons = byId("exports");

const map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Tiles © Esri" }
).addTo(map);
const openStreetMap = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  { maxZoom: 19, attribution: "© OpenStreetMap contributors" }
);
L.control.layers({ Satellite: satelliteLayer, OpenStreetMap: openStreetMap }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

function findColumn(headers, ...names) {
  const cleaned = headers.map((header) =>
    String(header).toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  return cleaned.findIndex((header) => names.includes(header));
}

async function loadAirportsCSV() {
  try {
    const response = await fetch("./airports.csv", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const lines = (await response.text())
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim());

    const headers = parseCsvLine(lines[0]);
    const identIndex = findColumn(headers, "ident");
    const iataIndex = findColumn(headers, "iata", "iatacode");
    const icaoIndex = findColumn(headers, "icao", "icaocode", "gpscode");
    const latitudeIndex = findColumn(headers, "latitude", "latitudedeg", "lat");
    const longitudeIndex = findColumn(headers, "longitude", "longitudedeg", "lon", "lng");

    if (latitudeIndex < 0 || longitudeIndex < 0) {
      throw new Error("latitude/longitude columns are missing");
    }

    for (const line of lines.slice(1)) {
      const row = parseCsvLine(line);
      const lat = Number(row[latitudeIndex]);
      const lon = Number(row[longitudeIndex]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      for (const index of [identIndex, iataIndex, icaoIndex]) {
        const code = index >= 0 ? String(row[index] || "").trim().toUpperCase() : "";
        if (code) airports.set(code, { lat, lon });
      }
    }

    databaseLoaded = true;
    status.textContent = `airports.csv loaded (${airports.size.toLocaleString()} codes)`;
  } catch (error) {
    console.error(error);
    status.textContent = `Could not load airports.csv: ${error.message}`;
  }
}

const radians = (value) => (value * Math.PI) / 180;
const degrees = (value) => (value * 180) / Math.PI;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalizeLongitude = (longitude) => ((longitude + 540) % 360) - 180;

function distance(a, b) {
  const deltaLat = radians(b.lat - a.lat);
  const deltaLon = radians(b.lon - a.lon);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function vector(point) {
  const latitude = radians(point.lat);
  const longitude = radians(point.lon);
  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude)
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function normalized(value) {
  const length = magnitude(value);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function pointFromVector(value) {
  return {
    lat: degrees(Math.atan2(value.z, Math.hypot(value.x, value.y))),
    lon: normalizeLongitude(degrees(Math.atan2(value.y, value.x)))
  };
}

function sameAirport(a, b) {
  return distance(a, b) <= 1;
}

function sharedEndpointIntersection(routeA, routeB) {
  const endpointPairs = [
    [routeA.start, routeB.start],
    [routeA.start, routeB.end],
    [routeA.end, routeB.start],
    [routeA.end, routeB.end]
  ];

  for (const [first, second] of endpointPairs) {
    if (sameAirport(first, second)) {
      return { lat: first.lat, lon: first.lon, method: "shared-airport" };
    }
  }

  return null;
}

function onRoute(point, route, toleranceKm = 4) {
  return Math.abs(
    distance(route.start, point) + distance(point, route.end) - distance(route.start, route.end)
  ) <= toleranceKm;
}

function intersection(routeA, routeB) {
  const shared = sharedEndpointIntersection(routeA, routeB);
  if (shared) return shared;

  const planeA = cross(vector(routeA.start), vector(routeA.end));
  const planeB = cross(vector(routeB.start), vector(routeB.end));
  const crossing = cross(planeA, planeB);

  if (magnitude(crossing) < 1e-12) return null;

  const first = pointFromVector(normalized(crossing));
  const second = { lat: -first.lat, lon: normalizeLongitude(first.lon + 180) };

  if (onRoute(first, routeA) && onRoute(first, routeB)) {
    return { ...first, method: "great-circle" };
  }

  if (onRoute(second, routeA) && onRoute(second, routeB)) {
    return { ...second, method: "great-circle" };
  }

  return null;
}

function greatCirclePoints(route, count = 120) {
  const start = vector(route.start);
  const end = vector(route.end);
  const angle = Math.acos(clamp(start.x * end.x + start.y * end.y + start.z * end.z, -1, 1));
  if (angle < 1e-9) return [route.start];

  const sine = Math.sin(angle);
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const fraction = index / count;
    const startWeight = Math.sin((1 - fraction) * angle) / sine;
    const endWeight = Math.sin(fraction * angle) / sine;
    points.push(pointFromVector(normalized({
      x: startWeight * start.x + endWeight * end.x,
      y: startWeight * start.y + endWeight * end.y,
      z: startWeight * start.z + endWeight * end.z
    })));
  }

  return points;
}

function parseColumn(text, letter) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let name = `Airline ${letter}`;

  if (lines[0] && lines[0].startsWith("#")) {
    name = lines.shift().slice(1).trim() || name;
  }

  const routes = [];
  const unknownCodes = new Set();

  for (const line of lines) {
    const codes = line.replace(/[–—/,\t]/g, "-").split("-")
      .map((code) => code.trim().toUpperCase()).filter(Boolean);
    if (codes.length < 2) continue;

    const start = airports.get(codes[0]);
    const end = airports.get(codes[1]);
    if (!start || !end) {
      if (!start) unknownCodes.add(codes[0]);
      if (!end) unknownCodes.add(codes[1]);
      continue;
    }

    routes.push({ name: `${codes[0]}-${codes[1]}`, start, end });
  }

  return { name, routes, unknownCodes: [...unknownCodes] };
}

function selectedPairs(count, mode, patterns) {
  const pairs = [];
  if (mode === "all") {
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) pairs.push([a, b]);
    }
  } else if (mode.startsWith("pairwise")) {
    for (let index = 0; index + 1 < count; index += 2) pairs.push([index, index + 1]);
    if (mode === "pairwise-wrap" && count > 2) pairs.push([count - 1, 0]);
  } else {
    for (const token of patterns.split(/[,\s]+/)) {
      const match = token.toUpperCase().match(/^([A-F])-([A-F])$/);
      if (!match) continue;
      const a = match[1].charCodeAt(0) - 65;
      const b = match[2].charCodeAt(0) - 65;
      if (a < count && b < count && a !== b && !pairs.some((pair) => pair[0] === a && pair[1] === b)) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

function render() {
  if (!lastRows.length) {
    resultsBody.innerHTML = '<tr><td colspan="8">No airline pairs matched the selected patterns and intercept-count filter.</td></tr>';
    exportButtons.classList.add("hidden");
    return;
  }

  resultsBody.innerHTML = lastRows.map((row) => `
    <tr><td>${row.airlineA}</td><td>${row.airlineB}</td>
    <td>${row.routeA} × ${row.routeB}</td><td>${row.pairCount}</td>
    <td>${row.aDistance.toFixed(1)} km</td><td>${row.bDistance.toFixed(1)} km</td>
    <td>${row.lat.toFixed(6)}°</td><td>${row.lon.toFixed(6)}°</td></tr>
  `).join("");
  exportButtons.classList.remove("hidden");
}

function runAnalysis() {
  if (!databaseLoaded) return alert("airports.csv is still loading.");

  const sets = [...columns.children].map((box, index) =>
    parseColumn(box.querySelector("textarea").value, String.fromCharCode(65 + index))
  );

  console.table(sets.map((set, index) => ({
    column: String.fromCharCode(65 + index), airline: set.name,
    validRoutes: set.routes.length, unknownCodes: set.unknownCodes.join(", ")
  })));

  let min = clamp(Number(byId("min-intercepts").value) || 1, 1, 10);
  let max = clamp(Number(byId("max-intercepts").value) || 10, 1, 10);
  if (min > max) [min, max] = [max, min];

  routeLayer.clearLayers();
  const passingGroups = [];

  for (const [aIndex, bIndex] of selectedPairs(sets.length, byId("compare-mode").value, byId("pair-patterns").value)) {
    const groupA = sets[aIndex];
    const groupB = sets[bIndex];
    const hits = [];

    for (const routeA of groupA.routes) {
      for (const routeB of groupB.routes) {
        const point = intersection(routeA, routeB);
        if (!point) continue;
        hits.push({
          airlineA: groupA.name, airlineB: groupB.name,
          routeA: routeA.name, routeB: routeB.name,
          aDistance: distance(routeA.start, routeA.end), bDistance: distance(routeB.start, routeB.end),
          lat: point.lat, lon: point.lon, method: point.method, pairCount: 0
        });
      }
    }

    if (hits.length >= min && hits.length <= max) {
      hits.forEach((hit) => { hit.pairCount = hits.length; });
      passingGroups.push({ aIndex, bIndex, hits });
    }
  }

  lastRows = passingGroups.flatMap((group) => group.hits);
  console.log("Selected result rows:", lastRows.length);

  for (const group of passingGroups) {
    for (const route of sets[group.aIndex].routes) {
      L.polyline(greatCirclePoints(route).map((point) => [point.lat, point.lon]), { color: COLORS[group.aIndex], weight: 3 }).addTo(routeLayer);
    }
    for (const route of sets[group.bIndex].routes) {
      L.polyline(greatCirclePoints(route).map((point) => [point.lat, point.lon]), { color: COLORS[group.bIndex], weight: 3 }).addTo(routeLayer);
    }
    for (const row of group.hits) {
      L.circleMarker([row.lat, row.lon], { radius: 6, color: "#facc15", fillOpacity: 1 }).addTo(routeLayer)
        .bindPopup(`<b>${row.airlineA} × ${row.airlineB}</b><br>${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}<br>Pair count: ${row.pairCount}<br>${row.method}`);
    }
  }

  render();
}

function addColumn(text = "") {
  if (columns.children.length >= 6) return;
  const index = columns.children.length;
  const letter = String.fromCharCode(65 + index);
  const box = document.createElement("article");
  box.className = "column";
  box.style.setProperty("--color", COLORS[index]);
  box.innerHTML = `<div class="column-head"><strong>${letter}: Airline routes</strong><button type="button" class="remove">Remove</button></div><textarea placeholder="# Airline name&#10;HKG-JFK&#10;DXB-LHR"></textarea>`;
  box.querySelector("textarea").value = text;
  box.querySelector(".remove").onclick = () => { box.remove(); };
  columns.appendChild(box);
}

byId("add-column").onclick = () => addColumn();
byId("run-analysis").onclick = runAnalysis;
byId("compare-mode").onchange = (event) => {
  byId("pair-pattern-wrap").style.display = event.target.value === "selected" ? "flex" : "none";
};

addColumn("# JAL\nHND LAX\nHND JFK\nHND LHR");
addColumn("# CA\nLAX HND\nLAX JFK\nLAX LHR");
loadAirportsCSV();
