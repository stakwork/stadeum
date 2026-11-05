/**
 * The app registry. An app is what a person opens: a name, one line on
 * what it does, and where it starts. The shell knows nothing about any
 * vertical; everything vertical arrives as an app.
 *
 * v1 ships with no apps. Setting `strutApp` on an entry makes its app page
 * host the Strut UI, e.g. `strutApp: { wf: "chat" }`.
 */

export interface App {
  /** URL-safe, stable. */
  id: string;
  name: string;
  description: string;
  /** Where the app starts. */
  entry: string;
  /** Set = the app is a Strut app, opened at this workflow (empty = Strut's home). */
  strutApp?: { wf?: string };
}

export const DEFAULT_APPS: App[] = [];

export async function listApps(): Promise<App[]> {
  return DEFAULT_APPS;
}

export async function getApp(id: string): Promise<App | undefined> {
  return (await listApps()).find((a) => a.id === id);
}
