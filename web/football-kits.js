// Explicit 2026 Week 7 kits; colors are stable uniform variants, not team-color
// multipliers applied to dark baked player textures.
const kit = (jersey, pants, helmet, number, trim, mask, sock = pants) => Object.freeze({
  jersey, pants, helmet, number, trim, mask, sock,
});

export const WEEK7_TEAM_KITS = Object.freeze({
  CIN: Object.freeze({
    home: kit('#fb4f14', '#111111', '#111111', '#111111', '#ffffff', '#111111'),
    away: kit('#f4f5f2', '#111111', '#111111', '#fb4f14', '#fb4f14', '#111111'),
  }),
  BAL: Object.freeze({
    home: kit('#241773', '#111111', '#111111', '#ffffff', '#9e7c0c', '#9e7c0c'),
    away: kit('#f4f5f2', '#111111', '#111111', '#241773', '#9e7c0c', '#9e7c0c'),
  }),
  MIA: Object.freeze({
    home: kit('#008e97', '#ffffff', '#008e97', '#ffffff', '#fc4c02', '#fc4c02'),
    away: kit('#f4f5f2', '#008e97', '#008e97', '#008e97', '#fc4c02', '#fc4c02'),
  }),
  NYJ: Object.freeze({
    home: kit('#125740', '#ffffff', '#125740', '#ffffff', '#ffffff', '#ffffff'),
    away: kit('#f4f5f2', '#125740', '#125740', '#125740', '#ffffff', '#ffffff'),
  }),
  SF: Object.freeze({
    home: kit('#aa0000', '#b3995d', '#aa0000', '#ffffff', '#b3995d', '#b3995d'),
    away: kit('#f4f5f2', '#b3995d', '#aa0000', '#aa0000', '#b3995d', '#b3995d'),
  }),
  ATL: Object.freeze({
    home: kit('#a71930', '#111111', '#111111', '#ffffff', '#111111', '#111111'),
    away: kit('#f4f5f2', '#111111', '#111111', '#a71930', '#111111', '#111111'),
  }),
  TB: Object.freeze({
    home: kit('#d50a0a', '#34302b', '#34302b', '#ffffff', '#b1babf', '#b1babf'),
    away: kit('#f4f5f2', '#34302b', '#34302b', '#d50a0a', '#b1babf', '#b1babf'),
  }),
  CAR: Object.freeze({
    home: kit('#0085ca', '#101820', '#101820', '#ffffff', '#101820', '#101820'),
    away: kit('#f4f5f2', '#101820', '#101820', '#0085ca', '#101820', '#101820'),
  }),
  GB: Object.freeze({
    home: kit('#203731', '#ffb612', '#203731', '#ffb612', '#ffb612', '#ffb612'),
    away: kit('#f4f5f2', '#203731', '#203731', '#203731', '#ffb612', '#ffb612'),
  }),
  DET: Object.freeze({
    home: kit('#0076b6', '#b0b7bc', '#0076b6', '#ffffff', '#b0b7bc', '#b0b7bc'),
    away: kit('#f4f5f2', '#b0b7bc', '#0076b6', '#0076b6', '#b0b7bc', '#b0b7bc'),
  }),
  DAL: Object.freeze({
    home: kit('#041e42', '#869397', '#869397', '#ffffff', '#869397', '#869397'),
    away: kit('#f4f5f2', '#869397', '#869397', '#041e42', '#869397', '#869397'),
  }),
  PHI: Object.freeze({
    home: kit('#004c54', '#111111', '#004c54', '#ffffff', '#a5acaf', '#a5acaf'),
    away: kit('#f4f5f2', '#004c54', '#004c54', '#004c54', '#a5acaf', '#a5acaf'),
  }),
});

export function kitsForMatchup(homeId, awayId, seed = '') {
  const home = WEEK7_TEAM_KITS[homeId]?.home;
  const away = WEEK7_TEAM_KITS[awayId]?.away;
  if (!home || !away) throw new Error(`No explicit Week 7 kit for ${homeId} or ${awayId}`);
  return {
    [homeId]: { ...home, seed: String(seed), side: 'home' },
    [awayId]: { ...away, seed: String(seed), side: 'away' },
  };
}

export function kitsForGame(homeId, awayId, teams, seed = '') {
  if (WEEK7_TEAM_KITS[homeId]?.home && WEEK7_TEAM_KITS[awayId]?.away) {
    return kitsForMatchup(homeId, awayId, seed);
  }
  const home = teams?.[homeId];
  const away = teams?.[awayId];
  if (!home || !away) throw new Error(`Missing team style for ${homeId} or ${awayId}`);
  return {
    [homeId]: {
      jersey: home.alt || home.color || '#33485b', pants: home.color || '#111111',
      helmet: home.color || '#33485b', number: '#ffffff', trim: home.color || '#33485b', mask: '#c8ccd2', sock: home.color || '#111111',
      seed: String(seed), side: 'home',
    },
    [awayId]: {
      jersey: '#f4f5f2', pants: '#f4f5f2', helmet: away.color || '#33485b',
      number: away.color || '#33485b', trim: away.alt || '#dbe9f2', mask: '#9aa3ad', sock: away.color || '#33485b',
      seed: String(seed), side: 'away',
    },
  };
}
