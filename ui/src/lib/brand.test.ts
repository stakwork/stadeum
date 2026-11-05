import { describe, expect, it } from "vitest";

import {
  brandStyles,
  contrast,
  darkFor,
  darkOnDark,
  deeperForLight,
  KIT_FONT,
  kitTokens,
  lighterForDark,
  PAGE,
  paleOnLight,
  parseHex,
  sameBrand,
  SWATCHES,
  textOn,
  themeColor,
} from "./brand";

describe("parseHex", () => {
  it("takes #rgb and #rrggbb, with or without the #, as lowercase #rrggbb", () => {
    expect(parseHex("#0D9488")).toBe("#0d9488");
    expect(parseHex("0d9488")).toBe("#0d9488");
    expect(parseHex(" #f80 ")).toBe("#ff8800");
    expect(parseHex("abc")).toBe("#aabbcc");
  });

  it("refuses anything else", () => {
    for (const bad of ["", "#", "#12", "#1234", "#12345g", "teal", "rgb(0,0,0)", "#0d94880"]) expect(parseHex(bad)).toBeNull();
  });
});

describe("textOn, strut's contrast pick", () => {
  it("is white on a dark color and near-black on a light one", () => {
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#ffffff")).toBe("#0a0a0a");
    expect(textOn("#1e3a8a")).toBe("#ffffff");
    expect(textOn("#fde047")).toBe("#0a0a0a");
    expect(textOn("#fff")).toBe("#0a0a0a");
  });

  it("picks whichever reads better on a mid-tone", () => {
    // Teal-600: near-black reads at 4.8:1, white only at 3.7:1.
    expect(textOn("#0d9488")).toBe("#0a0a0a");
    expect(contrast("#0d9488", "#0a0a0a")).toBeGreaterThan(contrast("#0d9488", "#ffffff"));
    // Blue-600: white wins.
    expect(textOn("#2563eb")).toBe("#ffffff");
    for (const s of SWATCHES) {
      const other = textOn(s.light) === "#ffffff" ? "#0a0a0a" : "#ffffff";
      expect(contrast(s.light, textOn(s.light))).toBeGreaterThanOrEqual(contrast(s.light, other));
    }
  });

  it("measures contrast the WCAG way", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
});

describe("brandStyles and the kit's tokens", () => {
  it("sends nothing for an empty brand, and the kit keeps its defaults", () => {
    expect(brandStyles({})).toBeNull();
    const light = kitTokens({}, "light");
    expect(light["--k-primary"]).toBe("#171717");
    expect(light["--k-radius"]).toBe("0.625rem");
    expect(light["--k-font"]).toBe(KIT_FONT);
    expect(kitTokens({}, "dark")["--k-primary"]).toBe("#e5e5e5");
  });

  it("hands each theme strut's standard variables", () => {
    expect(brandStyles({ color: "#0d9488", radius: "1rem", font: "Georgia, serif" })).toEqual({
      light: {
        variables: {
          "--color-background-inverse": "#0d9488",
          "--color-text-inverse": "#0a0a0a",
          "--color-ring-primary": "#0d9488",
          "--border-radius-md": "1rem",
          "--font-sans": "Georgia, serif",
        },
      },
      dark: {
        variables: {
          "--color-background-inverse": "#0d9488",
          "--color-text-inverse": "#0a0a0a",
          "--color-ring-primary": "#0d9488",
          "--border-radius-md": "1rem",
          "--font-sans": "Georgia, serif",
        },
      },
    });
    // A radius alone sends no color.
    expect(brandStyles({ radius: "0" })?.light.variables).toEqual({ "--border-radius-md": "0" });
  });

  it("falls each color back to the other", () => {
    expect(themeColor({ color: "#1e3a8a", colorDark: "#93c5fd" }, "light")).toBe("#1e3a8a");
    expect(themeColor({ color: "#1e3a8a", colorDark: "#93c5fd" }, "dark")).toBe("#93c5fd");
    expect(themeColor({ color: "#1e3a8a" }, "dark")).toBe("#1e3a8a");
    expect(themeColor({ colorDark: "#93c5fd" }, "light")).toBe("#93c5fd");
  });

  it("maps the color onto primary, its text, the sidebar's primary and the ring", () => {
    const t = kitTokens({ color: "#1e3a8a" }, "light");
    expect(t).toMatchObject({
      "--k-primary": "#1e3a8a",
      "--k-primary-foreground": "#ffffff",
      "--k-sidebar-primary": "#1e3a8a",
      "--k-ring": "#1e3a8a",
    });
    // Unbranded, the dark sidebar's selected item is the kit's blue.
    expect(kitTokens({}, "dark")["--k-sidebar-primary"]).toBe("#1447e6");
  });
});

describe("reading a color against its page", () => {
  it("flags a pale color on white and a dark one on the dark theme", () => {
    expect(paleOnLight("#fde047")).toBe(true);
    expect(paleOnLight("#0d9488")).toBe(false);
    expect(darkOnDark("#1e3a8a")).toBe(true);
    expect(darkOnDark("#0d9488")).toBe(false);
  });

  it("suggests a deeper shade for light and a lighter tint for dark, both comfortably readable", () => {
    for (const hex of ["#fde047", "#ffffff", "#a5f3fc"]) {
      expect(contrast(deeperForLight(hex), PAGE.light)).toBeGreaterThanOrEqual(4.5);
    }
    for (const hex of ["#1e3a8a", "#000000", "#123456", "#4c1d95"]) {
      expect(contrast(lighterForDark(hex), PAGE.dark)).toBeGreaterThanOrEqual(4.5);
    }
    // Same hue, only lighter: navy stays blue.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(lighterForDark("#1e3a8a").slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r!);
    expect(b).toBeGreaterThan(g!);
  });

  it("offers the dark theme a swatch's twin, a lighter tint of a dark custom color, or the color itself", () => {
    expect(darkFor("#1e3a8a")).toBe("#93c5fd");
    expect(darkFor("#123456")).toBe(lighterForDark("#123456"));
    expect(darkFor("#ff8800")).toBe("#ff8800");
    for (const s of SWATCHES) expect(darkOnDark(s.dark), s.name).toBe(false);
    for (const s of SWATCHES) expect(paleOnLight(s.light), s.name).toBe(false);
  });
});

describe("sameBrand", () => {
  it("compares the four fields, with empty as unset", () => {
    expect(sameBrand({}, {})).toBe(true);
    expect(sameBrand({ color: "#0d9488" }, { color: "#0d9488", font: "" })).toBe(true);
    expect(sameBrand({ color: "#0d9488" }, { color: "#0d9489" })).toBe(false);
    expect(sameBrand({ radius: "0" }, {})).toBe(false);
  });
});
