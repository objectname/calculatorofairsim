"use strict";

const COLORS = [
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

const byId = (id) => document.getElementById(id);

const status = byId("status-message");
const columns = byId("route-columns");
const resultsBody = byId("results-body");
const exportButtons = byId("exports");

const map = L.map("map", {
  worldCopyJump: true
}).setView([20, 0], 2);

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Tiles © Esri"
  }
).addTo(map);

const openStreetMap = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }
);

L.control.layers({
  Satellite: satelliteLayer,
  OpenStreetMap: openStreetMap
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === "\"") {
      if (quoted && next === "\"") {
        value += "\"";
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

function normalizedHeader(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(headers, acceptedNames) {
  return headers.findIndex((header) =>
    acceptedNames.includes(header)
  );
}

async function loadAirportsCSV() {
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
      .filter((line) => line.trim());

    if (lines.length < 2) {
      throw new Error("airports.csv has no data rows");
    }

    const headers = parseCsvLine(lines[0]).map(normalizedHeader);

    const latitudeIndex = findHeaderIndex(headers, [
      "latitude",
      "latitudedeg",
      "latitudedegrees",
      "lat"
    ]);

    const longitudeIndex = findHeaderIndex(headers, [
      "longitude",
      "longitudedeg",
      "longitudedegrees",
      "lon",
      "lng"
    ]);

    const codeIndexes = headers
      .map((header, index) => ({
        header,
        index
      }))
      .filter(({ header }) =>
        [
          "ident",
          "iata",
          "iatacode",
          "icao",
          "icaocode",
          "gpscode",
          "localcode"
        ].includes(header)
      )
      .map(({ index }) => index);

    if (latitudeIndex < 0 || longitudeIndex < 0) {
      throw new Error(
        `Could not find latitude/longitude fields. CSV headers: ${headers.join(", ")}`
      );
    }

    if (!codeIndexes.length) {
      throw new Error(
        `Could not find airport code fields. CSV headers: ${headers.join(", ")}`
      );
    }

    airports.clear();

    for (const line of lines.slice(1)) {
      const row = parseCsvLine(line);

      const lat = Number(row[latitudeIndex]);
      const lon = Number(row[longitudeIndex]);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }

      const point = { lat, lon };

      for (const codeIndex of codeIndexes) {
        const code = String(row[codeIndex] || "")
          .trim()
          .toUpperCase();

        if (
          !code ||
          code === "\\N" ||
          code === "NULL" ||
          code === "N/A"
        ) {
          continue;
        }

        airports.set(code, point);
      }
    }

    databaseLoaded = true;

    const testCodes = ["HND", "LAX", "JFK", "LHR"];

    const missingCodes = testCodes.filter(
      (code) => !airports.has(code)
    );

    if (missingCodes.length) {
      status.textContent =
        `airports.csv loaded (${airports.size.toLocaleString()} codes), ` +
        `but airport lookup is missing: ${missingCodes.join(", ")}.`;

      console.warn("Airport lookup failures:", missingCodes);
      console.log("Detected CSV headers:", headers);
    } else {
      status.textContent =
        `airports.csv loaded (${airports.size.toLocaleString()} codes). ` +
        `HND, LAX, JFK, and LHR verified.`;
    }
  } catch (error) {
    console.error(error);

    status.textContent =
      `Could not load airports.csv: ${error.message}`;
  }
}

function parseColumn(text, letter) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let name = `Airline ${letter}`;

  if (lines[0] && lines[0].startsWith("#")) {
    name = lines.shift().slice(1).trim() || name;
  }

  const routes = [];
  const unknownCodes = new Set();

  for (const line of lines) {
    const codes = line
      .toUpperCase()
      .trim()
      .split(/[\s,;:/\\|_\-–—]+/)
      .map((code) => code.trim())
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
    name,
    routes,
    unknownCodes: [...unknownCodes]
  };
}

function selectedPairs(count, mode, patterns) {
  const pairs = [];

  if (mode === "all") {
    for (let first = 0; first < count; first += 1) {
      for (let second = first + 1; second < count; second += 1) {
        pairs.push([first, second]);
      }
    }

    return pairs;
  }

  if (mode === "pairwise" || mode === "pairwise-wrap") {
    for (let index = 0; index + 1 < count; index += 2) {
      pairs.push([index, index + 1]);
    }

    if (mode === "pairwise-wrap" && count > 2) {
      pairs.push([count - 1, 0]);
    }

    return pairs;
  }

  for (const token of String(patterns).split(/[,;\s]+/)) {
    const match = token
      .toUpperCase()
      .match(/^([A-F])-([A-F])$/);

    if (!match) {
      continue;
    }

    const first = match[1].charCodeAt(0) - 65;
    const second = match[2].charCodeAt(0) - 65;

    if (
      first < 0 ||
      second < 0 ||
      first >= count ||
      second >= count ||
      first === second
    ) {
      continue;
    }

    const duplicate = pairs.some(
      ([existingFirst, existingSecond]) =>
        (existingFirst === first &&
          existingSecond === second) ||
        (existingFirst === second &&
          existingSecond === first)
    );

    if (!duplicate) {
      pairs.push([first, second]);
    }
  }

  return pairs;
}

function clearMap() {
  routeLayer.clearLayers();
}

function drawRoute(route, color, airlineName) {
  const points = window.Calculation.greatCirclePoints(
    route,
    120
  );

  if (!points.length) {
    return;
  }

  const coordinates = points.map((point) => [
    point.lat,
    point.lon
  ]);

  L.polyline(coordinates, {
    color,
    weight: 2.5,
    opacity: 0.86
  })
    .bindPopup(
      `<strong>${escapeHtml(airlineName)}</strong><br>` +
      `${escapeHtml(route.name)}`
    )
    .addTo(routeLayer);

  L.circleMarker(
    [route.start.lat, route.start.lon],
    {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 1
    }
  )
    .bindTooltip(route.startCode, {
      direction: "top"
    })
    .addTo(routeLayer);

  L.circleMarker(
    [route.end.lat, route.end.lon],
    {
      radius: 4,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 1
    }
  )
    .bindTooltip(route.endCode, {
      direction: "top"
    })
    .addTo(routeLayer);
}

function drawIntersection(row) {
  const color =
    row.type === "shared-airport"
      ? "#facc15"
      : "#ef4444";

  L.circleMarker(
    [row.latitude, row.longitude],
    {
      radius: 6,
      color: "#ffffff",
      weight: 1.5,
      fillColor: color,
      fillOpacity: 1
    }
  )
    .bindPopup(
      `<strong>${escapeHtml(row.type)}</strong><br>` +
      `${escapeHtml(row.airlineA)}: ${escapeHtml(row.routeA)}<br>` +
      `${escapeHtml(row.airlineB)}: ${escapeHtml(row.routeB)}<br>` +
      `Distance on A: ${row.distanceA.toFixed(1)} km<br>` +
      `Distance on B: ${row.distanceB.toFixed(1)} km`
    )
    .addTo(routeLayer);
}

function fitMap() {
  const layers = routeLayer.getLayers();

  if (!layers.length) {
    map.setView([20, 0], 2);
    return;
  }

  const bounds = L.featureGroup(layers).getBounds();

  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.12));
  }
}

