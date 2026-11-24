// Outcome-independent route geometry from the historical director.
// Offsets are yards forward and laterally from the player's alignment.
export const ROUTE_LIBRARY_VERSION = 'gridiron.routes.v1';

export function routeOffsets(kind, lateral) {
  const out = lateral < 0 ? -1 : 1;
  const routes = {
    go: [[12, 0], [35, out * 1]],
    curl: [[11, 0], [9.5, -out * 1]],
    out: [[10, 0], [10.5, out * 7]],
    dig: [[12, 0], [12, -out * 12]],
    slant: [[2.5, 0], [8, -out * 6]],
    flat: [[1, out * 3], [2, out * 9]],
    post: [[11, 0], [26, -out * 10]],
    seam: [[10, 0], [28, -out * 1]],
    check: [[0.5, out * 2.5], [3, out * 5]],
  };
  if (!Object.hasOwn(routes, kind)) throw new RangeError(`unsupported route: ${kind}`);
  return routes[kind];
}

export function routeWaypoints(kind, forward, lateral, transform) {
  if (typeof transform !== 'function') throw new TypeError('route transform is required');
  return routeOffsets(kind, lateral || 1).map(([df, dl]) => transform(forward + df, lateral + dl));
}
