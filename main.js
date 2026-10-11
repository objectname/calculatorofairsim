"use strict";

/*
  Airline Route Intercept Analyzer

  Required HTML element IDs:
  - status-message
  - route-columns
  - results-body
  - exports
  - analysis-summary
  - map
  - add-column
  - run-analysis
  - compare-mode
  - pair-pattern-wrap
  - pair-patterns
  - min-intercepts
  - max-intercepts
  - count-shared

  Required local file:
  - airports.csv
*/

const EARTH_RADIUS_KM = 6371;

const COLUMN_COLORS = [
  "#38bdf8",
  "#f97316",
  "#a78bfa",
  "#22c55e",
  "#f43f5e",
  "#facc15"
];

const airports = new Map();

let databaseLoaded = false;
let lastRows = [];

const getById = (id) => document.getElementById(id);

const statusMessage = getById("status-message");
const routeColumns = getById("route-columns");
const resultsBody = getById("results-body");
const exportButtons = getById("exports");
const analysisSummary = getById("analysis-summary");

const map = L.map("map", {
  worldCopyJump: true
}).setView([20, 0], 2);

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/" +
    "ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Tiles © Esri"
  }
).addTo(map);

const openStreetMapLayer = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }
);

L.control
  .layers({
    Satellite: satelliteLayer,
    OpenStreetMap: openStreetMapLayer
  })
  .addTo(map);

const routeLayerGroup = L.layerGroup().addTo(map);

/* ----------------------------------------
   CSV loading
---------------------------------------- */

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"") {
      if (insideQuotes && nextCharacter === "\"") {
        value += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());

  return values;
}

function findHeaderIndex(headers, possibleNames) {
  const normalizedHeaders = headers.map((header) =>
    String(header)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  );

  for (const possibleName of possibleNames) {
    const normalizedName = String(possibleName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const index = normalizedHeaders.indexOf(normalizedName);

    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

async function loadAirportsCSV() {
  statusMessage.textContent = "Loading airports.csv…";

  try {
    const response = await fetch("./airports.csv", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const csvText = await response.text();

    const lines = csvText
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length < 2) {
      throw new Error("airports.csv contains no usable rows.");
    }

    const headers = parseCsvLine(lines[0]);

    const identIndex = findHeaderIndex(headers, [
      "ident"
    ]);

    const iataIndex = findHeaderIndex(headers, [
      "iata",
      "iata_code",
      "iata code"
    ]);

    const icaoIndex = findHeaderIndex(headers, [
      "icao",
      "icao_code",
      "icao code",
      "gps_code",
      "gps code"
    ]);

    const latitudeIndex = findHeaderIndex(headers, [
      "latitude",
      "latitude_deg",
      "latitude deg",
      "lat"
    ]);

    const longitudeIndex = findHeaderIndex(headers, [
      "longitude",
      "longitude_deg",
      "longitude deg",
      "lon",
      "lng"
    ]);

    if (latitudeIndex === -1 || longitudeIndex === -1) {
      throw new Error(
        "CSV must include latitude and longitude columns."
      );
    }

    for (let rowNumber = 1; rowNumber < lines.length; rowNumber += 1) {
      const row = parseCsvLine(lines[rowNumber]);

      const latitude = Number(row[latitudeIndex]);
      const longitude = Number(row[longitudeIndex]);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }

      const airportPoint = {
        lat: latitude,
        lon: longitude
      };

      const airportCodes = [
        identIndex >= 0
          ? String(row[identIndex] || "").trim().toUpperCase()
          : "",
        iataIndex >= 0
          ? String(row[iataIndex] || "").trim().toUpperCase()
          : "",
        icaoIndex >= 0
          ? String(row[icaoIndex] || "").trim().toUpperCase()
          : ""
      ];

      for (const code of airportCodes) {
        if (code) {
          airports.set(code, airportPoint);
        }
      }
    }

    databaseLoaded = true;

    statusMessage.textContent =
      `airports.csv loaded (${airports.size.toLocaleString()} codes)`;
  } catch (error) {
    console.error("Failed to load airports.csv:", error);

    statusMessage.textContent =
      `Could not load airports.csv: ${error.message}`;
  }
}

/* ----------------------------------------
   Geographic utilities
---------------------------------------- */

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeLongitude(longitude) {
  return ((longitude + 540) % 360) - 180;
}

function calculateDistanceKm(pointA, pointB) {
  const deltaLatitude = toRadians(pointB.lat - pointA.lat);
  const deltaLongitude = toRadians(pointB.lon - pointA.lon);

  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(pointA.lat)) *
      Math.cos(toRadians(pointB.lat)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    EARTH_RADIUS_KM *
    2 *
    Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(1 - haversine)
    )
  );
}

