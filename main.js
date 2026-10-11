// ==========================================
// Calculator of AirSim - main.js
// Loads airports.csv from repo root, parses it, and runs route intersection logic.
// ==========================================

const EARTH_RADIUS_KM = 6371;
let AIRPORTS = {}; // maps code -> { lat, lon }
let databaseLoaded = false;

// Update status text in the UI (if present)
function setStatus(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
}

// Load and parse airports.csv from repository root
async function loadAirportsCSV() {
    setStatus('Loading airports.csv...');
    try {
        const resp = await fetch('./airports.csv');
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const csvText = await resp.text();

        // Parse CSV using SheetJS (XLSX) which is included on the page
        // This handles quoted fields and commas
        const workbook = XLSX.read(csvText, { type: 'string' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // OurAirports columns (0-based after sheet_to_json with header:1):
        // 1: ident
        // 4: latitude_deg
        // 5: longitude_deg
        // 12: icao_code
        // 13: iata_code

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            // Protect against short rows
            const ident = row[1] ? String(row[1]).trim().toUpperCase() : '';
            const latRaw = row[4];
            const lonRaw = row[5];
            const icao = row[12] ? String(row[12]).trim().toUpperCase() : '';
            const iata = row[13] ? String(row[13]).trim().toUpperCase() : '';

            const lat = Number(latRaw);
            const lon = Number(lonRaw);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                const entry = { lat, lon };
                if (ident) AIRPORTS[ident] = entry;
                if (icao) AIRPORTS[icao] = entry;
                if (iata) AIRPORTS[iata] = entry;
            }
        }

        databaseLoaded = true;
        setStatus(`airports.csv loaded (${Object.keys(AIRPORTS).length} codes)`);
        console.log('airports.csv loaded, entries:', Object.keys(AIRPORTS).length);
    } catch (err) {
        console.error('Failed to load/parse airports.csv:', err);
        setStatus('Failed to load airports.csv — check console for details');
    }
}

// Run loader immediately
loadAirportsCSV();

// ==========================================
// Map initialization
// ==========================================
const map = L.map('map').setView([20, 0], 2);

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri'
}).addTo(map);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
});

L.control.layers({ 'Satellite': satelliteLayer, 'OpenStreetMap': osmLayer }).addTo(map);
let routeLayerGroup = L.layerGroup().addTo(map);

// ==========================================
// Geometry helpers
// ==========================================
function toRad(deg) { return deg * (Math.PI / 180); }
function toDeg(rad) { return rad * (180 / Math.PI); }

function latLonToVector(lat, lon) {
    const phi = toRad(lat), lambda = toRad(lon);
    return { x: Math.cos(phi) * Math.cos(lambda), y: Math.cos(phi) * Math.sin(lambda), z: Math.sin(phi) };
}

function vectorToLatLon(v) {
    const hyp = Math.sqrt(v.x * v.x + v.y * v.y);
    return { lat: toDeg(Math.atan2(v.z, hyp)), lon: toDeg(Math.atan2(v.y, v.x)) };
}

