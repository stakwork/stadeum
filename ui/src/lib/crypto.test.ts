import { describe, expect, it } from "vitest";
import { decryptField, encryptField } from "./crypto";

describe("encryptField", () => {
  it("round-trips and never stores the plaintext", () => {
    const stored = encryptField("vkValue", "sk-bf-secret");
    expect(stored).not.toContain("sk-bf-secret");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(decryptField("vkValue", stored)).toBe("sk-bf-secret");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptField("f", "x")).not.toBe(encryptField("f", "x"));
  });

  it("refuses a value moved to another field (AAD)", () => {
    const stored = encryptField("orgPrivkey", "abc");
    expect(() => decryptField("userPrivkey", stored)).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptField("f", "hello").split(":");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptField("f", [v, iv, tag, flipped.toString("base64url")].join(":"))).toThrow();
  });
});
