import { describe, expect, it } from "vitest";

import { build, restoreKit, validate } from "./destination";

describe("a backup destination", () => {
  it("is S3 by its endpoint, bucket and folder, or Amazon's without an endpoint", () => {
    const r2 = { endpoint: "https://acct.r2.cloudflarestorage.com/", bucket: "box", path: "/stadeum/" };
    const keys = { accessKeyId: "id", secretAccessKey: "key" };
    expect(build("s3", r2, keys)).toEqual({
      repository: "s3:https://acct.r2.cloudflarestorage.com/box/stadeum",
      env: { AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "key" },
    });
    expect(build("s3", { bucket: "box", region: "eu-west-1" }, keys)).toEqual({
      repository: "s3:s3.amazonaws.com/box",
      env: { AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "key", AWS_DEFAULT_REGION: "eu-west-1" },
    });
    // MinIO without TLS on the box's network.
    expect(build("s3", { endpoint: "http://minio:9000", bucket: "b" }, keys).repository).toBe("s3:http://minio:9000/b");
  });

  it("is Azure, GCS or B2 in restic's own forms and variables", () => {
    expect(build("azure", { account: "acct", container: "c", path: "x" }, { accountKey: "k" })).toEqual({
      repository: "azure:c:/x",
      env: { AZURE_ACCOUNT_NAME: "acct", AZURE_ACCOUNT_KEY: "k" },
    });
    expect(build("gcs", { projectId: "p", bucket: "b" }, { serviceAccountKey: "{}" })).toEqual({
      repository: "gs:b:/",
      env: { GOOGLE_PROJECT_ID: "p", GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}" },
    });
    expect(build("b2", { bucket: "b", path: "s" }, { keyId: "i", applicationKey: "k" })).toEqual({
      repository: "b2:b:s",
      env: { B2_ACCOUNT_ID: "i", B2_ACCOUNT_KEY: "k" },
    });
  });

  it("asks for what it needs, and keeps secrets apart from the rest", () => {
    expect(validate("s3", { bucket: "b" })).toEqual({ ok: false, error: "Access key ID is needed." });
    expect(validate("s3", { bucket: "b", accessKeyId: " id ", secretAccessKey: "k", region: "" })).toEqual({
      ok: true,
      fields: { bucket: "b" },
      secrets: { accessKeyId: "id", secretAccessKey: "k" },
    });
  });

  it("refuses an endpoint with a path, a bad bucket name, a key that is not JSON", () => {
    const keys = { accessKeyId: "i", secretAccessKey: "k" };
    expect(validate("s3", { endpoint: "https://x.test/b", bucket: "b", ...keys }).ok).toBe(false);
    expect(validate("s3", { endpoint: "x.test", bucket: "b", ...keys }).ok).toBe(false);
    expect(validate("s3", { bucket: "b c", ...keys }).ok).toBe(false);
    expect(validate("gcs", { projectId: "p", bucket: "b", serviceAccountKey: "not json" }).ok).toBe(false);
  });

  it("keeps a local folder under /backups, where ops mounts the checkout's backups/", () => {
    expect(validate("local", { path: "/backups/stadeum/" })).toEqual({ ok: true, fields: { path: "/backups/stadeum" }, secrets: {} });
    expect(validate("local", { path: "backups/x" })).toMatchObject({ ok: true, fields: { path: "/backups/x" } });
    for (const bad of ["/etc", "/backups", "/backups/../etc", "/backups/a b"]) expect(validate("local", { path: bad }).ok).toBe(false);
  });

  it("gives a restore kit with the password and the credentials to fill in", () => {
    const kit = restoreKit("s3", build("s3", { bucket: "b", region: "eu-west-1" }, { accessKeyId: "AKIA", secretAccessKey: "s3cr3t" }), "pw");
    expect(kit).toContain("RESTIC_REPOSITORY=s3:s3.amazonaws.com/b\n");
    expect(kit).toContain("RESTIC_PASSWORD=pw\n");
    expect(kit).toContain("AWS_DEFAULT_REGION=eu-west-1\n");
    expect(kit).toContain("AWS_ACCESS_KEY_ID=<yours>\n");
    expect(kit).not.toContain("AKIA");
    expect(kit).not.toContain("s3cr3t");
    expect(kit).toMatch(/run --rm --env-from-file restore.env ops restore/);
  });
});
