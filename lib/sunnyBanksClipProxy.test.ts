import { describe, expect, it } from "vitest";
import {
  buildSunnyBanksClipProxyUrl,
  isAllowedSunnyBanksClipUrl,
  SUNNY_BANKS_CLIP_PROXY_PATH,
} from "./sunnyBanksClipProxy";

/**
 * This allowlist is the whole security boundary of the clip proxy — a
 * route that fetches whatever a query parameter names is an open proxy
 * into anything the deployment can reach. So the interesting tests are
 * the refusals, not the happy path.
 */
describe("isAllowedSunnyBanksClipUrl", () => {
  it("allows the two hosts this app actually streams clips from", () => {
    expect(
      isAllowedSunnyBanksClipUrl(
        "https://skidmarks.aiglitch.app/api/crash/mobile/clip?styleId=a&folderName=b&fileName=c.mp4"
      )
    ).toBe(true);
    expect(
      isAllowedSunnyBanksClipUrl(
        "https://abc123.public.blob.vercel-storage.com/sunnybanks/speak-beats/1-shazza.mp4"
      )
    ).toBe(true);
  });

  it("refuses anything else, including plausible-looking neighbours", () => {
    for (const url of [
      "https://example.com/clip.mp4",
      "https://aiglitch.app/clip.mp4",
      "https://deck.aiglitch.app/clip.mp4",
      "https://public.blob.vercel-storage.com/clip.mp4",
      "https://vercel-storage.com/clip.mp4",
    ]) {
      expect(isAllowedSunnyBanksClipUrl(url), url).toBe(false);
    }
  });

  it("refuses a hostname that merely ends with an allowed one", () => {
    // The classic suffix-match hole: without a dot anchor,
    // `notskidmarks.aiglitch.app` and an attacker-owned domain ending
    // in the blob suffix would both sail through.
    expect(isAllowedSunnyBanksClipUrl("https://notskidmarks.aiglitch.app/clip.mp4")).toBe(false);
    expect(
      isAllowedSunnyBanksClipUrl("https://evil.public.blob.vercel-storage.com.attacker.test/clip.mp4")
    ).toBe(false);
    expect(isAllowedSunnyBanksClipUrl("https://xpublic.blob.vercel-storage.com/clip.mp4")).toBe(false);
  });

  it("refuses userinfo used to disguise the real host", () => {
    // Reads as skidmarks.aiglitch.app at a glance; the real host is
    // attacker.test.
    expect(isAllowedSunnyBanksClipUrl("https://skidmarks.aiglitch.app@attacker.test/clip.mp4")).toBe(false);
    expect(isAllowedSunnyBanksClipUrl("https://user:pass@skidmarks.aiglitch.app/clip.mp4")).toBe(false);
  });

  it("refuses non-https schemes — no http, file, data, blob or gopher", () => {
    for (const url of [
      "http://skidmarks.aiglitch.app/clip.mp4",
      "file:///etc/passwd",
      "data:video/mp4;base64,AAAA",
      "blob:https://deck.aiglitch.app/abc",
      "gopher://skidmarks.aiglitch.app/",
    ]) {
      expect(isAllowedSunnyBanksClipUrl(url), url).toBe(false);
    }
  });

  it("refuses internal/loopback targets outright — SSRF is the whole risk here", () => {
    for (const url of [
      "https://127.0.0.1/clip.mp4",
      "https://localhost/clip.mp4",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/clip.mp4",
      "https://[::1]/clip.mp4",
    ]) {
      expect(isAllowedSunnyBanksClipUrl(url), url).toBe(false);
    }
  });

  it("refuses an explicit port, even on an allowed host", () => {
    expect(isAllowedSunnyBanksClipUrl("https://skidmarks.aiglitch.app:8080/clip.mp4")).toBe(false);
  });

  it("refuses garbage rather than throwing", () => {
    for (const url of ["", "   ", "not a url", "//skidmarks.aiglitch.app/clip.mp4"]) {
      expect(isAllowedSunnyBanksClipUrl(url), JSON.stringify(url)).toBe(false);
    }
  });

  it("is case-insensitive on the host, since DNS is", () => {
    expect(isAllowedSunnyBanksClipUrl("https://SKIDMARKS.AIGLITCH.APP/clip.mp4")).toBe(true);
  });
});

describe("buildSunnyBanksClipProxyUrl", () => {
  it("is same-origin and carries the target encoded, so no CORS rule applies", () => {
    const target = "https://skidmarks.aiglitch.app/api/crash/mobile/clip?fileName=a b&x=1";
    const proxied = buildSunnyBanksClipProxyUrl(target);
    expect(proxied.startsWith(`${SUNNY_BANKS_CLIP_PROXY_PATH}?url=`)).toBe(true);
    // The target's own query string must not leak into the proxy's.
    expect(proxied).not.toContain("&x=1");
    expect(new URLSearchParams(proxied.split("?")[1]).get("url")).toBe(target);
  });
});
