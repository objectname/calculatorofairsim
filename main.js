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
let lastAnalysis = null;

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

/* ------------------------- Airport CSV loading ------------------------- */

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

function findColumn(headers, ...names) {
  const normalized = headers.map((header) =>
    String(header).toLowerCase().replace(/[^a-z0-9]/g, "")
  );

  return normalized.findIndex((header) => names.includes(header));
}

async function loadAirportsCSV() {
  try {
    const response = await fetch("./airports.csv", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim());

    if (!lines.length) {
      throw new Error("airports.csv is empty");
    }

    const headers = parseCsvLine(lines[0]);

    const identIndex = findColumn(headers, "ident");
    const iataIndex = findColumn(headers, "iata", "iatacode");
    const icaoIndex = findColumn(headers, "icao", "icaocode", "gpscode");

    const latitudeIndex = findColumn(
      headers,
      "latitude",
      "latitudedeg",
      "latitude_deg",
      "lat"
    );

    const longitudeIndex = findColumn(
      headers,
      "longitude",
      "longitudedeg",
      "longitude_deg",
      "lon",
      "lng"
    );

    if (latitudeIndex < 0 || longitudeIndex < 0) {
      throw new Error("latitude/longitude columns are missing");
    }

    for (const line of lines.slice(1)) {
      const row = parseCsvLine(line);

      const lat = Number(row[latitudeIndex]);
      const lon = Number(row[longitudeIndex]);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        continue;
      }

      for (const index of [identIndex, iataIndex, icaoIndex]) {
        if (index < 0) {
          continue;
        }

        const code = String(row[index] || "")
          .trim()
          .toUpperCase();

        if (code) {
          airports.set(code, { lat, lon });
        }
      }
    }

    databaseLoaded = true;

    status.textContent =
      `airports.csv loaded (${airports.size.toLocaleString()} codes)`;
  } catch (error) {
    console.error(error);

    status.textContent =
      `Could not load airports.csv: ${error.message}`;
  }
}

/* --------------------------- Route input parsing ----------------------- */

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
    /*
      Accept all of these:
      HND LAX
      HND-LAX
      HND / LAX
      HND,LAX
      HND    LAX
    */
    const codes = line
      .trim()
      .toUpperCase()
      .split(/[\s,;\/\-_–—]+/)
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

/* ------------------------- Column pair selection ----------------------- */

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

  if (mode.startsWith("pairwise")) {
    for (let index = 0; index + 1 < count; index += 2) {
      pairs.push([index, index + 1]);
    }

    if (mode === "pairwise-wrap" && count > 2) {
      pairs.push([count - 1, 0]);
    }

    return pairs;
  }

  for (const token of patterns.split(/[,;\s]+/)) {
    const match = token.toUpperCase().match(/^([A-F])-([A-F])$/);

    if (!match) {
      continue;
    }

    const first = match[1].charCodeAt(0) - 65;
    const second = match[2].charCodeAt(0) - 65;

    const duplicate = pairs.some(
      ([existingFirst, existingSecond]) =>
        (existingFirst === first && existingSecond === second) ||
        (existingFirst === second && existingSecond === first)
    );

    if (
      first < count &&
      second < count &&
      first !== second &&
      !duplicate
    ) {
      pairs.push([first, second]);
    }
  }

  return pairs;
}

/* ------------------------------- Map ----------------------------------- */

function clearMap() {
  routeLayer.clearLayers();
}

function drawRoute(route, color, label) {
  if (!window.Calculation) {
    return;
  }

  const points = window.Calculation.greatCirclePoints(route, 100);

  const leafletPoints = points.map((point) => [
    point.lat,
    point.lon
  ]);

  const line = L.polyline(leafletPoints, {
    color,
    weight: 2,
    opacity: 0.84
  });

  line.bindPopup(
    `<strong>${escapeHtml(label)}</strong><br>` +
    `${escapeHtml(route.name)}`
  );

  line.addTo(routeLayer);

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

  const marker = L.circleMarker(
    [row.latitude, row.longitude],
    {
      radius: 6,
      color: "#ffffff",
      weight: 1,
      fillColor: color,
      fillOpacity: 1
    }
  );

  marker.bindPopup(
    `<strong>${escapeHtml(row.type)}</strong><br>` +
    `${escapeHtml(row.airlineA)}: ${escapeHtml(row.routeA)}<br>` +
    `${escapeHtml(row.airlineB)}: ${escapeHtml(row.routeB)}<br>` +
    `A distance: ${row.distanceA.toFixed(1)} km<br>` +
    `B distance: ${row.distanceB.toFixed(1)} km`
  );

  marker.addTo(routeLayer);
}