function updateSummary(message) {
  const summary = byId("analysis-summary");

  if (summary) {
    summary.textContent = message;
  }
}

function renderResults() {
  if (!lastRows.length) {
    resultsBody.innerHTML = `
      <tr>
        <td colspan="10">
          No individual route pairs matched the selected columns and
          min/max route-pair intersection filter.
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
          <td>${escapeHtml(row.airlineA)}</td>
          <td>${escapeHtml(row.airlineB)}</td>
          <td>${escapeHtml(row.routeA)}</td>
          <td>${escapeHtml(row.routeB)}</td>
          <td>${row.routePairCount}</td>
          <td>${escapeHtml(row.type)}</td>
          <td>${row.distanceA.toFixed(1)} km</td>
          <td>${row.distanceB.toFixed(1)} km</td>
          <td>${row.latitude.toFixed(5)}</td>
          <td>${row.longitude.toFixed(5)}</td>
        </tr>
      `
    )
    .join("");

  exportButtons.classList.remove("hidden");
}

function runAnalysis() {
  if (!databaseLoaded) {
    status.textContent =
      "Please wait until airports.csv has finished loading.";
    return;
  }

  if (!window.Calculation) {
    status.textContent =
      "calculation.js did not load. Add it before main.js in index.html.";
    return;
  }

  const columnElements = [
    ...columns.querySelectorAll(".column")
  ];

  if (columnElements.length < 2) {
    status.textContent =
      "Add at least two airline columns before running analysis.";
    return;
  }

  const parsedColumns = columnElements.map((column, index) => {
    const textarea = column.querySelector("textarea");
    const letter = String.fromCharCode(65 + index);

    return parseColumn(textarea.value, letter);
  });

  const mode = byId("compare-mode").value;
  const patterns = byId("pair-patterns").value;

  const minimum = Math.max(
    0,
    Math.min(
      2,
      Number.parseInt(byId("min-intercepts").value, 10) || 0
    )
  );

  const maximum = Math.max(
    minimum,
    Math.min(
      2,
      Number.parseInt(byId("max-intercepts").value, 10) || 2
    )
  );

  const includeShared = byId("count-shared").checked;

  const pairs = selectedPairs(
    parsedColumns.length,
    mode,
    patterns
  );

  if (!pairs.length) {
    updateSummary(
      "No airline-column comparison pairs are selected."
    );

    resultsBody.innerHTML = `
      <tr>
        <td colspan="10">
          No valid airline-column comparison pairs were selected.
        </td>
      </tr>
    `;

    return;
  }

  clearMap();

  parsedColumns.forEach((airline, index) => {
    const color = COLORS[index % COLORS.length];

    airline.routes.forEach((route) => {
      drawRoute(route, color, airline.name);
    });
  });

  let comparedRoutePairs = 0;
  let rawIntersections = 0;

  const rows = [];

  for (const [columnAIndex, columnBIndex] of pairs) {
    const airlineA = parsedColumns[columnAIndex];
    const airlineB = parsedColumns[columnBIndex];

    for (const routeA of airlineA.routes) {
      for (const routeB of airlineB.routes) {
        comparedRoutePairs += 1;

        const intersections =
          window.Calculation.routeIntersections(routeA, routeB, {
            includeShared
          });

        const routePairCount = intersections.length;

        if (
          routePairCount < minimum ||
          routePairCount > maximum
        ) {
          continue;
        }

        for (const point of intersections) {
          rawIntersections += 1;

          const row = {
            airlineA: airlineA.name,
            airlineB: airlineB.name,
            routeA: routeA.name,
            routeB: routeB.name,
            routePairCount,
            type: point.method,
            distanceA: window.Calculation.distance(
              routeA.start,
              point
            ),
            distanceB: window.Calculation.distance(
              routeB.start,
              point
            ),
            latitude: point.lat,
            longitude: point.lon
          };

          rows.push(row);
          drawIntersection(row);
        }
      }
    }
  }

  lastRows = rows;

  renderResults();
  fitMap();

  const unknownCodes = [
    ...new Set(
      parsedColumns.flatMap(
        (airline) => airline.unknownCodes
      )
    )
  ];

  const routeSummary = parsedColumns
    .map(
      (airline) =>
        `${airline.name}: ${airline.routes.length} valid routes`
    )
    .join(" | ");

  const unknownSummary = unknownCodes.length
    ? ` Unknown airport codes skipped: ${unknownCodes.join(", ")}.`
    : "";

  updateSummary(
    `${routeSummary}. ` +
      `Compared ${comparedRoutePairs} individual route pairs. ` +
      `Found ${rawIntersections} raw intersections. ` +
      `Displayed ${rows.length} result rows after per-route-pair filter ` +
      `${minimum}–${maximum}.` +
      unknownSummary
  );
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], {
    type: mimeType
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function exportText() {
  const content = lastRows.length
    ? lastRows
        .map(
          (row) =>
            `${row.airlineA} vs ${row.airlineB} | ` +
            `${row.routeA} × ${row.routeB} | ` +
            `count=${row.routePairCount} | ` +
            `type=${row.type} | ` +
            `A=${row.distanceA.toFixed(1)} km | ` +
            `B=${row.distanceB.toFixed(1)} km | ` +
            `lat=${row.latitude.toFixed(6)} | ` +
            `lon=${row.longitude.toFixed(6)}`
        )
        .join("\n")
    : "No qualifying route-pair intersections.";

  downloadFile(
    "result.txt",
    content,
    "text/plain;charset=utf-8"
  );
}

function exportCsv() {
  const header = [
    "Airline A",
    "Airline B",
    "Route A",
    "Route B",
    "Route-pair count",
    "Type",
    "A distance km",
    "B distance km",
    "Latitude",
    "Longitude"
  ];

  const data = lastRows.map((row) => [
    row.airlineA,
    row.airlineB,
    row.routeA,
    row.routeB,
    row.routePairCount,
    row.type,
    row.distanceA.toFixed(3),
    row.distanceB.toFixed(3),
    row.latitude.toFixed(6),
    row.longitude.toFixed(6)
  ]);

  const content = [
    header.map(csvCell).join(","),
    ...data.map((row) => row.map(csvCell).join(","))
  ].join("\n");

  downloadFile(
    "result.csv",
    content,
    "text/csv;charset=utf-8"
  );
}

function exportXlsx() {
  if (typeof XLSX === "undefined") {
    status.textContent =
      "Excel export is unavailable because the XLSX library did not load.";
    return;
  }

  const rows = lastRows.map((row) => ({
    "Airline A": row.airlineA,
    "Airline B": row.airlineB,
    "Route A": row.routeA,
    "Route B": row.routeB,
    "Route-pair count": row.routePairCount,
    Type: row.type,
    "A distance km": Number(row.distanceA.toFixed(3)),
    "B distance km": Number(row.distanceB.toFixed(3)),
    Latitude: Number(row.latitude.toFixed(6)),
    Longitude: Number(row.longitude.toFixed(6))
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    "Intersections"
  );

  XLSX.writeFile(workbook, "result.xlsx");
}

function columnTemplate(letter, color, value = "") {
  return `
    <section
      class="column"
      data-letter="${letter}"
      style="--color: ${color}"
    >
      <div class="column-head">
        <strong>${letter}: Airline routes</strong>

        <button
          class="remove"
          type="button"
          aria-label="Remove airline column ${letter}"
        >
          Remove
        </button>
      </div>

      <textarea
        spellcheck="false"
        placeholder="# Airline name&#10;HND LAX&#10;LAX JFK"
      >${escapeHtml(value)}</textarea>
    </section>
  `;
}

function relabelColumns() {
  const columnElements = [
    ...columns.querySelectorAll(".column")
  ];

  columnElements.forEach((column, index) => {
    const letter = String.fromCharCode(65 + index);
    const color = COLORS[index % COLORS.length];

    column.dataset.letter = letter;
    column.style.setProperty("--color", color);

    const heading = column.querySelector(".column-head strong");

    if (heading) {
      heading.textContent = `${letter}: Airline routes`;
    }

    const removeButton = column.querySelector(".remove");

    if (removeButton) {
      removeButton.setAttribute(
        "aria-label",
        `Remove airline column ${letter}`
      );
    }
  });
}

function addColumn(value = "") {
  const columnCount =
    columns.querySelectorAll(".column").length;

  if (columnCount >= 6) {
    status.textContent =
      "You can add up to six airline columns.";
    return;
  }

  const letter = String.fromCharCode(65 + columnCount);
  const color = COLORS[columnCount % COLORS.length];

  columns.insertAdjacentHTML(
    "beforeend",
    columnTemplate(letter, color, value)
  );

  relabelColumns();
}

byId("add-column").addEventListener("click", () => {
  addColumn();
});

columns.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove");

  if (!removeButton) {
    return;
  }

  const column = removeButton.closest(".column");

  if (!column) {
    return;
  }

  const columnCount =
    columns.querySelectorAll(".column").length;

  if (columnCount <= 2) {
    status.textContent =
      "Keep at least two airline columns for comparison.";
    return;
  }

  column.remove();
  relabelColumns();
});

byId("run-analysis").addEventListener("click", runAnalysis);

byId("compare-mode").addEventListener("change", (event) => {
  const useSelectedPairs =
    event.target.value === "selected";

  byId("pair-pattern-wrap").classList.toggle(
    "hidden",
    !useSelectedPairs
  );
});

exportButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-export]");

  if (!button) {
    return;
  }

  if (button.dataset.export === "txt") {
    exportText();
  }

  if (button.dataset.export === "csv") {
    exportCsv();
  }

  if (button.dataset.export === "xlsx") {
    exportXlsx();
  }
});

addColumn("# JAL\nHND LAX\nHND JFK\nHND LHR");

addColumn("# CA\nLAX HND\nLAX JFK\nLAX LHR");

loadAirportsCSV();
