import { describe, expect, it } from "vitest";
import { accessConfig, devEmailAllowed, googleAllowed } from "@/lib/access";

const workspace = accessConfig({ ALLOWED_EMAIL_DOMAIN: "acme.com" });
const friends = accessConfig({ ALLOWED_EMAILS: "Ana@gmail.com, bo@proton.me" });
const nobody = accessConfig({});

describe("who can sign in", () => {
  it("lets in verified accounts of the Workspace domain only", () => {
    expect(googleAllowed(workspace, { email: "a@acme.com", email_verified: true, hd: "acme.com" })).toBe(true);
    // A personal Google account registered with a company address has no hd.
    expect(googleAllowed(workspace, { email: "a@acme.com", email_verified: true })).toBe(false);
    expect(googleAllowed(workspace, { email: "a@acme.com", email_verified: false, hd: "acme.com" })).toBe(false);
    expect(googleAllowed(workspace, { email: "a@evil-acme.com", email_verified: true, hd: "evil-acme.com" })).toBe(false);
  });

  it("lets in listed addresses from any Google account, case-insensitively", () => {
    expect(googleAllowed(friends, { email: "ana@gmail.com", email_verified: true })).toBe(true);
    expect(googleAllowed(friends, { email: "eve@gmail.com", email_verified: true })).toBe(false);
  });

  it("lets nobody in when nothing is configured", () => {
    expect(googleAllowed(nobody, { email: "a@acme.com", email_verified: true, hd: "acme.com" })).toBe(false);
    expect(devEmailAllowed(nobody, "a@acme.com")).toBe(false);
  });

  it("applies the same rules to the development email login", () => {
    expect(devEmailAllowed(workspace, "b@acme.com")).toBe(true);
    expect(devEmailAllowed(friends, "BO@proton.me")).toBe(true);
    expect(devEmailAllowed(friends, "x@acme.com")).toBe(false);
  });
});
