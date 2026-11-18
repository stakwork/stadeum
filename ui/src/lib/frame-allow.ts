/**
 * The `allow` of every frame stadeum puts strut's page in (an app, the
 * assistant, what a call opens). A frame inside gets only what each frame
 * above it has, and strut draws its own camera sheet and frames each app
 * with these features (strut `web/src/frame-permissions.ts`: every app's,
 * and the camera, location and motion an app declares), so stadeum's frame
 * grants all of them.
 */
export const STRUT_FRAME_ALLOW = [
  "microphone",
  "clipboard-write",
  "fullscreen",
  "gamepad",
  "screen-wake-lock",
  "camera",
  "geolocation",
  "accelerometer",
  "gyroscope",
].join("; ");
