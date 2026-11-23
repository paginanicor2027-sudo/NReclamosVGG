type Position = readonly number[];
type Ring = readonly Position[];
type Polygon = readonly Ring[];

type BoundaryGeometry =
  | { type: "Polygon"; coordinates: Polygon }
  | { type: "MultiPolygon"; coordinates: readonly Polygon[] };

export interface MunicipalBoundary {
  type: "FeatureCollection";
  features: readonly { geometry: BoundaryGeometry }[];
}

type RingLocation = "outside" | "inside" | "boundary";
const tolerance = 1e-10;

function locateInRing(
  ring: Ring,
  longitude: number,
  latitude: number,
): RingLocation {
  let inside = false;

  for (let index = 1; index < ring.length; index++) {
    const [startX, startY] = ring[index - 1];
    const [endX, endY] = ring[index];
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    const cross = deltaX * (latitude - startY) - deltaY * (longitude - startX);
    if (
      Math.abs(cross) <=
        tolerance * Math.max(Math.abs(deltaX), Math.abs(deltaY)) &&
      longitude >= Math.min(startX, endX) - tolerance &&
      longitude <= Math.max(startX, endX) + tolerance &&
      latitude >= Math.min(startY, endY) - tolerance &&
      latitude <= Math.max(startY, endY) + tolerance
    ) {
      return "boundary";
    }

    if (
      (startY > latitude) !== (endY > latitude) &&
      longitude < startX + (latitude - startY) * deltaX / deltaY
    ) {
      inside = !inside;
    }
  }

  return inside ? "inside" : "outside";
}

function polygonContains(
  polygon: Polygon,
  longitude: number,
  latitude: number,
): boolean {
  const [outerRing, ...holes] = polygon;
  const location = locateInRing(outerRing, longitude, latitude);
  if (location !== "inside") {
    return location === "boundary";
  }

  return !holes.some((hole) =>
    locateInRing(hole, longitude, latitude) === "inside"
  );
}

export function isInsideMunicipality(
  boundary: MunicipalBoundary,
  latitude: number,
  longitude: number,
): boolean {
  return boundary.features.some(({ geometry }) => {
    if (geometry.type === "Polygon") {
      return polygonContains(geometry.coordinates, longitude, latitude);
    }

    return geometry.coordinates.some((polygon) =>
      polygonContains(polygon, longitude, latitude)
    );
  });
}
