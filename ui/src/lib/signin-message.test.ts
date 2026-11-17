import { describe, expect, it } from "vitest";

import { maskEmail, signInMessage, validMasked } from "./signin-message";

describe("maskEmail", () => {
  it("keeps the first and last letter and the domain", () => {
    expect(maskEmail("alice@example.com")).toBe("a***e@example.com");
  });
  it("shows only the first letter of a short local part", () => {
    expect(maskEmail("a@x.com")).toBe("a***@x.com");
    expect(maskEmail("ab@x.com")).toBe("a***@x.com");
  });
  it("hides everything it cannot parse", () => {
    expect(maskEmail("nonsense")).toBe("***");
  });
});

describe("signInMessage", () => {
  it("names the masked email for a refusal, with how to get invited", () => {
    const m = signInMessage("NotInvited", "a***e@example.com");
    expect(m.title).toBe("a***e@example.com hasn't been invited.");
    expect(m.detail).toContain("Members page");
    expect(m.notInvited).toBe(true);
    expect(signInMessage("AccessDenied").title).toBe("That account hasn't been invited.");
  });
  it("points at the button only when it is shown", () => {
    expect(signInMessage("NotInvited", undefined, { canSwitch: true }).detail).toContain("use the button below.");
    const without = signInMessage("NotInvited", undefined, { canSwitch: false }).detail;
    expect(without).toContain("If you meant a different account, sign in with it below.");
    expect(without).not.toContain("button");
  });
  it("drops a cookie value that is not a masked email", () => {
    expect(validMasked("alice@example.com")).toBeUndefined();
    expect(signInMessage("NotInvited", "<b>x</b>").title).toBe("That account hasn't been invited.");
  });
  it("explains a failed check and other errors", () => {
    expect(signInMessage("SignInFailed").title).toBe("Something went wrong checking your access. Try again in a moment.");
    expect(signInMessage("NoEmail").notInvited).toBe(false);
    expect(signInMessage("Other").title).toBe("Sign-in didn't complete.");
  });
});
