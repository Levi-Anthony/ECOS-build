export function hasBasicAuthPassword(header: string | null, expectedPassword: string): boolean {
  if (!header?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return decoded.slice(separator + 1) === expectedPassword;
  } catch {
    return false;
  }
}
