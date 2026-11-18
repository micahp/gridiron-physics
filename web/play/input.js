// Touch and keyboard input. A virtual stick on the left half of the screen,
// action buttons on the right, keyboard as an alternative.
//
//   stick: { x, y } in -1..1, x = screen right, y = screen up
//   held:  set of held actions ('sprint')
//   take(name): true once per press ('hike', 'juke', 'stiff', 'throw0'..'throw4')

export class Input {
  constructor(root) {
    this.stick = { x: 0, y: 0 };
    this.held = new Set();
    this.pressed = new Set();
    this.keys = new Set();
    this.touchStick = { x: 0, y: 0 };
    this.root = root;
    this.buildStick();
    this.bindKeys();
  }

  take(name) {
    if (!this.pressed.has(name)) return false;
    this.pressed.delete(name);
    return true;
  }

  clear() { this.pressed.clear(); }

  press(name) { this.pressed.add(name); }

  /** Wire a DOM button: tap presses, holding keeps it in `held`. */
  bindButton(el, name, { hold = false } = {}) {
    const down = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('down');
      if (hold) this.held.add(name); else this.press(name);
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('down');
      if (hold) this.held.delete(name);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  buildStick() {
    const zone = document.createElement('div');
    zone.className = 'stick-zone';
    const base = document.createElement('div');
    base.className = 'stick-base';
    const knob = document.createElement('div');
    knob.className = 'stick-knob';
    base.appendChild(knob);
    zone.appendChild(base);
    this.root.appendChild(zone);
    this.stickZone = zone;
    let id = null, cx = 0, cy = 0;
    const R = 56;
    const place = (x, y) => {
      base.style.left = `${x - 70}px`;
      base.style.top = `${y - 70}px`;
    };
    const move = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchStick.x = dx / R;
      this.touchStick.y = -dy / R;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      place(cx - r.left, cy - r.top);
      base.classList.add('live');
      move(cx, cy);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      base.classList.remove('live');
      base.style.left = ''; base.style.top = '';
      this.touchStick.x = 0; this.touchStick.y = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindKeys() {
    const map = {
      ' ': 'juke', Enter: 'hike', e: 'stiff', E: 'stiff', q: 'stiff', Q: 'stiff',
      1: 'throw0', 2: 'throw1', 3: 'throw2', 4: 'throw3', 5: 'throw4',
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key);
      if (e.key === 'Shift') this.held.add('sprint');
      if (e.key === ' ') this.press('hike');     // space also snaps the ball
      if (map[e.key]) this.press(map[e.key]);
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key);
      if (e.key === 'Shift') this.held.delete('sprint');
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });
  }

  /** Merge keyboard and touch into one stick vector. */
  update() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('ArrowLeft') || k.has('a') || k.has('A')) x -= 1;
    if (k.has('ArrowRight') || k.has('d') || k.has('D')) x += 1;
    if (k.has('ArrowUp') || k.has('w') || k.has('W')) y += 1;
    if (k.has('ArrowDown') || k.has('s') || k.has('S')) y -= 1;
    if (x || y) {
      const d = Math.hypot(x, y);
      this.stick.x = x / d; this.stick.y = y / d;
    } else {
      this.stick.x = this.touchStick.x; this.stick.y = this.touchStick.y;
    }
  }
}
