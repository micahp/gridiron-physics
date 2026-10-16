// Tiny 2D vector helpers on plain {x, y} objects (allocation-light).
export const v2 = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clampLen = (a, m) => {
  const l = Math.hypot(a.x, a.y);
  return l > m ? { x: (a.x * m) / l, y: (a.y * m) / l } : a;
};
export const perp = (a) => ({ x: -a.y, y: a.x });
export const angleOf = (a) => Math.atan2(a.y, a.x);
export const fromAngle = (t, l = 1) => ({ x: Math.cos(t) * l, y: Math.sin(t) * l });
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
