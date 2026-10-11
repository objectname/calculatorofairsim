// ==========================================
// 1. CONFIGURATION & AIRPORT DATABASE
// ==========================================
const FIXED_SPEED_KMH = 9360 / 22; // ~425.45 km/h
const EARTH_RADIUS_KM = 6371;

// Sample database (expand with full global ICAO/IATA data as needed)
const AIRPORTS = {
    "HKG": { name: "Hong Kong", lat: 22.3080, lon: 113.9185 },
    "VHHH": { name: "Hong Kong", lat: 22.3080, lon: 113.9185 },
    "JFK": { name: "New York JFK", lat: 40.6413, lon: -73.7781 },
    "KJFK": { name: "New York JFK", lat: 40.6413, lon: -73.7781 },
    "LHR": { name: "London Heathrow", lat: 51.4700, lon: -0.4543 },
    "EGLL": { name: "London Heathrow", lat: 51.4700, lon: -0.4543 },
    "SIN": { name: "Singapore Changi", lat: 1.3644, lon: 103.9915 },
    "WSSS": { name: "Singapore Changi", lat: 1.3644, lon: 103.9915 },
    "DXB": { name: "Dubai", lat: 25.2532, lon: 55.3657 },
    "OMDB": { name: "Dubai", lat: 25.2532, lon: 55.3657 },
    "TYO": { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
    "NRT": { name: "Tokyo Narita", lat: 35.7720, lon: 140.3929 }
};

// ==========================================
// 2. INITIALIZE MAP
// ==========================================
const map = L.map('map').setView([20, 0], 2);

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
}).addTo(map);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
});

L.control.layers({ "Satellite": satelliteLayer, "OpenStreetMap": osmLayer }).addTo(map);
let routeLayerGroup = L.layerGroup().addTo(map);

// ==========================================
// 3. MATH & GEOMETRY UTILITIES
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

function calculateGDC(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2)**2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function crossProduct(v1, v2) {
    return { x: v1.y * v2.z - v1.z * v2.y, y: v1.z * v2.x - v1.x * v2.z, z: v1.x * v2.y - v1.y * v2.x };
}

// Check if intercept point lies strictly on the route segment between start and end
function isPointOnSegment(p, start, end) {
    const totalDist = calculateGDC(start.lat, start.lon, end.lat, end.lon);
    const dist1 = calculateGDC(start.lat, start.lon, p.lat, p.lon);
    const dist2 = calculateGDC(p.lat, p.lon, end.lat, end.lon);
    // Allow a tiny tolerance for floating-point calculation errors (~1.0 km)
    return Math.abs((dist1 + dist2) - totalDist) < 1.0;
}

function findGreatCircleSegmentIntersection(r1, r2) {
    const v1 = latLonToVector(r1.start.lat, r1.start.lon);
    const v2 = latLonToVector(r1.end.lat, r1.end.lon);
    const v3 = latLonToVector(r2.start.lat, r2.start.lon);
    const v4 = latLonToVector(r2.end.lat, r2.end.lon);

    const n1 = crossProduct(v1, v2);
    const n2 = crossProduct(v3, v4);
    const intersectionVector = crossProduct(n1, n2);
    const length = Math.sqrt(intersectionVector.x ** 2 + intersectionVector.y ** 2 + intersectionVector.z ** 2);

    if (length === 0) return null;

    const normVector = { x: intersectionVector.x / length, y: intersectionVector.y / length, z: intersectionVector.z / length };
    const p1 = vectorToLatLon(normVector);
    // Antipodal check point
    const p2 = { lat: -p1.lat, lon: p1.lon > 0 ? p1.lon - 180 : p1.lon + 180 };

    let validPoint = null;
    if (isPointOnSegment(p1, r1.start, r1.end) && isPointOnSegment(p1, r2.start, r2.end)) {
        validPoint = p1;
    } else if (isPointOnSegment(p2, r1.start, r1.end) && isPointOnSegment(p2, r2.start, r2.end)) {
        validPoint = p2;
    }
    return validPoint;
}