function pointToVector(point) {
  const latitude = toRadians(point.lat);
  const longitude = toRadians(point.lon);

  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude)
  };
}

function vectorCross(vectorA, vectorB) {
  return {
    x: vectorA.y * vectorB.z - vectorA.z * vectorB.y,
    y: vectorA.z * vectorB.x - vectorA.x * vectorB.z,
    z: vectorA.x * vectorB.y - vectorA.y * vectorB.x
  };
}

function vectorMagnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeVector(vector) {
  const length = vectorMagnitude(vector);

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function vectorToPoint(vector) {
  return {
    lat: toDegrees(
      Math.atan2(
        vector.z,
        Math.hypot(vector.x, vector.y)
      )
    ),
    lon: normalizeLongitude(
      toDegrees(Math.atan2(vector.y, vector.x))
    )
  };
}

function sameAirport(pointA, pointB) {
  return calculateDistanceKm(pointA, pointB) <= 1;
}

function routeDistanceKm(route) {
  return calculateDistanceKm(route.start, route.end);
}

/* ----------------------------------------
   Per-route-pair intersection logic
---------------------------------------- */

function sharedEndpointIntersections(routeA, routeB) {
  const endpointPairs = [
    [routeA.start, routeB.start],
    [routeA.start, routeB.end],
    [routeA.end, routeB.start],
    [routeA.end, routeB.end]
  ];

  const output = [];

  for (const [first, second] of endpointPairs) {
    if (!sameAirport(first, second)) {
      continue;
    }

    const existsAlready = output.some((point) =>
      sameAirport(point, first)
    );

    if (!existsAlready) {
      output.push({
        lat: first.lat,
        lon: first.lon,
        type: "shared-airport"
      });
    }
  }

  return output;
}

function pointIsOnRouteArc(point, route, toleranceKm = 4) {
  const routeDistance = routeDistanceKm(route);

  const startDistance = calculateDistanceKm(
    route.start,
    point
  );

  const endDistance = calculateDistanceKm(
    point,
    route.end
  );

  return Math.abs(
    startDistance + endDistance - routeDistance
  ) <= toleranceKm;
}

function routePairIntersections(
  routeA,
  routeB,
  includeSharedAirports
) {
  const sharedAirports = sharedEndpointIntersections(
    routeA,
    routeB
  );

  if (sharedAirports.length > 0) {
    return includeSharedAirports
      ? sharedAirports
      : [];
  }

  const routeAPlaneNormal = vectorCross(
    pointToVector(routeA.start),
    pointToVector(routeA.end)
  );

  const routeBPlaneNormal = vectorCross(
    pointToVector(routeB.start),
    pointToVector(routeB.end)
  );

  const crossingVector = vectorCross(
    routeAPlaneNormal,
    routeBPlaneNormal
  );

  if (vectorMagnitude(crossingVector) < 1e-12) {
    return [];
  }

  const firstCandidate = vectorToPoint(
    normalizeVector(crossingVector)
  );

  const secondCandidate = {
    lat: -firstCandidate.lat,
    lon: normalizeLongitude(firstCandidate.lon + 180)
  };

  if (
    pointIsOnRouteArc(firstCandidate, routeA) &&
    pointIsOnRouteArc(firstCandidate, routeB)
  ) {
    return [
      {
        ...firstCandidate,
        type: "great-circle-crossing"
      }
    ];
  }

  if (
    pointIsOnRouteArc(secondCandidate, routeA) &&
    pointIsOnRouteArc(secondCandidate, routeB)
  ) {
    return [
      {
        ...secondCandidate,
        type: "great-circle-crossing"
      }
    ];
  }

  return [];
}

function greatCirclePoints(route, numberOfSegments = 120) {
  const startVector = pointToVector(route.start);
  const endVector = pointToVector(route.end);

  const angle = Math.acos(
    clamp(
      startVector.x * endVector.x +
        startVector.y * endVector.y +
        startVector.z * endVector.z,
      -1,
      1
    )
  );

  if (angle < 1e-9) {
    return [route.start];
  }

  const sineOfAngle = Math.sin(angle);
  const points = [];

  for (
    let index = 0;
    index <= numberOfSegments;
    index += 1
  ) {
    const fraction = index / numberOfSegments;

    const startWeight =
      Math.sin((1 - fraction) * angle) /
      sineOfAngle;

    const endWeight =
      Math.sin(fraction * angle) /
      sineOfAngle;

    const vector = normalizeVector({
      x:
        startWeight * startVector.x +
        endWeight * endVector.x,
      y:
        startWeight * startVector.y +
        endWeight * endVector.y,
      z:
        startWeight * startVector.z +
        endWeight * endVector.z
    });

    points.push(vectorToPoint(vector));
  }

  return points;
}

/* ----------------------------------------
   Airline column parsing
---------------------------------------- */

function parseAirlineColumn(text, letter) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let airlineName = `Airline ${letter}`;

  if (lines[0] && lines[0].startsWith("#")) {
    airlineName =
      lines.shift().slice(1).trim() ||
      airlineName;
  }

  const routes = [];
  const unknownCodes = new Set();

  for (const line of lines) {
    const codes = line
      .replace(/[–—/,\t]/g, "-")
      .split("-")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);

    if (codes.length < 2) {
      continue;
    }

    const startCode = codes[0];
    const endCode = codes[1];

    const start = airports.get(startCode);
    const end = airports.get(endCode);

    if (!start || !end) {
      if (!start) {
        unknownCodes.add(startCode);
      }

      if (!end) {
        unknownCodes.add(endCode);
      }

      continue;
    }

    routes.push({
      name: `${startCode}-${endCode}`,
      startCode,
      endCode,
      start,
      end
    });
  }

  return {
    airlineName,
    routes,
    unknownCodes: [...unknownCodes]
  };
}

