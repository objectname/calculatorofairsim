// ==========================================
// Calculator of AirSim - main.js
// Loads airports.csv, parses the database, and compares route intersections across multiple airline columns.
// ==========================================

const EARTH_RADIUS_KM = 6371;
let AIRPORTS = {};
let databaseLoaded = false;
let lastResults = [];

function setStatus(msg) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = msg;
}

async function loadAirportsCSV() {
    setStatus('Loading airports.csv...');
    try {
        const resp = await fetch('./airports.csv');
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const csvText = await resp.text();

        const workbook = XLSX.read(csvText, { type: 'string' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;

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

loadAirportsCSV();

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

function normalizeVector(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossProduct(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPointOnSegment(p, start, end, toleranceKm = 2.5) {
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
    if (len < 1e-12) return null;

    const norm = normalizeVector(inter);
    const p1 = vectorToLatLon(norm);
    const p2 = { lat: -p1.lat, lon: p1.lon > 0 ? p1.lon - 180 : p1.lon + 180 };

    const candidates = [p1, p2];
    for (const candidate of candidates) {
        if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) continue;
        const withinA = isPointOnSegment(candidate, r1.start, r1.end, 2.5);
        const withinB = isPointOnSegment(candidate, r2.start, r2.end, 2.5);
        if (withinA && withinB) return candidate;
    }
    return null;
}

function parseRouteLine(line) {
    if (!line) return null;
    const cleaned = String(line).trim();
    if (!cleaned) return null;

    const parts = cleaned.replace(/[-–\/]/g, ' ').replace(/,/g, ' ').split(/\s+/);
    if (parts.length < 2) return null;

    const c1 = parts[0].toUpperCase();
    const c2 = parts[1].toUpperCase();
    const a1 = AIRPORTS[c1];
    const a2 = AIRPORTS[c2];
    if (!a1 || !a2) return null;

    const distance = haversineDistance(a1.lat, a1.lon, a2.lat, a2.lon);
    return { name: `${c1}-${c2}`, start: a1, end: a2, distanceKm: distance };
}

function parseTextRoutes(text) {
    const out = [];
    const lines = String(text).split(/\r?\n/);
    for (const ln of lines) {
        const r = parseRouteLine(ln);
        if (r) out.push(r);
    }
    return out;
}

function getColumnData() {
    return Array.from(document.querySelectorAll('.route-column')).map((column, index) => ({
        index,
        name: column.querySelector('.column-name').value.trim() || `Airline ${index + 1}`,
        text: column.querySelector('.route-text').value || ''
    }));
}

function decimalToCSV(value) {
    return Number.isFinite(value) ? value.toFixed(6) : '';
}

function buildDownloadRows(results) {
    return [
        ['Route A', 'Airline A', 'Distance A (km)', 'Route B', 'Airline B', 'Distance B (km)', 'Intercept Lat', 'Intercept Lon'],
        ...results.map(r => [
            r.a,
            r.airlineA || '',
            decimalToCSV(r.distanceA),
            r.b,
            r.airlineB || '',
            decimalToCSV(r.distanceB),
            decimalToCSV(r.lat),
            decimalToCSV(r.lon)
        ])
    ];
}

function downloadCSV() {
    if (!lastResults.length) {
        alert('There are no results to download yet. Run the analysis first.');
        return;
    }

    const rows = buildDownloadRows(lastResults);
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'airline_intercepts.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function updateCompareSelectors() {
    const columns = getColumnData();
    const selectA = document.getElementById('compare-a');
    const selectB = document.getElementById('compare-b');

    const prevA = selectA.value;
    const prevB = selectB.value;
    selectA.innerHTML = '';
    selectB.innerHTML = '';

    columns.forEach((c, idx) => {
        const optionA = document.createElement('option');
        optionA.value = String(idx);
        optionA.textContent = c.name;
        const optionB = document.createElement('option');
        optionB.value = String(idx);
        optionB.textContent = c.name;
        selectA.appendChild(optionA.cloneNode(true));
        selectB.appendChild(optionB.cloneNode(true));
    });

    if (columns.length >= 2) {
        const defaultA = prevA && columns[Number(prevA)] ? Number(prevA) : 0;
        const defaultB = prevB && columns[Number(prevB)] ? Number(prevB) : 1;
        selectA.value = String(defaultA);
        selectB.value = String(defaultB === defaultA ? Math.min(defaultA + 1, columns.length - 1) : defaultB);
    }
}

function addColumnCard(label = `Airline ${document.querySelectorAll('.route-column').length + 1}`) {
    const container = document.getElementById('columns-container');
    const column = document.createElement('div');
    column.className = 'route-column';
    column.innerHTML = `
        <div class="header">
            <span style="font-weight:bold; color:white;">Column</span>
            <input type="text" class="column-name" value="${label}" aria-label="Airline name" />
        </div>
        <textarea class="route-text" placeholder="HKG-JFK\nVHHH-KJFK\nLHR-DXB"></textarea>
    `;
    container.appendChild(column);
    updateCompareSelectors();
}

function removeLastColumn() {
    const columns = document.querySelectorAll('.route-column');
    if (columns.length <= 2) {
        alert('At least two airline columns are required to compare routes.');
        return;
    }
    columns[columns.length - 1].remove();
    updateCompareSelectors();
}

function buildColumnRoutes(columnData) {
    return parseTextRoutes(columnData.text);
}

function totalDistanceForRoutes(routes) {
    return routes.reduce((sum, route) => sum + (route.distanceKm || 0), 0);
}

function evaluateComparison(columnA, columnB) {
    const routesA = buildColumnRoutes(columnA);
    const routesB = buildColumnRoutes(columnB);
    if (!routesA.length || !routesB.length) {
        return {
            records: [],
            distanceA: totalDistanceForRoutes(routesA),
            distanceB: totalDistanceForRoutes(routesB)
        };
    }

    const records = [];

    routesA.forEach(ra => {
        routesB.forEach(rb => {
            const hit = findGreatCircleSegmentIntersection(ra, rb);
            if (!hit) return;
            records.push({
                a: ra.name,
                b: rb.name,
                airlineA: columnA.name,
                airlineB: columnB.name,
                distanceA: totalDistanceForRoutes(routesA),
                distanceB: totalDistanceForRoutes(routesB),
                lat: hit.lat,
                lon: hit.lon
            });
        });
    });

    return {
        records,
        distanceA: totalDistanceForRoutes(routesA),
        distanceB: totalDistanceForRoutes(routesB)
    };
}

function renderResults(results) {
    const tbody = document.getElementById('results-body');
    if (!tbody) return;

    if (!results.length) {
        tbody.innerHTML = '<tr><td colspan="8">No valid intercepts found.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    for (const r of results) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${r.a}</b></td>
            <td>${r.airlineA}</td>
            <td>${r.distanceA.toFixed(1)} km</td>
            <td><b>${r.b}</b></td>
            <td>${r.airlineB}</td>
            <td>${r.distanceB.toFixed(1)} km</td>
            <td>${r.lat.toFixed(6)}°</td>
            <td>${r.lon.toFixed(6)}°</td>
        `;
        tbody.appendChild(tr);
    }
}

function processSelectedColumns() {
    if (!databaseLoaded) {
        alert('Airport database is still loading. Please wait a moment and try again.');
        return;
    }

    const columns = getColumnData();
    if (columns.length < 2) {
        alert('Please add at least two airline columns.');
        return;
    }

    const selA = Number(document.getElementById('compare-a').value);
    const selB = Number(document.getElementById('compare-b').value);
    if (Number.isNaN(selA) || Number.isNaN(selB) || selA === selB) {
        alert('Please choose two different airline columns to compare.');
        return;
    }

    const columnA = columns[selA];
    const columnB = columns[selB];
    if (!columnA.text.trim() || !columnB.text.trim()) {
        alert('Both selected columns need route data before comparing.');
        return;
    }

    routeLayerGroup.clearLayers();
    setStatus(`Comparing ${columnA.name} and ${columnB.name}...`);

    const routesA = buildColumnRoutes(columnA);
    const routesB = buildColumnRoutes(columnB);

    routesA.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'cyan', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`A: ${columnA.name}<br>${r.name}`);
    });

    routesB.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'magenta', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`B: ${columnB.name}<br>${r.name}`);
    });

    const comparison = evaluateComparison(columnA, columnB);
    const records = comparison.records;

    records.forEach((entry) => {
        L.circleMarker([entry.lat, entry.lon], { radius: 6, color: 'yellow', fillOpacity: 1 })
            .addTo(routeLayerGroup)
            .bindPopup(`<b>Intercept</b><br>A: ${entry.airlineA} - ${entry.a}<br>B: ${entry.airlineB} - ${entry.b}<br>Lat: ${entry.lat.toFixed(4)}<br>Lon: ${entry.lon.toFixed(4)}`);
    });

    lastResults = records;
    renderResults(records);
    setStatus(`Compared ${columnA.name} and ${columnB.name} — ${records.length} intercept(s) found`);
}

window.processTextAreas = processSelectedColumns;
document.getElementById('plot-button').addEventListener('click', processSelectedColumns);
document.getElementById('download-button').addEventListener('click', downloadCSV);
document.getElementById('add-column').addEventListener('click', () => {
    const nextNumber = document.querySelectorAll('.route-column').length + 1;
    addColumnCard(`Airline ${nextNumber}`);
});
document.getElementById('remove-column').addEventListener('click', removeLastColumn);
document.getElementById('compare-a').addEventListener('change', () => {
    const a = Number(document.getElementById('compare-a').value);
    const b = Number(document.getElementById('compare-b').value);
    if (a === b) {
        const next = (b + 1) % document.querySelectorAll('.route-column').length;
        document.getElementById('compare-b').value = String(next);
    }
});
document.getElementById('compare-b').addEventListener('change', () => {
    const a = Number(document.getElementById('compare-a').value);
    const b = Number(document.getElementById('compare-b').value);
    if (a === b) {
        const next = (a + 1) % document.querySelectorAll('.route-column').length;
        document.getElementById('compare-a').value = String(next);
    }
});

function initializeDefaults() {
    addColumnCard('Airline 1');
    addColumnCard('Airline 2');
    const columnData = document.querySelectorAll('.route-column');
    const firstText = columnData[0].querySelector('.route-text');
    const secondText = columnData[1].querySelector('.route-text');
    firstText.value = 'HKG-JFK\nVHHH-KJFK\nLHR-DXB';
    secondText.value = 'SIN-NRT\nDXB-OMDB\nJFK-KJFK';
    updateCompareSelectors();
}

initializeDefaults();