function fitMap() {
  const layers = routeLayer.getLayers();

  if (!layers.length) {
    map.setView([20, 0], 2);
    return;
  }

  const group = L.featureGroup(layers);
  const bounds = group.getBounds();

  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.12));
  }
}

/* ---------------------------- Results table ---------------------------- */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function updateSummary(message) {
  const summary = byId("analysis-summary");

  if (summary) {
    summary.textContent = message;
  }
}

/* ----------------------------- Analysis -------------------------------- */

function runAnalysis() {
  if (!databaseLoaded) {
    status.textContent = "Waiting for airports.csv to finish loading.";
    return;
  }

  if (!window.Calculation) {
    status.textContent =
      "calculation.js was not loaded. Check the script tag in index.html.";
    return;
  }

  const columnElements = [...columns.querySelectorAll(".column")];

  const parsedColumns = columnElements.map((column, index) => {
    const textarea = column.querySelector("textarea");
    const letter = String.fromCharCode(65 + index);

    return parseColumn(textarea.value, letter);
  });

  const mode = byId("compare-mode").value;
  const patterns = byId("pair-patterns").value;

  const minimum = Math.max(
    0,
    Math.min(2, Number(byId("min-intercepts").value))
  );

  const maximum = Math.max(
    minimum,
    Math.min(2, Number(byId("max-intercepts").value))
  );

  const includeShared = byId("count-shared").checked;

  const pairs = selectedPairs(
    parsedColumns.length,
    mode,
    patterns
  );

  clearMap();

  parsedColumns.forEach((column, index) => {
    const color = COLORS[index % COLORS.length];

    column.routes.forEach((route) => {
      drawRoute(route, color, column.name);
    });
  });

  const rows = [];
  let comparedRoutePairs = 0;
  let rawIntersections = 0;

  for (const [indexA, indexB] of pairs) {
    const airlineA = parsedColumns[indexA];
    const airlineB = parsedColumns[indexB];

    for (const routeA of airlineA.routes) {
      for (const routeB of airlineB.routes) {
        comparedRoutePairs += 1;

        const intersections =
          window.Calculation.routeIntersections(
            routeA,
            routeB,
            {
              includeShared
            }
          );

        const count = intersections.length;

        if (count < minimum || count > maximum) {
          continue;
        }

        for (const point of intersections) {
          rawIntersections += 1;

          const row = {
            airlineA: airlineA.name,
            airlineB: airlineB.name,
            routeA: routeA.name,
            routeB: routeB.name,
            routePairCount: count,
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

  lastAnalysis = {
    parsedColumns,
    pairs,
    comparedRoutePairs,
    rawIntersections,
    minimum,
    maximum,
    includeShared
  };

  renderResults();
  fitMap();

  const invalidCodes = parsedColumns
    .flatMap((column) => column.unknownCodes)
    .filter(Boolean);

  const invalidMessage = invalidCodes.length
    ? ` Unknown airport codes skipped: ${[
        ...new Set(invalidCodes)
      ].join(", ")}.`
    : "";

  updateSummary(
    `${parsedColumns
      .map(
        (column) =>
          `${column.name}: ${column.routes.length} valid routes`
      )
      .join(" | ")}. ` +
    `Compared ${comparedRoutePairs} individual route pairs. ` +
    `Found ${rawIntersections} raw intersections. ` +
    `Displayed ${rows.length} result rows after per-route-pair filter ` +
    `${minimum}-${maximum}.` +
    invalidMessage
  );
}

/* ----------------------------- Exports --------------------------------- */

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], {
    type: mimeType
  });

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

function makeCsv(rows) {
  const headers = [
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

  const values = rows.map((row) => [
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

  const escapeCsv = (value) =>
    `"${String(value).replace(/"/g, "\"\"")}"`;

  return [
    headers.map(escapeCsv).join(","),
    ...values.map((row) => row.map(escapeCsv).join(","))
  ].join("\n");
}

function exportTxt() {
  const output = lastRows
    .map(
      (row) =>
        [
          `${row.airlineA} vs ${row.airlineB}`,
          `${row.routeA} × ${row.routeB}`,
          `count=${row.routePairCount}`,
          `type=${row.type}`,
          `A=${row.distanceA.toFixed(1)} km`,
          `B=${row.distanceB.toFixed(1)} km`,
          `lat=${row.latitude.toFixed(6)}`,
          `lon=${row.longitude.toFixed(6)}`
        ].join(" | ")
    )
    .join("\n");

  downloadFile(
    "result.txt",
    output || "No qualifying route-pair intersections.",
    "text/plain;charset=utf-8"
  );
}

function exportCsv() {
  downloadFile(
    "result.csv",
    makeCsv(lastRows),
    "text/csv;charset=utf-8"
  );
}

function exportXlsx() {
  if (typeof XLSX === "undefined") {
    status.textContent =
      "Excel export library did not load. CSV export is still available.";
    return;
  }

  const worksheetRows = lastRows.map((row) => ({
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

  const workbook = XLSX.utils.book_new();

  const worksheet = XLSX.utils.json_to_sheet(worksheetRows);

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Intersections"
  );

  XLSX.writeFile(workbook, "result.xlsx");
}

/* -------------------------- Dynamic UI columns ------------------------- */

function columnTemplate(letter, color, value = "") {
  return `
    <section
      class="column"
      style="--color: ${color}"
      data-letter="${letter}"
    >
      <div class="column-head">
        <strong>${letter}: Airline routes</strong>

        <button
          class="remove"
          type="button"
          aria-label="Remove column ${letter}"
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

function reletterColumns() {
  const columnElements = [...columns.querySelectorAll(".column")];

  columnElements.forEach((column, index) => {
    const letter = String.fromCharCode(65 + index);
    const color = COLORS[index % COLORS.length];

    column.dataset.letter = letter;
    column.style.setProperty("--color", color);

    const title = column.querySelector(".column-head strong");

    if (title) {
      title.textContent = `${letter}: Airline routes`;
    }

    const removeButton = column.querySelector(".remove");

    if (removeButton) {
      removeButton.setAttribute(
        "aria-label",
        `Remove column ${letter}`
      );
    }
  });
}

function addColumn(value = "") {
  const count = columns.querySelectorAll(".column").length;

  if (count >= 6) {
    status.textContent = "A maximum of six airline columns is supported.";
    return;
  }

  const letter = String.fromCharCode(65 + count);
  const color = COLORS[count % COLORS.length];

  columns.insertAdjacentHTML(
    "beforeend",
    columnTemplate(letter, color, value)
  );

  reletterColumns();
}

/* ----------------------------- Listeners -------------------------------- */

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

  if (columns.querySelectorAll(".column").length <= 2) {
    status.textContent =
      "Keep at least two airline columns to compare routes.";
    return;
  }

  column.remove();
  reletterColumns();
});

byId("run-analysis").addEventListener("click", runAnalysis);

byId("compare-mode").addEventListener("change", (event) => {
  const selectedMode = event.target.value;

  byId("pair-pattern-wrap").classList.toggle(
    "hidden",
    selectedMode !== "selected"
  );
});

exportButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-export]");

  if (!button) {
    return;
  }

  const type = button.dataset.export;

  if (type === "txt") {
    exportTxt();
  }

  if (type === "csv") {
    exportCsv();
  }

  if (type === "xlsx") {
    exportXlsx();
  }
});

/* ------------------------------- Start --------------------------------- */

addColumn("# JAL\nHND LAX\nHND JFK\nHND LHR");

addColumn("# CA\nLAX HND\nLAX JFK\nLAX LHR");

loadAirportsCSV();
