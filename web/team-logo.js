// Team logo for a scorebug, served from the repo's downloaded copies in web/logos (no network call per page load).
// The file names are ESPN's team slugs; a few abbreviations differ from them and are mapped here.
const LOGO_SLUG = { WAS: 'wsh', LA: 'lar', LAR: 'lar', LAC: 'lac' };

export function teamLogoUrl(abbr) {
  const key = String(abbr ?? '').toUpperCase();
  const slug = LOGO_SLUG[key] ?? key.toLowerCase();
  return slug ? `web/logos/${slug}.png` : '';
}