function getSelectedColumnPairs(
  numberOfColumns,
  compareMode,
  pairPatternText
) {
  const pairs = [];

  if (compareMode === "all") {
    for (
      let first = 0;
      first < numberOfColumns;
      first += 1
    ) {
      for (
        let second = first + 1;
        second < numberOfColumns;
        second += 1
      ) {
        pairs.push([first, second]);
      }
    }

    return pairs;
  }

  if (compareMode === "pairwise") {
    for (
      let index = 0;
      index + 1 < numberOfColumns;
      index += 2
    ) {
      pairs.push([index, index + 1]);
    }

    return pairs;
  }

  if (compareMode === "pairwise-wrap") {
    for (
      let index = 0;
      index + 1 < numberOfColumns;
      index += 2
    ) {
      pairs.push([index, index + 1]);
    }

    if (numberOfColumns > 2) {
      pairs.push([numberOfColumns - 1, 0]);
    }

    return pairs;
  }

  for (const token of pairPatternText.split(/[,\\s]+/)) {
    const match = token
      .toUpperCase()
      .match(/^([A-F])-([A-F])$/);

    if (!match) {
      continue;
    }

    const first =
      match[1].charCodeAt(0) - 65;

    const second =
      match[2].charCodeAt(0) - 65;

    if (
      first >= numberOfColumns ||
      second >= numberOfColumns ||
      first === second
    ) {
      continue;
    }

    const existsAlready = pairs.some(
      ([savedFirst, savedSecond]) =>
        savedFirst === first &&
        savedSecond === second
    );

    if (!existsAlready) {
      pairs.push([first, second]);
    }
  }

  return pairs;
}

/* ----------------------------------------
   User interface
---------------------------------------- */

function addAirlineColumn(defaultText = "") {
  if (routeColumns.children.length >= 6) {
    return;
  }

  const index = routeColumns.children.length;
  const letter = String.fromCharCode(65 + index);

  const column = document.createElement("article");

  column.className = "column";
  column.style.setProperty(
    "--color",
    COLUMN_COLORS[index]
  );

  column.innerHTML = `
    <div class="column-head">
      <strong>${letter}: Airline routes</strong>
      <button type="button" class="remove">Remove</button>
    </div>

    <textarea
      placeholder="# Airline name&#10;HND LAX&#10;HND JFK"
    ></textarea>
  `;

  column.querySelector("textarea").value = defaultText;

  column
    .querySelector(".remove")
    .addEventListener("click", () => {
      column.remove();
    });

  routeColumns.appendChild(column);
}