function crossProduct(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPointOnSegment(p, start, end, toleranceKm = 1.5) {
    const total = haversineDistance(start.lat, start.lon, end.lat, end.lon);
    const d1 = haversineDistance(start.lat, start.lon, p.lat, p.lon);
    const d2 = haversineDistance(p.lat, p.lon, end.lat, end.lon);
    return Math.abs((d1 + d2) - total) <= toleranceKm;
}

function findGreatCircleSegmentIntersection(r1, r2) {
    const v1 = latLonToVector(r1.start.lat, r1.start.lon);
    const v2 = latLonToVector(r1.end.lat, r1.end.lon);
    const v3 = latLonToVector(r2.start.lat, r2.start.lon);
    const v4 = latLonToVector(r2.end.lat, r2.end.lon);

    const n1 = crossProduct(v1, v2);
    const n2 = crossProduct(v3, v4);
    const inter = crossProduct(n1, n2);
    const len = Math.sqrt(inter.x ** 2 + inter.y ** 2 + inter.z ** 2);
    if (len === 0) return null;

    const norm = { x: inter.x / len, y: inter.y / len, z: inter.z / len };
    const p1 = vectorToLatLon(norm);
    const p2 = { lat: -p1.lat, lon: p1.lon > 0 ? p1.lon - 180 : p1.lon + 180 };

    if (isPointOnSegment(p1, r1.start, r1.end) && isPointOnSegment(p1, r2.start, r2.end)) return p1;
    if (isPointOnSegment(p2, r1.start, r1.end) && isPointOnSegment(p2, r2.start, r2.end)) return p2;
    return null;
}

// ==========================================
// Parsing text inputs
// ==========================================
function parseRouteLine(line) {
    if (!line) return null;
    const cleaned = String(line).trim();
    if (!cleaned) return null;

    // Accept CODE1-CODE2 or CODE1/CODE2 or "CODE1 CODE2" or comma-separated
    const parts = cleaned.replace(/[-–\/]/g, ' ').replace(/,/g, ' ').split(/\s+/);
    if (parts.length < 2) return null;
    const c1 = parts[0].toUpperCase();
    const c2 = parts[1].toUpperCase();

    const a1 = AIRPORTS[c1];
    const a2 = AIRPORTS[c2];
    if (!a1 || !a2) return null;
    return { name: `${c1}-${c2}`, start: a1, end: a2 };
}

function parseTextRoutes(text) {
    const out = [];
    const lines = String(text).split('\n');
    for (const ln of lines) {
        const r = parseRouteLine(ln);
        if (r) out.push(r);
    }
    return out;
}

// ==========================================
// Main UI workflow
// ==========================================
function processTextAreas() {
    if (!databaseLoaded) {
        alert('Airport database is still loading. Please wait a moment and try again.');
        return;
    }

    const t1 = document.getElementById('text1').value;
    const t2 = document.getElementById('text2').value;
    if (!t1 || !t2 || !t1.trim() || !t2.trim()) {
        alert('Please enter routes in both text boxes (one route per line, format CODE1-CODE2).');
        return;
    }

    routeLayerGroup.clearLayers();
    const resultsBody = document.getElementById('results-body');
    if (resultsBody) resultsBody.innerHTML = `<tr><td colspan="4">Processing...</td></tr>`;

    const routesA = parseTextRoutes(t1);
    const routesB = parseTextRoutes(t2);
    const records = [];

    // Plot A routes (cyan)
    routesA.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'cyan', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`A: ${r.name}`);
    });

    // Plot B routes (magenta)
    routesB.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'magenta', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`B: ${r.name}`);
    });

    // Cross-check
    routesA.forEach(ra => {
        routesB.forEach(rb => {
            const hit = findGreatCircleSegmentIntersection(ra, rb);
            if (hit) {
                records.push({ a: ra.name, b: rb.name, lat: hit.lat, lon: hit.lon });
                L.circleMarker([hit.lat, hit.lon], { radius: 6, color: 'yellow', fillOpacity: 1 })
                    .addTo(routeLayerGroup)
                    .bindPopup(`<b>Intercept</b><br>A: ${ra.name}<br>B: ${rb.name}<br>Lat: ${hit.lat.toFixed(4)}<br>Lon: ${hit.lon.toFixed(4)}`);
            }
        });
    });

    // Populate results
    if (!resultsBody) return;
    if (records.length === 0) {
        resultsBody.innerHTML = `<tr><td colspan="4">No valid intercepts found.</td></tr>`;
        return;
    }
    resultsBody.innerHTML = '';
    for (const r of records) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><b>${r.a}</b></td><td><b>${r.b}</b></td><td>${r.lat.toFixed(6)}°</td><td>${r.lon.toFixed(6)}°</td>`;
        resultsBody.appendChild(tr);
    }
}

// Expose function for button
window.processTextAreas = processTextAreas;
