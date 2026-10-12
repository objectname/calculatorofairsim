"use strict";

(() => {
  const CESIUM_ION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImRpQjJ1MGFULW00a3Z1Y1IiLCJqdGkiOiIxNjZiMjZlMi04YmRmLTRlZWYtYjRkNi1kNjIyMmRkMGFkYWMiLCJpZCI6NTIxODI1LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3OTE4MjA5NDZ9.PuQPdlaGUMKEkGEskrFIK-1enx2RkNqau-dTyMBgbZU";

  Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

  const globeViewer = new Cesium.Viewer("cesiumContainer", {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    animation: false,
    timeline: false,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: true,
    selectionIndicator: true,
    fullscreenButton: false
  });

  const leafletMap = L.map("map", {
    worldCopyJump: true
  }).setView([20, 0], 2);

  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles © Esri"
    }
  ).addTo(leafletMap);

  const osmLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  );

  L.control.layers({
    Satellite: satelliteLayer,
    OpenStreetMap: osmLayer
  }).addTo(leafletMap);

  const leafletLayer = L.layerGroup().addTo(leafletMap);
  const cesiumEntities = [];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function splitAtAntimeridian(points) {
    const segments = [];
    let segment = [];

    for (const point of points) {
      const current = {
        lat: point.lat,
        lon: point.lon
      };

      const previous = segment[segment.length - 1];

      if (previous && Math.abs(current.lon - previous.lon) > 180) {
        const adjustedLon =
          current.lon > 0 ? current.lon - 360 : current.lon + 360;

        const edgeLon = previous.lon > 0 ? 180 : -180;
        const oppositeEdgeLon = edgeLon === 180 ? -180 : 180;

        const fraction =
          (edgeLon - previous.lon) /
          (adjustedLon - previous.lon);

        const crossingLat =
          previous.lat + fraction * (current.lat - previous.lat);

        segment.push({
          lat: crossingLat,
          lon: edgeLon
        });

        if (segment.length > 1) {
          segments.push(segment);
        }

        segment = [
          {
            lat: crossingLat,
            lon: oppositeEdgeLon
          },
          current
        ];
      } else {
        segment.push(current);
      }
    }

    if (segment.length > 1) {
      segments.push(segment);
    }

    return segments;
  }

  function clear() {
    leafletLayer.clearLayers();

    for (const entity of cesiumEntities) {
      globeViewer.entities.remove(entity);
    }

    cesiumEntities.length = 0;
  }

  function addCesiumPolyline(points, color, width = 3) {
    const entity = globeViewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(
          points.flatMap((point) => [point.lon, point.lat])
        ),
        width,
        material: Cesium.Color.fromCssColorString(color),
        arcType: Cesium.ArcType.GEODESIC,
        clampToGround: true
      }
    });

    cesiumEntities.push(entity);
  }

  function addCesiumMarker(point, color, popupHtml) {
    const entity = globeViewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      description: popupHtml
    });

    cesiumEntities.push(entity);
  }

  function drawRoute(route, color, airlineName) {
    const points = Calculation.greatCirclePoints(route, 160);

    if (!points || points.length < 2) {
      return;
    }

    const safeAirline = escapeHtml(airlineName);
    const safeRoute = escapeHtml(route.name);

    for (const segment of splitAtAntimeridian(points)) {
      L.polyline(
        segment.map((point) => [point.lat, point.lon]),
        {
          color,
          weight: 2.5,
          opacity: 0.86
        }
      )
        .bindPopup(`<strong>${safeAirline}</strong><br>${safeRoute}`)
        .addTo(leafletLayer);
    }

    addCesiumPolyline(points, color, 3);

    for (const endpoint of [route.start, route.end]) {
      const code =
        endpoint === route.start
          ? route.startCode || ""
          : route.endCode || "";

      L.circleMarker([endpoint.lat, endpoint.lon], {
        radius: 4,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 1
      })
        .bindTooltip(escapeHtml(code), {
          direction: "top"
        })
        .addTo(leafletLayer);

      addCesiumMarker(
        endpoint,
        color,
        `<strong>${escapeHtml(code)}</strong><br>${safeAirline}<br>${safeRoute}`
      );
    }
  }

  function drawIntersection(row) {
    const color =
      row.type === "shared-airport"
        ? "#facc15"
        : "#ef4444";

    const point = {
      lat: row.latitude,
      lon: row.longitude
    };

    const popup =
      `<strong>${escapeHtml(row.type)}</strong><br>` +
      `${escapeHtml(row.airlineA)}: ${escapeHtml(row.routeA)}<br>` +
      `${escapeHtml(row.airlineB)}: ${escapeHtml(row.routeB)}<br>` +
      `Distance on A: ${row.distanceA.toFixed(1)} km<br>` +
      `Distance on B: ${row.distanceB.toFixed(1)} km`;

    L.circleMarker([point.lat, point.lon], {
      radius: 6,
      color: "#ffffff",
      weight: 1.5,
      fillColor: color,
      fillOpacity: 1
    })
      .bindPopup(popup)
      .addTo(leafletLayer);

    addCesiumMarker(point, color, popup);
  }

  function fit() {
    const layers = leafletLayer.getLayers();

    if (layers.length) {
      const bounds = L.featureGroup(layers).getBounds();

      if (bounds.isValid()) {
        leafletMap.fitBounds(bounds.pad(0.12));
      }
    } else {
      leafletMap.setView([20, 0], 2);
    }

    const entities = cesiumEntities.slice();

    if (entities.length) {
      globeViewer.zoomTo(entities);
    } else {
      globeViewer.camera.flyHome(0);
    }
  }

  function showGlobe() {
    document.getElementById("cesiumContainer").classList.remove("hidden");
    document.getElementById("map").classList.add("hidden");

    document.getElementById("show-globe").classList.add("active");
    document.getElementById("show-map").classList.remove("active");

    globeViewer.resize();
  }

  function showMap() {
    document.getElementById("cesiumContainer").classList.add("hidden");
    document.getElementById("map").classList.remove("hidden");

    document.getElementById("show-map").classList.add("active");
    document.getElementById("show-globe").classList.remove("active");

    leafletMap.invalidateSize();
  }

  document
    .getElementById("show-globe")
    .addEventListener("click", showGlobe);

  document
    .getElementById("show-map")
    .addEventListener("click", showMap);

  window.PlotMap = {
    clear,
    drawRoute,
    drawIntersection,
    fit,
    showGlobe,
    showMap
  };
})();
