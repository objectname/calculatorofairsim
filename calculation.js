"use strict";

(() => {
  const EARTH_RADIUS_KM = 6371.0088;

  const radians = (degrees) => (degrees * Math.PI) / 180;

  const degrees = (radiansValue) => (radiansValue * 180) / Math.PI;

  const clamp = (value, minimum, maximum) =>
    Math.max(minimum, Math.min(maximum, value));

  const normalizeLongitude = (longitude) =>
    ((longitude + 540) % 360) - 180;

  function distance(first, second) {
    const latitudeDifference = radians(second.lat - first.lat);
    const longitudeDifference = radians(second.lon - first.lon);

    const startLatitude = radians(first.lat);
    const endLatitude = radians(second.lat);

    const haversine =
      Math.sin(latitudeDifference / 2) ** 2 +
      Math.cos(startLatitude) *
        Math.cos(endLatitude) *
        Math.sin(longitudeDifference / 2) ** 2;

    const angle =
      2 *
      Math.atan2(
        Math.sqrt(haversine),
        Math.sqrt(Math.max(0, 1 - haversine))
      );

    return EARTH_RADIUS_KM * angle;
  }

  function toVector(point) {
    const latitude = radians(point.lat);
    const longitude = radians(point.lon);

    return {
      x: Math.cos(latitude) * Math.cos(longitude),
      y: Math.cos(latitude) * Math.sin(longitude),
      z: Math.sin(latitude)
    };
  }

  function fromVector(vector) {
    const length = Math.hypot(vector.x, vector.y, vector.z);

    if (length === 0) {
      return null;
    }

    const x = vector.x / length;
    const y = vector.y / length;
    const z = vector.z / length;

    return {
      lat: degrees(Math.atan2(z, Math.hypot(x, y))),
      lon: normalizeLongitude(degrees(Math.atan2(y, x)))
    };
  }

  function dot(first, second) {
    return (
      first.x * second.x +
      first.y * second.y +
      first.z * second.z
    );
  }

  function cross(first, second) {
    return {
      x: first.y * second.z - first.z * second.y,
      y: first.z * second.x - first.x * second.z,
      z: first.x * second.y - first.y * second.x
    };
  }

  function magnitude(vector) {
    return Math.hypot(vector.x, vector.y, vector.z);
  }

  function normalize(vector) {
    const length = magnitude(vector);

    if (length < 1e-15) {
      return null;
    }

    return {
      x: vector.x / length,
      y: vector.y / length,
      z: vector.z / length
    };
  }

  function samePoint(first, second, toleranceKm = 2) {
    return distance(first, second) <= toleranceKm;
  }

  function endpointIntersections(routeA, routeB) {
    const candidates = [
      {
        first: routeA.start,
        second: routeB.start
      },
      {
        first: routeA.start,
        second: routeB.end
      },
      {
        first: routeA.end,
        second: routeB.start
      },
      {
        first: routeA.end,
        second: routeB.end
      }
    ];

    const matches = [];

    for (const candidate of candidates) {
      if (!samePoint(candidate.first, candidate.second)) {
        continue;
      }

      const point = {
        lat: candidate.first.lat,
        lon: candidate.first.lon,
        method: "shared-airport"
      };

      const alreadyIncluded = matches.some((existing) =>
        samePoint(existing, point)
      );

      if (!alreadyIncluded) {
        matches.push(point);
      }
    }

    return matches;
  }

  function isPointOnRoute(point, route, toleranceKm = 8) {
    const fullRouteDistance = distance(route.start, route.end);

    if (fullRouteDistance < 0.01) {
      return samePoint(point, route.start, toleranceKm);
    }

    const startToPoint = distance(route.start, point);
    const pointToEnd = distance(point, route.end);

    return (
      Math.abs(
        startToPoint +
          pointToEnd -
          fullRouteDistance
      ) <= toleranceKm
    );
  }

  function isNearRouteEndpoint(point, route, toleranceKm = 2) {
    return (
      samePoint(point, route.start, toleranceKm) ||
      samePoint(point, route.end, toleranceKm)
    );
  }

  function deduplicate(points, toleranceKm = 2) {
    const unique = [];

    for (const point of points) {
      const exists = unique.some((existing) =>
        samePoint(existing, point, toleranceKm)
      );

      if (!exists) {
        unique.push(point);
      }
    }

    return unique;
  }

  function routeIntersections(
    routeA,
    routeB,
    {
      includeShared = true,
      routeToleranceKm = 8,
      endpointToleranceKm = 2
    } = {}
  ) {
    if (
      !routeA ||
      !routeB ||
      !routeA.start ||
      !routeA.end ||
      !routeB.start ||
      !routeB.end
    ) {
      return [];
    }

    const results = [];

    const sharedEndpoints = endpointIntersections(routeA, routeB);

    if (includeShared) {
      results.push(...sharedEndpoints);
    }

    const startA = toVector(routeA.start);
    const endA = toVector(routeA.end);
    const startB = toVector(routeB.start);
    const endB = toVector(routeB.end);

    const normalA = cross(startA, endA);
    const normalB = cross(startB, endB);

    if (
      magnitude(normalA) < 1e-14 ||
      magnitude(normalB) < 1e-14
    ) {
      return deduplicate(results);
    }

    const crossingVector = cross(normalA, normalB);
    const crossingMagnitude = magnitude(crossingVector);

    /*
      When this is nearly zero, routes share the same great-circle plane.
      That means they either do not cross or overlap/are reversed versions
      of the same route. Shared endpoints have already been handled above.
    */
    if (crossingMagnitude < 1e-14) {
      return deduplicate(results);
    }

    const normalizedCrossing = normalize(crossingVector);

    if (!normalizedCrossing) {
      return deduplicate(results);
    }

    const candidateOne = fromVector(normalizedCrossing);

    const candidateTwo = {
      lat: -candidateOne.lat,
      lon: normalizeLongitude(candidateOne.lon + 180)
    };

    const candidates = [
      candidateOne,
      candidateTwo
    ];

    for (const candidate of candidates) {
      const onRouteA = isPointOnRoute(
        candidate,
        routeA,
        routeToleranceKm
      );

      const onRouteB = isPointOnRoute(
        candidate,
        routeB,
        routeToleranceKm
      );

      if (!onRouteA || !onRouteB) {
        continue;
      }

      const isSharedEndpoint =
        isNearRouteEndpoint(
          candidate,
          routeA,
          endpointToleranceKm
        ) &&
        isNearRouteEndpoint(
          candidate,
          routeB,
          endpointToleranceKm
        );

      if (isSharedEndpoint) {
        if (includeShared) {
          results.push({
            lat: candidate.lat,
            lon: candidate.lon,
            method: "shared-airport"
          });
        }

        continue;
      }

      results.push({
        lat: candidate.lat,
        lon: candidate.lon,
        method: "great-circle"
      });
    }

    return deduplicate(results);
  }

  function greatCirclePoints(route, count = 120) {
    if (
      !route ||
      !route.start ||
      !route.end
    ) {
      return [];
    }

    const startVector = toVector(route.start);
    const endVector = toVector(route.end);

    const angle = Math.acos(
      clamp(dot(startVector, endVector), -1, 1)
    );

    if (angle < 1e-12) {
      return [
        {
          lat: route.start.lat,
          lon: route.start.lon
        }
      ];
    }

    const sineOfAngle = Math.sin(angle);

    /*
      Nearly antipodal points do not have one uniquely defined
      shortest great-circle path. Use a stable interpolation fallback.
    */
    if (Math.abs(sineOfAngle) < 1e-12) {
      const points = [];

      for (let index = 0; index <= count; index += 1) {
        const fraction = index / count;

        points.push({
          lat:
            route.start.lat +
            (route.end.lat - route.start.lat) * fraction,
          lon: normalizeLongitude(
            route.start.lon +
              (route.end.lon - route.start.lon) * fraction
          )
        });
      }

      return points;
    }

    const points = [];

    for (let index = 0; index <= count; index += 1) {
      const fraction = index / count;

      const startWeight =
        Math.sin((1 - fraction) * angle) / sineOfAngle;

      const endWeight =
        Math.sin(fraction * angle) / sineOfAngle;

      const vector = {
        x:
          startWeight * startVector.x +
          endWeight * endVector.x,
        y:
          startWeight * startVector.y +
          endWeight * endVector.y,
        z:
          startWeight * startVector.z +
          endWeight * endVector.z
      };

      const point = fromVector(vector);

      if (point) {
        points.push(point);
      }
    }

    return points;
  }

  window.Calculation = {
    distance,
    greatCirclePoints,
    routeIntersections
  };
})();