function renderResults() {
  if (lastRows.length === 0) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="10">
          No individual route pairs matched the selected
          columns and min/max route-pair intersection filter.
        </td>
      </tr>
    `;

    exportButtons.classList.add("hidden");

    return;
  }

  resultsBody.innerHTML = lastRows
    .map(
      (row) => `
        <tr>
          <td>${row.airlineA}</td>
          <td>${row.airlineB}</td>
          <td>${row.routeA}</td>
          <td>${row.routeB}</td>
          <td>${row.pairCount}</td>
          <td>${row.type}</td>
          <td>${row.routeADistance.toFixed(1)} km</td>
          <td>${row.routeBDistance.toFixed(1)} km</td>
          <td>${row.lat.toFixed(6)}°</td>
          <td>${row.lon.toFixed(6)}°</td>
        </tr>
      `
    )
    .join("");

  exportButtons.classList.remove("hidden");
}

function runAnalysis() {
  if (!databaseLoaded) {
    alert("airports.csv is still loading.");

    return;
  }

  const airlineColumns = [
    ...routeColumns.children
  ].map((column, index) => {
    const letter = String.fromCharCode(65 + index);

    return parseAirlineColumn(
      column.querySelector("textarea").value,
      letter
    );
  });

  let minimumIntersections = clamp(
    Number(getById("min-intercepts").value) || 0,
    0,
    2
  );

  let maximumIntersections = clamp(
    Number(getById("max-intercepts").value) || 2,
    0,
    2
  );

  if (minimumIntersections > maximumIntersections) {
    [
      minimumIntersections,
      maximumIntersections
    ] = [
      maximumIntersections,
      minimumIntersections
    ];
  }

  const includeSharedAirports =
    getById("count-shared").checked;

  const columnPairs = getSelectedColumnPairs(
    airlineColumns.length,
    getById("compare-mode").value,
    getById("pair-patterns").value
  );

  routeLayerGroup.clearLayers();

  lastRows = [];

  let evaluatedRoutePairs = 0;
  let rawIntersections = 0;

  for (const [columnAIndex, columnBIndex] of columnPairs) {
    const airlineA =
      airlineColumns[columnAIndex];

    const airlineB =
      airlineColumns[columnBIndex];

    for (const routeA of airlineA.routes) {
      for (const routeB of airlineB.routes) {
        evaluatedRoutePairs += 1;

        const intersections =
          routePairIntersections(
            routeA,
            routeB,
            includeSharedAirports
          );

        rawIntersections += intersections.length;

        const pairCount = intersections.length;

        /*
          This is the important corrected logic:
          min/max is checked per individual route line pair.
        */
        if (
          pairCount < minimumIntersections ||
          pairCount > maximumIntersections
        ) {
          continue;
        }

        for (const intersection of intersections) {
          lastRows.push({
            airlineA: airlineA.airlineName,
            airlineB: airlineB.airlineName,
            routeA: routeA.name,
            routeB: routeB.name,
            pairCount,
            type: intersection.type,
            routeADistance: routeDistanceKm(routeA),
            routeBDistance: routeDistanceKm(routeB),
            lat: intersection.lat,
            lon: intersection.lon,
            columnAIndex,
            columnBIndex
          });
        }
      }
    }
  }

  const alreadyDrawnRoutes = new Set();

  for (const row of lastRows) {
    const marker = L.circleMarker(
      [row.lat, row.lon],
      {
        radius: 6,
        color: "#facc15",
        weight: 2,
        fillOpacity: 1
      }
    );

    marker
      .addTo(routeLayerGroup)
      .bindPopup(`
        <b>${row.airlineA} × ${row.airlineB}</b><br>
        ${row.routeA} × ${row.routeB}<br>
        ${row.type}<br>
        Route-pair count: ${row.pairCount}<br>
        ${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}
      `);

    const routesToDraw = [
      {
        columnIndex: row.columnAIndex,
        routeName: row.routeA,
        airlineName: row.airlineA
      },
      {
        columnIndex: row.columnBIndex,
        routeName: row.routeB,
        airlineName: row.airlineB
      }
    ];

    for (const item of routesToDraw) {
      const uniqueKey =
        `${item.columnIndex}:${item.routeName}`;

      if (alreadyDrawnRoutes.has(uniqueKey)) {
        continue;
      }

      const route = airlineColumns[
        item.columnIndex
      ].routes.find(
        (candidate) =>
          candidate.name === item.routeName
      );

      if (!route) {
        continue;
      }

      L.polyline(
        greatCirclePoints(route).map((point) => [
          point.lat,
          point.lon
        ]),
        {
          color: COLUMN_COLORS[item.columnIndex],
          weight: 3,
          opacity: 0.9
        }
      )
        .addTo(routeLayerGroup)
        .bindPopup(
          `${item.airlineName}: ${item.routeName}`
        );

      alreadyDrawnRoutes.add(uniqueKey);
    }
  }

  const parseSummary = airlineColumns
    .map((airline) => {
      const unknownText = airline.unknownCodes.length
        ? `; unknown: ${airline.unknownCodes.join(", ")}`
        : "";

      return (
        `${airline.airlineName}: ` +
        `${airline.routes.length} valid routes` +
        unknownText
      );
    })
    .join(" | ");

  analysisSummary.textContent =
    `${parseSummary}. ` +
    `Compared ${evaluatedRoutePairs.toLocaleString()} ` +
    `individual route pairs. ` +
    `Found ${rawIntersections.toLocaleString()} raw intersections. ` +
    `Displayed ${lastRows.length.toLocaleString()} result rows ` +
    `after per-route-pair filter ` +
    `${minimumIntersections}–${maximumIntersections}.`;

  renderResults();
}

/* ----------------------------------------
   Export
---------------------------------------- */

function buildExportRows() {
  return lastRows.map(
    ({
      columnAIndex,
      columnBIndex,
      ...row
    }) => ({
      "Airline A": row.airlineA,
      "Airline B": row.airlineB,
      "Route A": row.routeA,
      "Route B": row.routeB,
      "Route-pair intersections": row.pairCount,
      "Intersection type": row.type,
      "Route A distance km":
        Number(row.routeADistance.toFixed(1)),
      "Route B distance km":
        Number(row.routeBDistance.toFixed(1)),
      Latitude: Number(row.lat.toFixed(6)),
      Longitude: Number(row.lon.toFixed(6))
    })
  );
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], {
    type
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 500);
}

function downloadTxt() {
  const rows = buildExportRows();

  const output = rows
    .map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
    )
    .join("\n\n");

  downloadFile(
    "result.txt",
    output,
    "text/plain;charset=utf-8"
  );
}

function downloadCsv() {
  const rows = buildExportRows();

  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);

  const quote = (value) =>
    `"${String(value).replaceAll("\"", "\"\"")}"`;

  const output = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => quote(row[header]))
        .join(",")
    )
  ].join("\n");

  downloadFile(
    "result.csv",
    output,
    "text/csv;charset=utf-8"
  );
}

