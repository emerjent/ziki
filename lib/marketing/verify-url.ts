import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface UrlVerificationResult {
  url: string;
  ok: boolean;
  status: number | null;
  ip: string | null;
  latencyMs: number;
  method: "HEAD" | "GET";
  finalUrl?: string;
  redirectCount: number;
  error?: string;
  checkedAt: string;
}

export interface BatchVerificationResult {
  allOk: boolean;
  results: UrlVerificationResult[];
}

/**
 * Validates whether an IP address belongs to a private, loopback, link-local,
 * multicast, carrier-grade NAT, or reserved range that should not be reached by SSRF.
 */
export function isDisallowedIp(rawIp: string): boolean {
  const ip = rawIp.startsWith("[") && rawIp.endsWith("]") ? rawIp.slice(1, -1) : rawIp;
  const version = net.isIP(ip);
  if (version === 0) {
    return true; // Not a valid IP
  }

  if (version === 4) {
    return isDisallowedIPv4(ip);
  }

  if (version === 6) {
    return isDisallowedIPv6(ip);
  }

  return true;
}

function isDisallowedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network / "this" network)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private-Use Networks - RFC 1918)
  if (b0 === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / Carrier-Grade NAT - RFC 6598)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-Local / Cloud Metadata - RFC 3927)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private-Use Networks - RFC 1918)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (b0 === 192 && b1 === 88 && parts[2] === 99) return true;

  // 192.168.0.0/16 (Private-Use Networks - RFC 1918)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Network Interconnect Device Benchmark Testing)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast - RFC 5771)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future Use / Broadcast 255.255.255.255)
  if (b0 >= 240) return true;

  return false;
}

function isDisallowedIPv6(ip: string): boolean {
  // Normalize IPv6 address
  const lower = ip.toLowerCase();

  // Unspecified (::)
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;

  // Loopback (::1)
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped or IPv4-compatible IPv6: ::ffff:x.x.x.x or ::x.x.x.x
  if (lower.includes(".")) {
    const lastPart = lower.split(":").pop();
    if (lastPart && net.isIP(lastPart) === 4) {
      return isDisallowedIPv4(lastPart);
    }
  }

  // Parse first hextet
  const segments = lower.split(":");
  const firstHextet = segments[0] || (segments[1] && segments[0] === "" ? segments[1] : "");
  const firstVal = Number.parseInt(firstHextet || "0", 16);

  if (!Number.isNaN(firstVal)) {
    // Unique-local addresses: fc00::/7 (covers fc00..fdff)
    if ((firstVal & 0xfe00) === 0xfc00) return true;

    // Link-local unicast: fe80::/10 (covers fe80..febf)
    if ((firstVal & 0xffc0) === 0xfe80) return true;

    // Site-local (deprecated RFC 3879): fec0::/10
    if ((firstVal & 0xffc0) === 0xfec0) return true;

    // Multicast: ff00::/8
    if ((firstVal & 0xff00) === 0xff00) return true;

    // Discard prefix: 100::/64
    if (firstVal === 0x0100) return true;

    // 6to4: 2002::/16 - embed IPv4 in bits 16..47
    if (firstVal === 0x2002) {
      const h1 = Number.parseInt(segments[1] || "0", 16);
      const h2 = Number.parseInt(segments[2] || "0", 16);
      if (!Number.isNaN(h1) && !Number.isNaN(h2)) {
        const b0 = (h1 >> 8) & 0xff;
        const b1 = h1 & 0xff;
        const b2 = (h2 >> 8) & 0xff;
        const b3 = h2 & 0xff;
        const embeddedIp = `${b0}.${b1}.${b2}.${b3}`;
        if (isDisallowedIPv4(embeddedIp)) return true;
      }
    }

    // Documentation: 2001:db8::/32
    if (firstVal === 0x2001 && lower.includes("2001:db8:")) return true;

    // Benchmarking: 2001:2::/48
    if (firstVal === 0x2001 && (lower.includes("2001:2:") || lower.startsWith("2001:2::"))) return true;

    // Orchid / Orchidv2: 2001:20::/28
    if (firstVal === 0x2001 && (lower.includes("2001:20:") || lower.includes("2001:21:"))) return true;

    // Teredo: 2001::/32
    if (firstVal === 0x2001 && (lower.startsWith("2001:0:") || lower.startsWith("2001::"))) return true;
  }

  return false;
}

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB

/**
 * Resolves a hostname to IP addresses and returns the first safe IP,
 * throwing if any resolved address is in a prohibited private range.
 */
async function resolveSafeIp(rawHostname: string): Promise<{ address: string; family: number }> {
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new Error(`Forbidden destination IP address: ${hostname}`);
    }
    return { address: hostname, family: net.isIP(hostname) };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`No DNS records found for ${hostname}`);
  }

  // Reject immediately if ANY resolved record is private or disallowed
  for (const record of addresses) {
    if (isDisallowedIp(record.address)) {
      throw new Error(`DNS resolved to prohibited IP address: ${record.address}`);
    }
  }

  return { address: addresses[0].address, family: addresses[0].family };
}

/**
 * Performs a single HTTP or HTTPS probe to a URL pinned to a validated IP.
 */
