/** A route segment that is an app's name, encoded: `strut%2Fjamie` → `strut/jamie`. */
export function appName(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
