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
    const response = await fetch("./airports.csv");

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
      .map((header, index) => ({ header, index }))
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
        `Could not find latitude/longitude columns. Headers: ${headers.join(", ")}`
      );
    }

    if (!codeIndexes.length) {
      throw new Error(
        `Could not find airport code columns. Headers: ${headers.join(", ")}`
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

      for (const index of codeIndexes) {
        const code = String(row[index] || "")
          .trim()
          .toUpperCase();

        if (
          code &&
          code !== "\\N" &&
          code !== "NULL" &&
          code !== "N/A"
        ) {
          airports.set(code, point);
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
      if (!start) unknownCodes.add(startCode);
      if (!end) unknownCodes.add(endCode);
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
    const match = token.toUpperCase().match(/^([A-F])-([A-F])$/);

    if (!match) continue;

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
      ([a, b]) =>
        (a === first && b === second) ||
        (a === second && b === first)
    );

    if (!duplicate) pairs.push([first, second]);
  }

  return pairs;
}

function updateSummary(message) {
  const summary = byId("analysis-summary");
  if (summary) summary.textContent = message;
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
      "calculation.js did not load. Check its script tag in index.html.";
    return;
  }

  if (!window.PlotMap) {
    status.textContent =
      "plotmap.js did not load. Check its script tag in index.html.";
    return;
  }

  const columnElements = [...columns.querySelectorAll(".column")];

  if (columnElements.length < 2) {
    status.textContent =
      "Add at least two airline columns before analysis.";
    return;
  }

  const parsedColumns = columnElements.map((column, index) =>
    parseColumn(
      column.querySelector("textarea").value,
      String.fromCharCode(65 + index)
    )
  );

  const pairs = selectedPairs(
    parsedColumns.length,
    byId("compare-mode").value,
    byId("pair-patterns").value
  );

  const minimum = Math.max(
    0,
    Math.min(2, Number.parseInt(byId("min-intercepts").value, 10) || 0)
  );

  const maximum = Math.max(
    minimum,
    Math.min(2, Number.parseInt(byId("max-intercepts").value, 10) || 2)
  );

  const includeShared = byId("count-shared").checked;

  PlotMap.clear();

  parsedColumns.forEach((airline, index) => {
    airline.routes.forEach((route) => {
      PlotMap.drawRoute(
        route,
        COLORS[index % COLORS.length],
        airline.name
      );
    });
  });

  let comparedRoutePairs = 0;
  let rawIntersections = 0;
  const rows = [];

  for (const [indexA, indexB] of pairs) {
    const airlineA = parsedColumns[indexA];
    const airlineB = parsedColumns[indexB];

    for (const routeA of airlineA.routes) {
      for (const routeB of airlineB.routes) {
        comparedRoutePairs += 1;

        const intersections = Calculation.routeIntersections(
          routeA,
          routeB,
          { includeShared }
        );

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
            distanceA: Calculation.distance(routeA.start, point),
            distanceB: Calculation.distance(routeB.start, point),
            latitude: point.lat,
            longitude: point.lon
          };

          rows.push(row);
          PlotMap.drawIntersection(row);
        }
      }
    }
  }

  lastRows = rows;

  renderResults();
  PlotMap.fit();

  const unknownCodes = [
    ...new Set(
      parsedColumns.flatMap((airline) => airline.unknownCodes)
    )
  ];

  const routeCounts = parsedColumns
    .map(
      (airline) =>
        `${airline.name}: ${airline.routes.length} valid routes`
    )
    .join(" | ");

  const unknownMessage = unknownCodes.length
    ? ` Unknown airport codes skipped: ${unknownCodes.join(", ")}.`
    : "";

  updateSummary(
    `${routeCounts}. ` +
    `Compared ${comparedRoutePairs} individual route pairs. ` +
    `Found ${rawIntersections} raw intersections. ` +
    `Displayed ${rows.length} result rows after per-route-pair filter ` +
    `${minimum}–${maximum}.` +
    unknownMessage
  );
}

function downloadFile(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
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
    ? lastRows.map((row) =>
        `${row.airlineA} vs ${row.airlineB} | ` +
        `${row.routeA} × ${row.routeB} | ` +
        `count=${row.routePairCount} | type=${row.type} | ` +
        `A=${row.distanceA.toFixed(1)} km | ` +
        `B=${row.distanceB.toFixed(1)} km | ` +
        `lat=${row.latitude.toFixed(6)} | ` +
        `lon=${row.longitude.toFixed(6)}`
      ).join("\n")
    : "No qualifying route-pair intersections.";

  downloadFile("result.txt", content, "text/plain;charset=utf-8");
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

  const csv = [
    header.map(csvCell).join(","),
    ...data.map((row) => row.map(csvCell).join(","))
  ].join("\n");

  downloadFile("result.csv", csv, "text/csv;charset=utf-8");
}

function exportXlsx() {
  if (typeof XLSX === "undefined") {
    status.textContent =
      "XLSX export library did not load. Try CSV export instead.";
    return;
  }

  const data = lastRows.map((row) => ({
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
  const worksheet = XLSX.utils.json_to_sheet(data);

  XLSX.utils.book_append_sheet(workbook, worksheet, "Intersections");
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
        <button class="remove" type="button">Remove</button>
      </div>
      <textarea
        spellcheck="false"
        placeholder="# Airline name&#10;HND LAX&#10;LAX JFK"
      >${escapeHtml(value)}</textarea>
    </section>
  `;
}

function relabelColumns() {
  [...columns.querySelectorAll(".column")].forEach((column, index) => {
    const letter = String.fromCharCode(65 + index);

    column.dataset.letter = letter;
    column.style.setProperty("--color", COLORS[index % COLORS.length]);

    const heading = column.querySelector(".column-head strong");
    if (heading) heading.textContent = `${letter}: Airline routes`;
  });
}

function addColumn(value = "") {
  const count = columns.querySelectorAll(".column").length;

  if (count >= 6) {
    status.textContent = "You can add up to six airline columns.";
    return;
  }

  const letter = String.fromCharCode(65 + count);

  columns.insertAdjacentHTML(
    "beforeend",
    columnTemplate(letter, COLORS[count % COLORS.length], value)
  );

  relabelColumns();
}

byId("add-column").addEventListener("click", () => addColumn());

columns.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove");

  if (!removeButton) return;

  if (columns.querySelectorAll(".column").length <= 2) {
    status.textContent =
      "Keep at least two airline columns for comparison.";
    return;
  }

  removeButton.closest(".column").remove();
  relabelColumns();
});

byId("run-analysis").addEventListener("click", runAnalysis);

byId("compare-mode").addEventListener("change", (event) => {
  byId("pair-pattern-wrap").classList.toggle(
    "hidden",
    event.target.value !== "selected"
  );
});

exportButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-export]");
  if (!button) return;

  if (button.dataset.export === "txt") exportText();
  if (button.dataset.export === "csv") exportCsv();
  if (button.dataset.export === "xlsx") exportXlsx();
});

addColumn("# JAL\nHND LAX\nHND JFK\nHND LHR");
addColumn("# CA\nLAX HND\nLAX JFK\nLAX LHR");

loadAirportsCSV();
