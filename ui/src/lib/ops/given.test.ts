import { afterEach, describe, expect, it, vi } from "vitest";

import { givenBackup } from "./given";

afterEach(() => vi.restoreAllMocks());

const s3 = { kind: "s3", bucket: "fleet-backups", path: "/boxes/acme/", region: "us-east-1", accessKeyId: "AKIA1", secretAccessKey: "s3cr3t" };

describe("a backup destination given at install", () => {
  it("none when the setting is blank", () => {
    expect(givenBackup(undefined)).toBeUndefined();
    expect(givenBackup("  ")).toBeUndefined();
  });

  it("reads the Backups page's fields, split into what is secret and what is not", () => {
    expect(givenBackup(JSON.stringify(s3))).toEqual({
      kind: "s3",
      fields: { bucket: "fleet-backups", path: "/boxes/acme/", region: "us-east-1" },
      secrets: { accessKeyId: "AKIA1", secretAccessKey: "s3cr3t" },
    });
  });

  it("takes the password with it, when given", () => {
    expect(givenBackup(JSON.stringify(s3), " a-long-enough-password-0123 ")?.password).toBe("a-long-enough-password-0123");
    expect(givenBackup(JSON.stringify(s3), "")?.password).toBeUndefined();
  });

  it("leaves the whole setting out, with a line in the log, when it can't be used", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(givenBackup("{not json")).toBeUndefined();
    expect(givenBackup("[]")).toBeUndefined();
    expect(givenBackup(JSON.stringify({ ...s3, kind: "ftp" }))).toBeUndefined();
    expect(givenBackup(JSON.stringify({ ...s3, secretAccessKey: undefined }))).toBeUndefined();
    expect(givenBackup(JSON.stringify(s3), "short")).toBeUndefined();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("it is not JSON"),
      expect.stringContaining("it is not a JSON object"),
      expect.stringContaining("its kind is one of s3, azure, gcs, b2, local"),
      expect.stringContaining("Secret access key is needed"),
      expect.stringContaining("STADEUM_BACKUP_PASSWORD is shorter than 16 characters"),
    ]);
  });
});