// ==========================================
// 4. FILE PARSING LOGIC (CSV, XLSX, TXT)
// ==========================================
async function parseFile(file) {
    return नई Promise((resolve) => {
        const reader = new FileReader();
        const extension = file.name.split('.').pop().toLowerCase();

        if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.SheetNames[0];
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 });
                resolve(extractRoutesFromRows(rows));
            };
            reader.readAsArrayBuffer(file);
        } else {
            // Plain text parsing (.txt)
            reader.onload = (e) => {
                const text = e.target.result;
                const rows = text.split('\n').map(line => line.trim().split(/[\s,]+/));
                resolve(extractRoutesFromRows(rows));
            };
            reader.readAsText(file);
        }
    });
}

function extractRoutesFromRows(rows) {
    const routes = [];
    rows.forEach(row => {
        let code1 = "", code2 = "";
        if (row.length >= 2 && row[0] && row[1]) {
            code1 = row[0].trim();
            code2 = row[1].trim();
        } else if (row.length === 1 && row[0]) {
            // Handle formats like "HKG-JFK" or "VHHH-KJFK"
            const parts = row[0].split(/[-–/]/);
            if (parts.length >= 2) {
                code1 = parts[0].trim();
                code2 = parts[1].trim();
            }
        }

        if (code1 && code2) {
            const apt1 = AIRPORTS[code1.toUpperCase()];
            const apt2 = AIRPORTS[code2.toUpperCase()];
            if (apt1 && apt2) {
                routes.push({
                    name: `${code1.toUpperCase()}-${code2.toUpperCase()}`,
                    start: apt1,
                    end: apt2
                });
            }
        }
    });
    return routes;
}

// ==========================================
// 5. MAIN EXECUTION & INTERCEPT MATRICES
// ==========================================
async function processUploadedFiles() {
    const file1Input = document.getElementById('file1').files[0];
    const file2Input = document.getElementById('file2').files[0];

    if (!file1Input || !file2Input) {
        alert("Please upload both files to compare and find intercepts.");
        return;
    }

    routeLayerGroup.clearLayers();
    const resultsTableBody = document.getElementById('results-body');
    resultsTableBody.innerHTML = `<tr><td colspan="4">Processing files...</td></tr>`;

    const routesA = await parseFile(file1Input);
    const routesB = await parseFile(file2Input);

    let interceptRecords = [];

    // Plot Routes from File 1 (Cyan Color)
    routesA.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'cyan', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`File 1 Route: ${r.name}`);
    });

    // Plot Routes from File 2 (Magenta Color)
    routesB.forEach(r => {
        L.polyline([[r.start.lat, r.start.lon], [r.end.lat, r.end.lon]], { color: 'magenta', weight: 3, opacity: 0.8 })
            .addTo(routeLayerGroup)
            .bindPopup(`File 2 Route: ${r.name}`);
    });

    // Cross-check Intercepts between File 1 and File 2 routes
    routesA.forEach(ra => {
        routesB.forEach(rb => {
            const intersection = findGreatCircleSegmentIntersection(ra, rb);
            if (intersection) {
                interceptRecords.push({
                    routeNameA: ra.name,
                    routeNameB: rb.name,
                    lat: intersection.lat,
                    lon: intersection.lon
                });

                // Plot Intercept Marker on Map
                L.circleMarker([intersection.lat, intersection.lon], { color: 'yellow', radius: 6, fillOpacity: 1 })
                    .addTo(routeLayerGroup)
                    .bindPopup(`<b>Intercept Found!</b><br>A: ${ra.name}<br>B: ${rb.name}<br>Lat: ${intersection.lat.toFixed(2)}°, Lon: ${intersection.lon.toFixed(2)}°`);
            }
        });
    });

    // Populate Results Table with A name / B name columns
    if (interceptRecords.length > 0) {
        resultsTableBody.innerHTML = "";
        interceptRecords.forEach(rec => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><b>${rec.routeNameA}</b></td><td><b>${rec.routeNameB}</b></td><td>${rec.lat.toFixed(4)}°</td><td>${rec.lon.toFixed(4)}°</td>`;
            resultsTableBody.appendChild(tr);
        });
    } else {
        resultsTableBody.innerHTML = `<tr><td colspan="4">No valid segment intercepts found between the two files.</td></tr>`;
    }
}
