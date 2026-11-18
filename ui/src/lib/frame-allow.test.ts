import { describe, expect, it } from "vitest";

import { STRUT_FRAME_ALLOW } from "./frame-allow";

describe("STRUT_FRAME_ALLOW", () => {
  it("grants every feature strut's own frame may give an app, the camera among them", () => {
    // strut web/src/frame-permissions.ts: BASE_ALLOW, then FRAME_GRANTS'
    // motion, camera and geolocation.
    const strut = ["microphone", "clipboard-write", "fullscreen", "gamepad", "screen-wake-lock", "accelerometer", "gyroscope", "camera", "geolocation"];
    const granted = STRUT_FRAME_ALLOW.split("; ");
    expect(granted).toEqual(expect.arrayContaining(strut));
    expect(new Set(granted).size).toBe(granted.length);
  });
});
