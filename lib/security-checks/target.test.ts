import { describe, expect, it } from "vitest";
import { detectSecurityTargetKind, parseSecurityTarget } from "./target";

const value = (raw: string) => {
  const parsed = parseSecurityTarget(raw);
  return parsed.ok ? `${parsed.target.kind}:${parsed.target.value}` : `error:${parsed.error}`;
};

describe("parseSecurityTarget (#security-checks part 1)", () => {
  it("reads websites in every usual form as one tidy host", () => {
    expect(value("settle.ng")).toBe("website:settle.ng");
    expect(value("https://www.Settle.ng/pricing?x=1")).toBe("website:settle.ng");
    expect(value("http://shop.settle.ng:8080/")).toBe("website:shop.settle.ng");
    expect(value("  settle.ng.  ")).toBe("website:settle.ng");
    expect(value("xn--bcher-kva.example.com")).toBe("website:xn--bcher-kva.example.com");
  });

  it("keeps what the client typed for showing back", () => {
    const parsed = parseSecurityTarget(" https://www.settle.ng ");
    expect(parsed.ok && parsed.target.input).toBe("https://www.settle.ng");
  });

  it("reads GitHub repos as owner/name", () => {
    expect(value("github.com/settle/app")).toBe("repo:settle/app");
    expect(value("https://github.com/Settle/App.git")).toBe("repo:settle/app");
    expect(value("https://github.com/settle/app/tree/main/src")).toBe("repo:settle/app");
    expect(value("git@github.com:settle/app.git")).toBe("repo:settle/app");
    expect(value("www.github.com/settle/app#readme")).toBe("repo:settle/app");
  });

  it("refuses GitHub links that aren't a repo", () => {
    expect(value("github.com/settle")).toMatch(/^error:/);
    expect(value("https://github.com/")).toMatch(/^error:/);
  });

  it("reads public IP addresses and ssh addresses as servers", () => {
    expect(value("8.8.8.8")).toBe("server:8.8.8.8");
    expect(value("8.8.4.4:22")).toBe("server:8.8.4.4");
    expect(value("http://1.1.1.1/admin")).toBe("server:1.1.1.1");
    expect(value("ssh://root@box.settle.ng:2222")).toBe("server:box.settle.ng");
    expect(value("2606:4700:4700::1111")).toBe("server:2606:4700:4700:0:0:0:0:1111");
    expect(value("[2606:4700:4700::1111]:443")).toBe("server:2606:4700:4700:0:0:0:0:1111");
  });

  it("refuses private, local and reserved addresses", () => {
    for (const raw of [
      "localhost", "http://localhost:3000", "127.0.0.1", "10.0.0.5", "172.16.4.2", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "203.0.113.10",
      "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "printer.local", "db.internal", "ssh://192.168.0.2",
    ]) {
      expect(value(raw), raw).toMatch(/^error:That address is private/);
    }
  });

  it("refuses things it can't read", () => {
    for (const raw of ["", "   ", "hello", "settle", "settle .ng", "ftp://settle.ng", "https://user:pw@settle.ng", "999.1.1.1", "1.2.3", "-bad-.com", "a".repeat(301)]) {
      expect(value(raw), raw).toMatch(/^error:/);
    }
    expect(value(42 as unknown as string)).toMatch(/^error:Paste/);
  });

  it("detects the kind live, or null while unreadable", () => {
    expect(detectSecurityTargetKind("settle.ng")).toBe("website");
    expect(detectSecurityTargetKind("github.com/a/b")).toBe("repo");
    expect(detectSecurityTargetKind("8.8.8.8")).toBe("server");
    expect(detectSecurityTargetKind("sett")).toBeNull();
  });
});