function probePinned(
  targetUrl: URL,
  pinnedIp: { address: string; family: number },
  method: "HEAD" | "GET",
  timeoutMs: number,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const agent = new transport.Agent({
      keepAlive: false,
      lookup: (_hostname, _opts, cb) => {
        cb(null, pinnedIp.address, pinnedIp.family);
      },
    });

    const port = targetUrl.port ? Number.parseInt(targetUrl.port, 10) : isHttps ? 443 : 80;

    const req = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port,
        path: targetUrl.pathname + targetUrl.search,
        method,
        agent,
        headers: {
          "User-Agent": "Ziki-Marketing-Verifier/1.0",
          Accept: "*/*",
          Host: targetUrl.host,
        },
      },
      (res) => {
        let bytesRead = 0;
        res.on("data", (chunk: Buffer) => {
          bytesRead += chunk.length;
          if (bytesRead > MAX_BODY_BYTES) {
            req.destroy();
          }
        });

        res.on("end", () => {
          agent.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers });
        });

        res.on("error", (err) => {
          agent.destroy();
          reject(err);
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Probe timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      agent.destroy();
      reject(err);
    });

    req.end();
  });
}

/**
 * Verifies a single candidate published URL for reachability and public accessibility.
 * Enforces strict SSRF protections, DNS connection pinning, redirect limits, and timeouts.
 */
export async function verifyUrl(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<UrlVerificationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  const checkedAt = new Date().toISOString();

  let currentUrlString = rawUrl.trim();
  let redirectCount = 0;
  let finalIp: string | null = null;
  let method: "HEAD" | "GET" = "HEAD";

  try {
    while (redirectCount <= MAX_REDIRECTS) {
      let currentUrl: URL;
      try {
        currentUrl = new URL(currentUrlString);
      } catch {
        return {
          url: rawUrl,
          ok: false,
          status: null,
          ip: null,
          latencyMs: Date.now() - startTime,
          method,
          redirectCount,
          error: "Invalid URL format",
          checkedAt,
        };
      }

      if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
        return {
          url: rawUrl,
          ok: false,
          status: null,
          ip: null,
          latencyMs: Date.now() - startTime,
          method,
          redirectCount,
          error: `Unsupported protocol: ${currentUrl.protocol}`,
          checkedAt,
        };
      }

      const elapsed = Date.now() - startTime;
      const remainingTimeout = timeoutMs - elapsed;
      if (remainingTimeout <= 0) {
        return {
          url: rawUrl,
          ok: false,
          status: null,
          ip: finalIp,
          latencyMs: elapsed,
          method,
          redirectCount,
          error: `Overall verification timed out after ${timeoutMs}ms`,
          checkedAt,
        };
      }

      const safeIp = await resolveSafeIp(currentUrl.hostname);
      finalIp = safeIp.address;

      let probeRes = await probePinned(currentUrl, safeIp, "HEAD", remainingTimeout);

      // If HEAD returns 405 Method Not Allowed, fallback to bounded GET
      if (probeRes.status === 405) {
        method = "GET";
        const getRemainingTimeout = timeoutMs - (Date.now() - startTime);
        if (getRemainingTimeout > 0) {
          probeRes = await probePinned(currentUrl, safeIp, "GET", getRemainingTimeout);
        }
      }

      const status = probeRes.status;

      // Check for redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(status) && probeRes.headers.location) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          return {
            url: rawUrl,
            ok: false,
            status,
            ip: finalIp,
            latencyMs: Date.now() - startTime,
            method,
            finalUrl: currentUrlString,
            redirectCount,
            error: `Exceeded maximum redirect limit of ${MAX_REDIRECTS}`,
            checkedAt,
          };
        }

        const nextUrl = new URL(probeRes.headers.location, currentUrl).toString();
        currentUrlString = nextUrl;
        continue;
      }

      // Final response reached
      const isSuccess = status >= 200 && status < 300;
      return {
        url: rawUrl,
        ok: isSuccess,
        status,
        ip: finalIp,
        latencyMs: Date.now() - startTime,
        method,
        finalUrl: currentUrlString !== rawUrl ? currentUrlString : undefined,
        redirectCount,
        checkedAt,
      };
    }

    return {
      url: rawUrl,
      ok: false,
      status: null,
      ip: finalIp,
      latencyMs: Date.now() - startTime,
      method,
      redirectCount,
      error: `Exceeded maximum redirect limit of ${MAX_REDIRECTS}`,
      checkedAt,
    };
  } catch (err) {
    return {
      url: rawUrl,
      ok: false,
      status: null,
      ip: finalIp,
      latencyMs: Date.now() - startTime,
      method,
      redirectCount,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

/**
 * Verifies an array of candidate published URLs.
 */
export async function verifyPublishedUrls(
  urls: string[],
  options: { timeoutMs?: number } = {},
): Promise<BatchVerificationResult> {
  if (!urls || urls.length === 0) {
    return { allOk: false, results: [] };
  }

  const results = await Promise.all(urls.map((url) => verifyUrl(url, options)));
  const allOk = results.length > 0 && results.every((r) => r.ok);

  return { allOk, results };
}
