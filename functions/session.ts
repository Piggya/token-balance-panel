// Accept either the bare tr_session value or a full Cookie header. The header
// may contain other cookies before or after tr_session, so locate the pair
// instead of assuming it is first.
export function normalizeSession(raw: string): string | null {
  let value = raw.trim();
  if (value.includes(";")) {
    const pair = value
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("tr_session="));
    if (!pair) return null;
    value = pair.slice("tr_session=".length).trim();
  } else if (value.toLowerCase().startsWith("tr_session=")) {
    value = value.slice("tr_session=".length).trim();
  } else if (value.replace(/={1,2}$/, "").includes("=")) {
    // A bare session value only has optional `=` padding at the end. Anything
    // else is a different cookie (for example tr_ref_device=...) and is not a
    // usable login session.
    return null;
  }
  if (value.length < 10 || value.length > 4096) return null;
  if (!/^[A-Za-z0-9%._~+/=-]+$/.test(value)) return null;
  return value;
}
