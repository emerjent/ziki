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

/**
 * Parses and normalizes an IPv6 address string into an 8-element array of 16-bit integers.
 * Handles compressed (::), expanded, uppercase/lowercase, and dotted or hex embedded IPv4 formats.
 */
export function parseIPv6(rawIp: string): number[] | null {
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) {
    ip = ip.slice(1, -1);
  }

  // Handle embedded IPv4 at the end (e.g. ::ffff:192.168.1.1 or 64:ff9b::127.0.0.1)
  const lastColon = ip.lastIndexOf(":");
  if (lastColon !== -1) {
    const afterColon = ip.slice(lastColon + 1);
    if (afterColon.includes(".")) {
      const v4Parts = afterColon.split(".").map((p) => Number.parseInt(p, 10));
      if (v4Parts.length !== 4 || v4Parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
        return null;
      }
      const h6 = (v4Parts[0] << 8) | v4Parts[1];
      const h7 = (v4Parts[2] << 8) | v4Parts[3];
      const prefix = ip.slice(0, lastColon);
      ip = `${prefix}:${h6.toString(16)}:${h7.toString(16)}`;
    }
  }

  const doubleColonParts = ip.split("::");
  if (doubleColonParts.length > 2) {
    return null;
  }

  let hextets: number[];
  if (doubleColonParts.length === 2) {
    const leftStr = doubleColonParts[0];
    const rightStr = doubleColonParts[1];
    const left = leftStr.length > 0 ? leftStr.split(":").map((h) => Number.parseInt(h, 16)) : [];
    const right = rightStr.length > 0 ? rightStr.split(":").map((h) => Number.parseInt(h, 16)) : [];
    if (left.some(Number.isNaN) || right.some(Number.isNaN)) {
      return null;
    }
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    hextets = [...left, ...new Array(missing).fill(0), ...right];
  } else {
    hextets = ip.split(":").map((h) => Number.parseInt(h, 16));
    if (hextets.length !== 8 || hextets.some(Number.isNaN)) {
      return null;
    }
  }

  if (hextets.length !== 8 || hextets.some((h) => h < 0 || h > 0xffff)) {
    return null;
  }

  return hextets;
}

function hextetsToBigInt(hextets: number[]): bigint {
  let val = BigInt(0);
  for (const h of hextets) {
    val = (val << BigInt(16)) | BigInt(h);
  }
  return val;
}

function matchCidr(ipBigInt: bigint, baseBigInt: bigint, prefixLen: number): boolean {
  const shift = BigInt(128 - prefixLen);
  return (ipBigInt >> shift) === (baseBigInt >> shift);
}

export function isDisallowedIPv6(rawIp: string): boolean {
  const hextets = parseIPv6(rawIp);
  if (!hextets) {
    return true; // Not a valid IPv6 address
  }

  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
  const ipBigInt = hextetsToBigInt(hextets);

  // Unspecified (::/128)
  if (matchCidr(ipBigInt, BigInt(0), 128)) return true;

  // Loopback (::1/128)
  if (matchCidr(ipBigInt, BigInt(1), 128)) return true;

  // IPv4-mapped IPv6 address (::ffff:0:0/96) in dotted or hex notation
  // (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or 0:0:0:0:0:ffff:7f00:0001)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    const embeddedIp = `${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`;
    return isDisallowedIPv4(embeddedIp);
  }

  // IPv4-translated (SIIT) (::ffff:0:0:0/96)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0) {
    const embeddedIp = `${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`;
    return isDisallowedIPv4(embeddedIp);
  }

  // IPv4-compatible IPv6 (deprecated RFC 4291) (::/96)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    const embeddedIp = `${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`;
    return isDisallowedIPv4(embeddedIp);
  }

  // NAT64 Well-Known Prefix (64:ff9b::/96 - RFC 6052)
  if (h0 === 0x0064 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    const embeddedIp = `${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`;
    return isDisallowedIPv4(embeddedIp);
  }

  // NAT64 Local-Use (64:ff9b:1::/48 - RFC 8215)
  if (matchCidr(ipBigInt, (BigInt(0x0064) << BigInt(112)) | (BigInt(0xff9b) << BigInt(96)) | (BigInt(0x0001) << BigInt(80)), 48)) {
    return true;
  }

  // 6to4 transition addresses (2002::/16 - RFC 3056)
  // Encapsulates IPv4 address in bits 16..47 (hextets h1 and h2)
  if (h0 === 0x2002) {
    const b0 = (h1 >> 8) & 0xff;
    const b1 = h1 & 0xff;
    const b2 = (h2 >> 8) & 0xff;
    const b3 = h2 & 0xff;
    const embeddedIp = `${b0}.${b1}.${b2}.${b3}`;
    return isDisallowedIPv4(embeddedIp);
  }

  // Teredo tunneling (2001:0000::/32 - RFC 4380)
  if (h0 === 0x2001 && h1 === 0x0000) {
    return true;
  }

  // Unique-Local Addresses ULA (fc00::/7 - RFC 4193, covers fc00..fdff)
  if (matchCidr(ipBigInt, BigInt(0xfc00) << BigInt(112), 7)) return true;

  // Link-Local Unicast (fe80::/10 - RFC 4291, covers fe80..febf)
  if (matchCidr(ipBigInt, BigInt(0xfe80) << BigInt(112), 10)) return true;

  // Site-Local Unicast (deprecated RFC 3879) (fec0::/10)
  if (matchCidr(ipBigInt, BigInt(0xfec0) << BigInt(112), 10)) return true;

  // Multicast (ff00::/8 - RFC 4291)
  if (matchCidr(ipBigInt, BigInt(0xff00) << BigInt(112), 8)) return true;

  // Discard-Only Prefix (100::/64 - RFC 6666)
  if (matchCidr(ipBigInt, BigInt(0x0100) << BigInt(112), 64)) return true;

  // Documentation (2001:db8::/32 - RFC 3849)
  if (matchCidr(ipBigInt, (BigInt(0x2001) << BigInt(112)) | (BigInt(0x0db8) << BigInt(96)), 32)) return true;

  // Benchmarking (2001:2::/48 - RFC 5180)
  if (matchCidr(ipBigInt, (BigInt(0x2001) << BigInt(112)) | (BigInt(0x0002) << BigInt(96)), 48)) return true;

  // Deprecated Direct Root Name Service (2001:10::/28)
  if (matchCidr(ipBigInt, (BigInt(0x2001) << BigInt(112)) | (BigInt(0x0010) << BigInt(96)), 28)) return true;

  // ORCHIDv2 (2001:20::/28 - RFC 7343)
  if (matchCidr(ipBigInt, (BigInt(0x2001) << BigInt(112)) | (BigInt(0x0020) << BigInt(96)), 28)) return true;

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