function downloadXlsx() {
  if (
    !window.XLSX ||
    lastRows.length === 0
  ) {
    return;
  }

  const rows = buildExportRows();

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Intercepts"
  );

  XLSX.writeFile(workbook, "result.xlsx");
}

/* ----------------------------------------
   Event wiring
---------------------------------------- */

getById("add-column").addEventListener(
  "click",
  () => addAirlineColumn()
);

getById("run-analysis").addEventListener(
  "click",
  runAnalysis
);

getById("compare-mode").addEventListener(
  "change",
  (event) => {
    getById("pair-pattern-wrap").style.display =
      event.target.value === "selected"
        ? "flex"
        : "none";
  }
);

exportButtons.addEventListener("click", (event) => {
  const exportType = event.target.dataset.export;

  if (!exportType || lastRows.length === 0) {
    return;
  }

  if (exportType === "txt") {
    downloadTxt();
  }

  if (exportType === "csv") {
    downloadCsv();
  }

  if (exportType === "xlsx") {
    downloadXlsx();
  }
});

/* ----------------------------------------
   Starter test data
---------------------------------------- */

addAirlineColumn(
  [
    "# JAL",
    "HND LAX",
    "HND JFK",
    "HND LHR"
  ].join("\n")
);

addAirlineColumn(
  [
    "# CA",
    "LAX HND",
    "LAX JFK",
    "LAX LHR"
  ].join("\n")
);

loadAirportsCSV();
