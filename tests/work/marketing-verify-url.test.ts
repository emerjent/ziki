import { describe, expect, it } from "vitest";
import { isDisallowedIp, verifyUrl, verifyPublishedUrls } from "@/lib/marketing/verify-url";

describe("lib/marketing/verify-url", () => {
  describe("isDisallowedIp", () => {
    it("rejects loopback IPv4 addresses", () => {
      expect(isDisallowedIp("127.0.0.1")).toBe(true);
      expect(isDisallowedIp("127.1.2.3")).toBe(true);
    });

    it("rejects private RFC 1918 IPv4 addresses", () => {
      expect(isDisallowedIp("10.0.0.1")).toBe(true);
      expect(isDisallowedIp("10.254.1.1")).toBe(true);
      expect(isDisallowedIp("172.16.0.1")).toBe(true);
      expect(isDisallowedIp("172.31.255.255")).toBe(true);
      expect(isDisallowedIp("192.168.1.1")).toBe(true);
      expect(isDisallowedIp("192.168.254.254")).toBe(true);
    });

    it("rejects link-local, cloud metadata, and carrier-grade NAT IPv4 addresses", () => {
      expect(isDisallowedIp("169.254.169.254")).toBe(true);
      expect(isDisallowedIp("169.254.1.1")).toBe(true);
      expect(isDisallowedIp("100.64.0.1")).toBe(true);
      expect(isDisallowedIp("100.127.255.255")).toBe(true);
    });

    it("rejects multicast and reserved IPv4 addresses", () => {
      expect(isDisallowedIp("224.0.0.1")).toBe(true);
      expect(isDisallowedIp("239.255.255.250")).toBe(true);
      expect(isDisallowedIp("240.0.0.1")).toBe(true);
      expect(isDisallowedIp("255.255.255.255")).toBe(true);
      expect(isDisallowedIp("0.0.0.0")).toBe(true);
    });

    it("rejects loopback, link-local, unique-local, and IPv4-mapped IPv6 addresses", () => {
      expect(isDisallowedIp("::1")).toBe(true);
      expect(isDisallowedIp("[::1]")).toBe(true);
      expect(isDisallowedIp("::")).toBe(true);
      expect(isDisallowedIp("fc00::1")).toBe(true);
      expect(isDisallowedIp("[fc00::1]")).toBe(true);
      expect(isDisallowedIp("fd12:3456:789a::1")).toBe(true);
      expect(isDisallowedIp("fe80::1")).toBe(true);
      expect(isDisallowedIp("[fe80::1]")).toBe(true);
      expect(isDisallowedIp("fec0::1")).toBe(true); // site-local
      expect(isDisallowedIp("2001:db8::1")).toBe(true); // documentation
      expect(isDisallowedIp("2001:2::1")).toBe(true); // benchmarking
      expect(isDisallowedIp("2001:20::1")).toBe(true); // orchid
      expect(isDisallowedIp("2002:7f00:0001::")).toBe(true); // 6to4 loopback 127.0.0.1
      expect(isDisallowedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:10.0.0.1")).toBe(true);
      expect(isDisallowedIp("::ffff:169.254.169.254")).toBe(true);
    });

    it("allows valid public IPv4 and IPv6 addresses", () => {
      expect(isDisallowedIp("8.8.8.8")).toBe(false);
      expect(isDisallowedIp("1.1.1.1")).toBe(false);
      expect(isDisallowedIp("93.184.216.34")).toBe(false);
      expect(isDisallowedIp("2606:4700:4700::1111")).toBe(false);
    });

    it("rejects non-IP strings", () => {
      expect(isDisallowedIp("localhost")).toBe(true);
      expect(isDisallowedIp("invalid-ip")).toBe(true);
    });
  });

  describe("verifyUrl SSRF protection", () => {
    it("rejects non-http/https protocols", async () => {
      const res = await verifyUrl("ftp://example.com/file.txt");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Unsupported protocol");
    });

    it("rejects invalid URLs", async () => {
      const res = await verifyUrl("not-a-valid-url");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("Invalid URL format");
    });

    it("rejects loopback / localhost directly", async () => {
      const res = await verifyUrl("http://127.0.0.1:8080/secret");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Forbidden destination IP address");

      const resV6 = await verifyUrl("http://[::1]:8080/secret");
      expect(resV6.ok).toBe(false);
      expect(resV6.error).toContain("Forbidden destination IP address");
    });

    it("rejects AWS metadata endpoint", async () => {
      const res = await verifyUrl("http://169.254.169.254/latest/meta-data");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Forbidden destination IP address");
    });
  });

  describe("verifyPublishedUrls", () => {
    it("returns empty results for empty input array", async () => {
      const res = await verifyPublishedUrls([]);
      expect(res.allOk).toBe(false);
      expect(res.results).toEqual([]);
    });

    it("marks allOk false if any URL fails verification", async () => {
      const res = await verifyPublishedUrls([
        "http://127.0.0.1:8080/test",
        "ftp://invalid-proto",
      ]);
      expect(res.allOk).toBe(false);
      expect(res.results.length).toBe(2);
      expect(res.results[0].ok).toBe(false);
      expect(res.results[1].ok).toBe(false);
    });
  });
});
