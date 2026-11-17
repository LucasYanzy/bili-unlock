// ==UserScript==
// @name         bili-unlock · B站解锁+加速
// @name:en      bili-unlock
// @namespace    https://github.com/LucasYanzy/bili-unlock
// @version      0.2.0
// @description  B站 海外看番：解除地区限制（通过代理）+ 播放加速
// @description:en Watch region-locked Bilibili shows from abroad via a proxy, with smoother playback.
// @author       LucasYanzy
// @license      MIT
// @homepageURL  https://github.com/LucasYanzy/bili-unlock
// @supportURL   https://github.com/LucasYanzy/bili-unlock/issues
// @match        https://*.bilibili.com/*
// @match        https://*.bilibili.tv/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/LucasYanzy/bili-unlock/main/dist/bili-unlock.user.js
// @downloadURL  https://raw.githubusercontent.com/LucasYanzy/bili-unlock/main/dist/bili-unlock.user.js
// ==/UserScript==

// ===== 内置 bilibili-accelerator v0.5.1 (MIT, © realzza) =====
// https://github.com/realzza/bilibili-accelerator
;(function () {


(function initBiliAcceleratorCore(root, factory) {
  const core = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = core;
  }

  root.BiliAcceleratorCore = core;
})(typeof globalThis !== "undefined" ? globalThis : window, function createCore() {
  "use strict";

  const SCHEMA_VERSION = 4;

  // Healthy UPOS mirrors we are willing to rewrite toward. The default target
  // is DEFAULT_CONFIG.pcdnHost and the auto-selection pool is CANDIDATE_POOL;
  // this list is the wider allowlist, and its first entry is only the last-ditch
  // fallback for a config whose pcdnHost has somehow been emptied.
  const CDN_HOSTS = Object.freeze([
    "upos-sz-mirrorcos.bilivideo.com",
    "upos-sz-mirrorali.bilivideo.com",
    "upos-sz-mirrorhw.bilivideo.com",
    "upos-tf-all-hw.bilivideo.com",
    "upos-tf-all-tx.bilivideo.com",
    "upos-hz-mirrorakam.akamaized.net",
    "upos-sz-mirrorakam.akamaized.net",
    "upos-sz-mirroraliov.bilivideo.com",
    "upos-sz-mirrorcosov.bilivideo.com",
    "upos-sz-mirrorhwov.bilivideo.com"
  ]);

  // Panel appearance options. Keys only — the actual accent hexes and dark/light
  // surface tokens live in the page UI; core just owns the allowed values so a
  // stored or bridged config can be validated back to a known-good default.
  const ACCENT_KEYS = Object.freeze([
    "bili",     // Bilibili blue (default — unchanged for existing users)
    "teal",
    "emerald",
    "violet",
    "pink",     // Little-TV pink
    "sunset",
    "graphite"
  ]);
  const THEME_MODES = Object.freeze(["system", "light", "dark"]);

  // UPOS mirrors a host swap can reach: every one accepts another UPOS host's
  // signed path. The routing engine races them, alongside the hosts Bilibili
  // issued, when the assigned host can't keep up; fixed selection offers them
  // as choices. Akamai is excluded because it rejects a swapped path with 403;
  // it is reachable only through the URL Bilibili issues for it.
  //
  // Both tiers belong here and measurements decide between them. Which host is
  // fast depends on the video: an overseas edge is fastest for a file other
  // overseas viewers have pulled and slowest while it relays one they haven't
  // (docs/vod-routing.md). Baking either geography into this list is the bug,
  // not the fix.
  const CANDIDATE_POOL = Object.freeze([
    "upos-sz-mirrorcosov.bilivideo.com",
    "upos-sz-mirroraliov.bilivideo.com",
    "upos-sz-mirrorhwov.bilivideo.com",
    "upos-sz-mirrorali.bilivideo.com",
    "upos-tf-all-hw.bilivideo.com",
    "upos-sz-mirrorhw.bilivideo.com",
    "upos-sz-mirrorcos.bilivideo.com",
    "upos-tf-all-tx.bilivideo.com"
  ]);

  const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    lang: "en",                                    // en | zh (UI language)
    accent: "bili",                                // panel accent (see ACCENT_KEYS)
    theme: "system",                               // system | light | dark surface
    mode: "bad-only",                              // bad-only | force | off
    selection: "auto",                             // auto | fixed
    // The fixed server, and in auto mode the host PCDN URLs are rewritten to
    // when Bilibili issued no proper CDN URL beside them.
    pcdnHost: "upos-sz-mirrorcosov.bilivideo.com",
    candidatePool: CANDIDATE_POOL.slice(),
    mcdnStrategy: "proxy-all",                      // proxy-all | proxy-v1 | replace
    proxyHost: "proxy-tf-all-ws.bilivideo.com",
    rewriteAkamai: false,
    portHeuristic: true,                           // non-default port ⇒ PCDN
    stallRecovery: true,                           // auto mode: switch servers on evidence
    p2pGuard: false,                               // opt-in WebRTC/PCDN neutralizer
    maxDepth: 20,
    schemaVersion: SCHEMA_VERSION
  });

  const MEDIA_PATH_RE = /\.(m4s|mp4|flv|m3u8)(?:$|[?#])/i;
  const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const XY_MCDN_RE = /^xy(?:\d+x){3}\d+xy\.mcdn\.bilivideo\.(?:cn|com|net)$/i;

  // P2P/PCDN families known from community research (Bilibili-Evolved, MBGTEB):
  // szbdyd is the legacy scheduler, mountaintoys the 2025 rename, nexusedgeio and
  // ahdohpiechei are where the upos-*302* redirect hosts land, and mirror14b is a
  // mirror-named host that actually serves PCDN (its TLS cert is *.bilivideo.cn).
  const KNOWN_P2P_SUFFIXES = Object.freeze([
    ".szbdyd.com",
    ".mountaintoys.cn",
    ".nexusedgeio.com",
    ".ahdohpiechei.com"
  ]);
  const KNOWN_P2P_HOSTS = Object.freeze([
    "upos-sz-mirror14b.bilivideo.com"
  ]);

  function isKnownP2pHost(hostname) {
    if (KNOWN_P2P_HOSTS.indexOf(hostname) !== -1) {
      return true;
    }
    for (let i = 0; i < KNOWN_P2P_SUFFIXES.length; i += 1) {
      if (hostname.length > KNOWN_P2P_SUFFIXES[i].length &&
          hostname.indexOf(KNOWN_P2P_SUFFIXES[i]) === hostname.length - KNOWN_P2P_SUFFIXES[i].length) {
        return true;
      }
    }
    // upos-sz-302ppio / upos-sz-302kodo style hosts answer with an HTTP 302 to a
    // residential P2P node; the "302" only ever appears in that first label.
    return hostname.indexOf("upos-") === 0 && hostname.split(".")[0].indexOf("302") !== -1;
  }

  // Forward-migrate any stored config (v1 or partial) onto the current defaults.
  function normalizeConfig(config) {
    // Read the version off the raw input: the merge below backfills it from
    // DEFAULT_CONFIG, which would make every stored config look current.
    const storedVersion = config && config.schemaVersion;
    const merged = Object.assign({}, DEFAULT_CONFIG, config || {});

    // v3 widened the candidate pool to take in the overseas mirrors. The pool is
    // not user-editable, so a stored copy is only ever an older default — and
    // since a non-empty array satisfies the check below, leaving it alone would
    // pin existing installs to the mainland-only pool permanently.
    if (!(storedVersion >= 3)) {
      merged.candidatePool = CANDIDATE_POOL.slice();
    }

    // v4 stopped writing routing decisions into the config. Under auto, 0.4.x
    // pointed pcdnHost at whatever the rotation had reached and saved it with
    // the next unrelated setting, so a saved auto config can carry a host
    // nobody chose. Fixed selection is the viewer's own choice and stays. Only
    // a config that carries a version is a saved one, so a host named in a
    // partial config is never second-guessed.
    if (typeof storedVersion === "number" && storedVersion < 4 && merged.selection !== "fixed") {
      merged.pcdnHost = DEFAULT_CONFIG.pcdnHost;
    }

    if (!Array.isArray(merged.candidatePool) || merged.candidatePool.length === 0) {
      merged.candidatePool = CANDIDATE_POOL.slice();
    }
    if (merged.mode !== "bad-only" && merged.mode !== "force" && merged.mode !== "off") {
      merged.mode = DEFAULT_CONFIG.mode;
    }
    if (merged.selection !== "auto" && merged.selection !== "fixed") {
      merged.selection = DEFAULT_CONFIG.selection;
    }
    if (merged.lang !== "en" && merged.lang !== "zh") {
      merged.lang = DEFAULT_CONFIG.lang;
    }
    if (ACCENT_KEYS.indexOf(merged.accent) === -1) {
      merged.accent = DEFAULT_CONFIG.accent;
    }
    if (THEME_MODES.indexOf(merged.theme) === -1) {
      merged.theme = DEFAULT_CONFIG.theme;
    }
    merged.schemaVersion = SCHEMA_VERSION;
    return merged;
  }

  function hasBiliMediaSignal(value) {
    return typeof value === "string" &&
      (value.includes("bilivideo") ||
        value.includes("akamaized.net") ||
        value.includes("szbdyd.com") ||
        value.includes("mountaintoys") ||
        value.includes("nexusedgeio") ||
        value.includes("ahdohpiechei") ||
        value.includes("mcdn.bili") ||
        value.includes("os=mcdn") ||
        value.includes("/upgcxcode/") ||
        value.includes("/v1/resource/"));
  }

  function parseUrl(value) {
    if (!hasBiliMediaSignal(value)) {
      return null;
    }

    try {
      // Payloads occasionally carry protocol-relative URLs ("//host/path").
      const url = new URL(value.slice(0, 2) === "//" ? "https:" + value : value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }
      return url;
    } catch (_) {
      return null;
    }
  }

  function isMediaUrl(url) {
    return MEDIA_PATH_RE.test(url.pathname + url.search) ||
      url.pathname.startsWith("/upgcxcode/") ||
      url.pathname.startsWith("/v1/resource/");
  }

  // Live streams (/live-bvc/ FLV & HLS) are served by a separate CDN tier — the
  // VOD upos mirrors and the MCDN proxy cannot serve them, so a host swap or
  // proxy wrap would hard-break live playback. Live PCDN is handled upstream by
  // filtering the getRoomPlayInfo host list instead (see filterLiveUrlInfo).
  function isLiveMediaUrl(url) {
    return url.pathname.indexOf("/live-bvc/") !== -1;
  }

  function isMcdnHost(hostname) {
    return /\.mcdn\.bilivideo\.(?:cn|com|net)$/i.test(hostname);
  }

  function isBiliCdnHost(hostname) {
    return hostname.endsWith(".bilivideo.com") ||
      hostname.endsWith(".bilivideo.cn") ||
      hostname.endsWith(".bilivideo.net") ||
      hostname.endsWith(".akamaized.net");
  }

  function hasNonDefaultPort(url) {
    // URL drops the port when it matches the protocol default (80/443), so any
    // remaining port string means a non-standard endpoint — a strong PCDN tell.
    return url.port !== "" && url.port !== "80" && url.port !== "443";
  }

  function hasMcdnQuery(url) {
    return url.searchParams.get("os") === "mcdn" || /(?:^|[?&])os=mcdn(?:&|$)/i.test(url.search);
  }

  // Single source of truth for "what is this host, and is it slow for us".
  // Behavior-based so renamed PCDN families (e.g. *.edge.mountaintoys.cn) are
  // caught by the port/os=mcdn heuristics without needing a hostname update.
  function classify(url, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const hostname = url.hostname.toLowerCase();

    let schedulerSource = null;
    if (hostname.endsWith(".szbdyd.com")) {
      schedulerSource = cleanHost(url.searchParams.get("xy_usource") || "") || null;
    }

    const ipLike = IP_RE.test(hostname);
    const xyMcdn = XY_MCDN_RE.test(hostname);
    const mcdn = isMcdnHost(hostname);
    const akamai = hostname.endsWith(".akamaized.net");
    const portPcdn = config.portHeuristic && hasNonDefaultPort(url);
    const queryMcdn = hasMcdnQuery(url);
    const knownP2p = isKnownP2pHost(hostname);

    const isPcdn = ipLike || xyMcdn || portPcdn || queryMcdn || knownP2p;

    let kind = "unknown";
    if (schedulerSource !== null || hostname.endsWith(".szbdyd.com")) {
      kind = "scheduler";
    } else if (mcdn) {
      kind = "mcdn";
    } else if (isPcdn) {
      kind = "pcdn";
    } else if (akamai) {
      kind = "akamai";
    } else if (hostname.startsWith("upos-") || hostname.endsWith(".bilivideo.com")) {
      kind = "upos";
    }

    // Only genuinely bad hosts are "slow": P2P/PCDN families, plus Akamai when a
    // user explicitly opts in. Bilibili's overseas UPOS mirrors (mirrorcosov /
    // mirroraliov / mirrorhwov) are deliberately NOT slow — this tool is for
    // overseas viewers, and those mirrors are the geographically-correct, fast
    // hosts for them. Rewriting them to a mainland host built a thin forward
    // buffer that Safari's background-tab throttling then starved into a stall.
    const isSlow = isPcdn || (config.rewriteAkamai && akamai);

    return {
      host: hostname,
      port: url.port || "",
      kind,
      isPcdn,
      isMcdn: mcdn,
      isAkamai: akamai,
      isSlow,
      schedulerSource
    };
  }

  function cleanHost(host) {
    const trimmed = String(host || "").trim();
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }

  function replaceHost(url, host) {
    const next = new URL(url.toString());
    next.protocol = "https:";
    next.host = cleanHost(host);
    if (!cleanHost(host).includes(":")) {
      next.port = "";
    }
    return next.toString();
  }

  function proxyUrl(url, config) {
    const next = new URL("https://" + cleanHost(config.proxyHost) + "/");
    next.searchParams.set("url", url.toString());
    return next.toString();
  }

  function shouldProxyMcdn(verdict, url, config) {
    if (!verdict.isMcdn) {
      return false;
    }
    if (config.mcdnStrategy === "proxy-all") {
      return true;
    }
    return config.mcdnStrategy === "proxy-v1" && url.pathname.startsWith("/v1/resource/");
  }

  // The host to rewrite slow UPOS/PCDN URLs toward: the fixed server, or in
  // auto mode the default target (the page script passes it in).
  function selectTarget(config) {
    return cleanHost(config.pcdnHost) || CDN_HOSTS[0];
  }

  function rewriteUrlDetail(value, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const original = String(value || "");
    const url = parseUrl(original);

    if (!config.enabled || config.mode === "off" || !url || !isMediaUrl(url) ||
        url.hostname === cleanHost(config.proxyHost)) {
      return { changed: false, original, url: original, reason: "ignored" };
    }

    if (isLiveMediaUrl(url)) {
      return { changed: false, original, url: original, reason: "live-skip" };
    }

    const verdict = classify(url, config);

    if (verdict.schedulerSource) {
      const rewritten = replaceHost(url, verdict.schedulerSource);
      return {
        changed: rewritten !== original,
        original,
        url: rewritten,
        reason: "szbdyd-source",
        targetHost: cleanHost(verdict.schedulerSource)
      };
    }

    if (shouldProxyMcdn(verdict, url, config)) {
      const rewritten = proxyUrl(url, config);
      return {
        changed: rewritten !== original,
        original,
        url: rewritten,
        reason: "mcdn-proxy",
        targetHost: cleanHost(config.proxyHost)
      };
    }

    // Force mode rewrites every bili CDN host onto the fixed server, overseas
    // mirrors included: that is what a viewer who picks one server and "all
    // video requests" asks for. Auto selection never runs in force mode; the
    // page script hands this function a bad-only config there.
    const force = config.mode === "force";
    if (verdict.isSlow || verdict.isMcdn || (force && isBiliCdnHost(url.hostname))) {
      const target = selectTarget(config);
      const rewritten = replaceHost(url, target);
      return {
        changed: rewritten !== original,
        original,
        url: rewritten,
        reason: verdict.isPcdn ? "pcdn-host" : (verdict.isMcdn ? "mcdn-host" : "cdn-host"),
        targetHost: target
      };
    }

    return { changed: false, original, url: original, reason: "ok" };
  }

  function rewriteUrl(value, config) {
    return rewriteUrlDetail(value, config).url;
  }

  // Convert a transferred byte count over a duration into megabits per second.
  // Pure so the speed meter's math stays unit-tested.
  function throughputMbps(bytes, durationMs) {
    if (!(bytes > 0) || !(durationMs > 0)) {
      return 0;
    }
    return (bytes * 8 / 1e6) / (durationMs / 1000);
  }

  // Total length of a set of [start, end] intervals with overlaps merged, so
  // two segments downloaded in parallel count their shared time only once.
  function unionDurationMs(intervals) {
    if (!intervals || !intervals.length) {
      return 0;
    }
    const sorted = intervals.slice().sort(function byStart(a, b) {
      return a[0] - b[0];
    });
    let total = 0;
    let curStart = sorted[0][0];
    let curEnd = sorted[0][1];
    for (let i = 1; i < sorted.length; i += 1) {
      const s = sorted[i][0];
      const e = sorted[i][1];
      if (s > curEnd) {
        total += curEnd - curStart;
        curStart = s;
        curEnd = e;
      } else if (e > curEnd) {
        curEnd = e;
      }
    }
    total += curEnd - curStart;
    return total;
  }

  // Aggregate "active" throughput: bytes moved per second of time actually spent
  // transferring, measured over the trailing `windowMs`. Unlike dividing by
  // wall-clock, idle gaps between the player's burst downloads don't drag the
  // rate to zero — this reflects the link's real capacity. Bytes from transfers
  // straddling the window edge are prorated to the in-window fraction, and the
  // active time is the union of all transfer intervals (parallel video+audio
  // segments count their overlap once). transfers: [{ start, end, bytes }] in ms.
  function aggregateThroughput(transfers, now, windowMs) {
    if (!transfers || !transfers.length || !(windowMs > 0)) {
      return 0;
    }
    const windowStart = now - windowMs;
    let bytes = 0;
    const intervals = [];
    for (let i = 0; i < transfers.length; i += 1) {
      const tr = transfers[i];
      if (!tr || !(tr.bytes > 0) || !(tr.end > tr.start)) {
        continue;
      }
      const s = Math.max(tr.start, windowStart);
      const e = Math.min(tr.end, now);
      if (e <= s) {
        continue;
      }
      bytes += tr.bytes * ((e - s) / (tr.end - tr.start));
      intervals.push([s, e]);
    }
    return throughputMbps(bytes, unionDurationMs(intervals));
  }

  // Bare host[:port] of a URL, for diagnostics that must never carry the query
  // string — segment URLs pack the viewer's mid, buvid, IP-derived oi and signed
  // access tokens there, and the report is meant to be shared. "" on failure.
  function hostOf(value) {
    try {
      return new URL(String(value)).host;
    } catch (_) {
      return "";
    }
  }

  // Pure ranking of probed hosts. samples: [{host, ttfb:number|null,
  // mbps?:number, ok:bool}]. Healthy hosts first; failures sink to the bottom.
  //
  // Transfer rate decides when it was measured, and TTFB only breaks ties. Time
  // to first byte is mostly RTT, and on these hosts it swings about tenfold
  // between back-to-back samples of the same host — ranking on it let a mainland
  // mirror that answered headers promptly outrank an overseas one that actually
  // moves 3-4x the bytes. What a stalling player needs is sustained throughput.
  function rankHosts(samples) {
    return (samples || [])
      .slice()
      .sort(function compare(a, b) {
        const aOk = a.ok && (typeof a.mbps === "number" || typeof a.ttfb === "number");
        const bOk = b.ok && (typeof b.mbps === "number" || typeof b.ttfb === "number");
        if (aOk !== bOk) {
          return aOk ? -1 : 1;
        }
        if (!aOk) {
          return 0;
        }
        const aRate = typeof a.mbps === "number" ? a.mbps : 0;
        const bRate = typeof b.mbps === "number" ? b.mbps : 0;
        if (aRate !== bRate) {
          return bRate - aRate;
        }
        const aLat = typeof a.ttfb === "number" ? a.ttfb : Infinity;
        const bLat = typeof b.ttfb === "number" ? b.ttfb : Infinity;
        return aLat - bLat;
      })
      .map(function pickHost(sample) {
        return cleanHost(sample.host);
      });
  }

  function rewriteObject(value, rawConfig, state, depth, seen) {
    const config = normalizeConfig(rawConfig);
    const tracker = state || { changed: false, rewrites: [] };
    const level = depth || 0;
    const visited = seen || new WeakSet();

    if (!config.enabled || value == null || level > config.maxDepth) {
      return value;
    }

    if (typeof value === "string") {
      const detail = rewriteUrlDetail(value, config);
      if (detail.changed) {
        tracker.changed = true;
        tracker.rewrites.push(detail);
      }
      return detail.url;
    }

    if (typeof value !== "object") {
      return value;
    }

    if (visited.has(value)) {
      return value;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        value[index] = rewriteObject(value[index], config, tracker, level + 1, visited);
      }
      return value;
    }

    for (const key of Object.keys(value)) {
      value[key] = rewriteObject(value[key], config, tracker, level + 1, visited);
    }

    return value;
  }

  // Live playurl payloads (getRoomPlayInfo) don't carry full media URLs — each
  // stream/format/codec entry lists candidate hosts in url_info: [{host, extra}].
  // A host like "https://xy…xy.mcdn.bilivideo.cn:486" is a residential PCDN node;
  // slow for overseas viewers. This decides "is this live host slow" from the
  // same behavioral signals as classify(), minus the media-path requirement.
  function isSlowLiveHost(hostValue, extra, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const raw = String(hostValue || "");
    let url;
    try {
      url = new URL(raw.indexOf("://") !== -1 ? raw : "https://" + raw.replace(/^\/\//, ""));
    } catch (_) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    if (IP_RE.test(hostname) || XY_MCDN_RE.test(hostname) ||
        isMcdnHost(hostname) || isKnownP2pHost(hostname)) {
      return true;
    }
    if (config.portHeuristic && hasNonDefaultPort(url)) {
      return true;
    }
    return typeof extra === "string" && /(?:^|[?&])os=mcdn(?:&|$)/i.test(extra);
  }

  // Drop PCDN/MCDN entries from live url_info host lists, keeping the official
  // CDN entries the player can fail over to. Never removes the last usable host:
  // if every entry looks slow, the list is left untouched. Returns rewrite-shaped
  // entries ({original, url, reason}) so callers can log them like URL rewrites.
  function filterLiveUrlInfo(payload, rawConfig, depth, seen) {
    const config = normalizeConfig(rawConfig);
    const level = depth || 0;
    const visited = seen || new WeakSet();
    const result = { changed: false, rewrites: [] };

    if (!config.enabled || config.mode === "off" ||
        payload == null || typeof payload !== "object" ||
        level > config.maxDepth || visited.has(payload)) {
      return result;
    }
    visited.add(payload);

    const list = payload.url_info;
    if (Array.isArray(list) && list.length > 1 &&
        list.every(function (item) { return item && typeof item.host === "string"; })) {
      const kept = list.filter(function (item) {
        return !isSlowLiveHost(item.host, item.extra, config);
      });
      if (kept.length > 0 && kept.length < list.length) {
        list.forEach(function (item) {
          if (kept.indexOf(item) === -1) {
            result.rewrites.push({
              changed: true,
              original: item.host,
              url: kept[0].host,
              reason: "live-pcdn-filter"
            });
          }
        });
        list.length = 0;
        kept.forEach(function (item) { list.push(item); });
        result.changed = true;
      }
    }

    const keys = Array.isArray(payload)
      ? payload.map(function (_, i) { return i; })
      : Object.keys(payload);
    for (let i = 0; i < keys.length; i += 1) {
      const child = filterLiveUrlInfo(payload[keys[i]], config, level + 1, visited);
      if (child.changed) {
        result.changed = true;
        result.rewrites = result.rewrites.concat(child.rewrites);
      }
    }
    return result;
  }

  function rewriteJsonText(text, rawConfig) {
    const state = { changed: false, rewrites: [] };
    const parsed = JSON.parse(text);
    rewriteObject(parsed, rawConfig, state);

    return {
      changed: state.changed,
      text: state.changed ? JSON.stringify(parsed) : text,
      value: parsed,
      rewrites: state.rewrites
    };
  }

  return {
    SCHEMA_VERSION,
    CDN_HOSTS,
    CANDIDATE_POOL,
    ACCENT_KEYS,
    THEME_MODES,
    DEFAULT_CONFIG,
    normalizeConfig,
    hasMediaSignal: hasBiliMediaSignal,
    classify,
    isSlowLiveHost,
    filterLiveUrlInfo,
    selectTarget,
    throughputMbps,
    unionDurationMs,
    aggregateThroughput,
    hostOf,
    rankHosts,
    rewriteJsonText,
    rewriteObject,
    rewriteUrl,
    rewriteUrlDetail
  };
});

(function initBiliAcceleratorRouting(root, factory) {
  const routing = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = routing;
  }

  root.BiliAcceleratorRouting = routing;
})(typeof globalThis !== "undefined" ? globalThis : window, function createRouting() {
  "use strict";

  // The decisions behind VOD host routing, kept free of DOM and network so
  // they can be unit-tested. docs/vod-routing.md explains the numbers; the
  // page script feeds these functions what the player actually downloads.

  // How much of a fragment a race fetches from each contender. Big enough to
  // show a relaying edge for what it is, small enough that a race costs well
  // under a second of 1080P+ video per host.
  const RACE_BYTES = 768 * 1024;
  const RACE_TIMEOUT_MS = 4000;

  // Shaka Player's estimator settings: a sample needs 16 KB to count, the
  // estimate needs 128 KB in total, and the lower of a 2 s and a 5 s average
  // is used so it falls fast and recovers slowly.
  const EWMA_FAST_HALF_LIFE_S = 2;
  const EWMA_SLOW_HALF_LIFE_S = 5;
  const MIN_SAMPLE_BYTES = 16000;
  const MIN_TOTAL_BYTES = 128000;

  // A fragment in flight is "stuck" when it will finish after the buffer runs
  // out. Judge it only after it has shown a rate, and never on init or index
  // requests, which are a few KB.
  const STUCK_MIN_FRAGMENT_BYTES = 128 * 1024;
  const STUCK_MIN_TRANSFER_MS = 500;
  const STUCK_NO_FIRST_BYTE_MS = 1000;
  const STUCK_URGENT_BUFFER_S = 3;
  const STUCK_RATE_FACTOR = 1.3;
  const STUCK_MIN_REMAINING_MS = 1000;
  const STUCK_MARGIN_MS = 2000;

  // Sustained shortfall: measured goodput can't grow the buffer, and the
  // buffer is low enough that it matters.
  const SHORTFALL_RATE_FACTOR = 1.2;
  const SHORTFALL_MIN_BYTES = 4 * 1024 * 1024;
  const SHORTFALL_MIN_MS = 8000;
  const SHORTFALL_BUFFER_S = 30;

  const ERROR_WINDOW_MS = 30000;
  const ERROR_LIMIT = 2;

  // A challenger has to deliver the race bytes in two-thirds of the time the
  // current host needs for them. Races run on fresh connections, which
  // understates a mainland mirror's warm speed, so the margin is kept modest
  // and the new host's own traffic decides whether it keeps up.
  const SWITCH_GAIN = 1.5;
  const MAX_SWITCHES = 4;
  const SWITCH_BACKOFF_MS = 10000;
  const NO_SWITCH_COOLDOWN_MS = 15000;
  const MAX_COOLDOWN_MS = 120000;
  const LOST_RACE_REST_MS = 60000;

  const HISTORY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
  const RECENT_FAILURE_MS = 60 * 60 * 1000;
  const EXPLORE_RATE = 0.2;
  const UNKNOWN_HOST_MBPS = 10;

  const AUDIO_ID_RE = /^30(2\d\d|25\d)$/;

  // ---- fragment identity ---------------------------------------------------

  // The file name identifies the same bytes on every host: issued URLs and
  // host swaps share the path, and only the query (the signature) differs.
  function fileKey(value) {
    let url;
    try {
      url = new URL(String(value || ""));
    } catch (_) {
      return null;
    }
    const name = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    return /\.(m4s|mp4|flv)$/i.test(name) ? name : null;
  }

  // "42231991605-1-30102.m4s" and "42242147914_qe1-1-30032.m4s" -> the cid.
  function cidOf(key) {
    const m = /^(\d+)/.exec(String(key || ""));
    return m ? m[1] : null;
  }

  function repIdOf(key) {
    const m = /-(\d+)\.(?:m4s|mp4|flv)$/i.exec(String(key || ""));
    return m ? m[1] : null;
  }

  function parseRange(value) {
    const m = /bytes=(\d+)-(\d*)/i.exec(String(value || ""));
    if (!m) {
      return null;
    }
    const start = Number(m[1]);
    const end = m[2] === "" ? NaN : Number(m[2]);
    return { start, end, length: isNaN(end) ? NaN : end - start + 1 };
  }

  function hostOf(value) {
    try {
      return new URL(String(value)).host.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  // ---- the session table ----------------------------------------------------

  function dashContainers(payload) {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    return [payload.data, payload.result, payload.result && payload.result.video_info, payload]
      .filter(function (c) { return c && typeof c === "object" && c.dash && typeof c.dash === "object"; })
      .map(function (c) { return c.dash; });
  }

  // For every representation in a DASH playurl: its bitrate and the URL each
  // issued host was given for it, signature included. isUsable() lets the
  // caller keep PCDN and MCDN entries out; the table only ever routes toward
  // hosts Bilibili issued or UPOS mirrors that accept their signature.
  function buildTable(payload, isUsable) {
    const table = { cid: null, reps: {} };
    dashContainers(payload).forEach(function eachDash(dash) {
      const groups = [["video", dash.video], ["audio", dash.audio]];
      if (dash.dolby && Array.isArray(dash.dolby.audio)) {
        groups.push(["audio", dash.dolby.audio]);
      }
      if (dash.flac && dash.flac.audio) {
        groups.push(["audio", [dash.flac.audio]]);
      }
      groups.forEach(function eachGroup(group) {
        const kind = group[0];
        (Array.isArray(group[1]) ? group[1] : []).forEach(function eachRep(entry) {
          if (!entry || typeof entry !== "object") {
            return;
          }
          const base = entry.baseUrl || entry.base_url;
          const backups = entry.backupUrl || entry.backup_url || [];
          const urls = [base].concat(Array.isArray(backups) ? backups : []).filter(function (u) {
            return typeof u === "string";
          });
          const key = urls.map(fileKey).filter(Boolean)[0];
          if (!key) {
            return;
          }
          const rep = table.reps[key] || {
            key,
            id: entry.id,
            kind,
            bandwidth: Number(entry.bandwidth) || 0,
            codecs: entry.codecs || "",
            urls: {},
            issued: []
          };
          urls.forEach(function eachUrl(u) {
            const host = hostOf(u);
            if (!host || fileKey(u) !== key || (isUsable && !isUsable(u))) {
              return;
            }
            if (!rep.urls[host]) {
              rep.urls[host] = u;
              rep.issued.push(host);
            }
          });
          table.reps[key] = rep;
          table.cid = table.cid || cidOf(key);
        });
      });
    });
    return Object.keys(table.reps).length ? table : null;
  }

  function isAkamai(host) {
    return /\.akamaized\.net$/i.test(host || "");
  }

  // A UPOS mirror accepts any other UPOS host's signed path; Akamai accepts only
  // the URL issued for it.
  function isUposHost(host) {
    return /^upos-[a-z0-9-]+\.bilivideo\.com$/i.test(host || "");
  }

  // The URL of a representation's bytes on `host`: its own issued URL if it has
  // one, else a host swap of an issued UPOS URL. null when neither exists.
  function urlFor(rep, host) {
    if (!rep || !host) {
      return null;
    }
    if (rep.urls[host]) {
      return rep.urls[host];
    }
    if (!isUposHost(host)) {
      return null;
    }
    const source = rep.issued.filter(isUposHost).map(function (h) { return rep.urls[h]; })[0];
    if (!source) {
      return null;
    }
    try {
      const next = new URL(source);
      next.host = host;
      return next.toString();
    } catch (_) {
      return null;
    }
  }

  // Every host a representation can be fetched from: what Bilibili issued,
  // then the pool mirrors a swap can reach.
  function candidatesFor(rep, pool) {
    if (!rep) {
      return [];
    }
    const out = rep.issued.slice();
    (pool || []).forEach(function (h) {
      const host = String(h || "").toLowerCase();
      if (host && out.indexOf(host) === -1 && urlFor(rep, host)) {
        out.push(host);
      }
    });
    return out;
  }

  // ---- goodput --------------------------------------------------------------

  function createEwma(halfLifeS) {
    const alpha = Math.exp(Math.log(0.5) / halfLifeS);
    let estimate = 0;
    let totalWeight = 0;
    return {
      sample: function (weight, value) {
        const adjAlpha = Math.pow(alpha, weight);
        estimate = value * (1 - adjAlpha) + adjAlpha * estimate;
        totalWeight += weight;
      },
      get: function () {
        const zeroFactor = 1 - Math.pow(alpha, totalWeight);
        return zeroFactor > 0 ? estimate / zeroFactor : 0;
      }
    };
  }

  // Bits per second the player got from one host, from whole requests: bytes
  // over the time from send to the last byte, first-byte wait included, since
  // the player pays for that on every fragment.
  function createEstimator() {
    const fast = createEwma(EWMA_FAST_HALF_LIFE_S);
    const slow = createEwma(EWMA_SLOW_HALF_LIFE_S);
    let bytes = 0;
    let ms = 0;
    return {
      sample: function (durationMs, numBytes) {
        if (!(durationMs > 0) || !(numBytes >= MIN_SAMPLE_BYTES)) {
          return false;
        }
        const bps = 8000 * numBytes / durationMs;
        fast.sample(durationMs / 1000, bps);
        slow.sample(durationMs / 1000, bps);
        bytes += numBytes;
        ms += durationMs;
        return true;
      },
      estimate: function () {
        return bytes >= MIN_TOTAL_BYTES ? Math.min(fast.get(), slow.get()) : null;
      },
      bytes: function () { return bytes; },
      ms: function () { return ms; }
    };
  }

  // Rate over the recent part of an in-flight transfer, from progress samples
  // [[timeMs, loadedBytes], ...]. Falls back to the whole transfer when the
  // window holds a single sample.
  function recentRate(samples, now, windowMs) {
    if (!samples || !samples.length) {
      return 0;
    }
    const last = samples[samples.length - 1];
    let first = samples[0];
    for (let i = samples.length - 1; i >= 0; i -= 1) {
      if (now - samples[i][0] <= windowMs) {
        first = samples[i];
      } else {
        break;
      }
    }
    if (first === last) {
      first = samples[0];
    }
    const dt = last[0] - first[0];
    return dt > 0 ? 8000 * (last[1] - first[1]) / dt : 0;
  }

  // ---- when to act ----------------------------------------------------------

  // A fragment request in flight, judged against the buffer it has to beat.
  //   req: { total, loaded, startedAt, firstByteAt, rateBps }
  function stuckVerdict(req, now, requiredBps, bufferAheadS) {
    if (!req || !(req.total >= STUCK_MIN_FRAGMENT_BYTES) || !(requiredBps > 0)) {
      return null;
    }
    const bufferMs = Math.max(0, bufferAheadS || 0) * 1000;
    if (!req.firstByteAt) {
      const waited = now - req.startedAt;
      if (waited >= STUCK_NO_FIRST_BYTE_MS && bufferAheadS < STUCK_URGENT_BUFFER_S) {
        return { reason: "no-first-byte", waitedMs: waited };
      }
      return null;
    }
    const transferMs = now - req.firstByteAt;
    if (transferMs < STUCK_MIN_TRANSFER_MS && req.loaded < STUCK_MIN_FRAGMENT_BYTES) {
      return null;
    }
    const rate = req.rateBps > 0 ? req.rateBps : (transferMs > 0 ? 8000 * req.loaded / transferMs : 0);
    const remainingMs = rate > 0 ? (req.total - req.loaded) * 8000 / rate : Infinity;
    if (rate < STUCK_RATE_FACTOR * requiredBps && remainingMs > STUCK_MIN_REMAINING_MS &&
        remainingMs > bufferMs - STUCK_MARGIN_MS) {
      return { reason: "slow-fragment", rateBps: rate, remainingMs };
    }
    return null;
  }

  // What, if anything, should start a race now.
  //   input: { now, requiredBps, bufferAheadS, inflight: [req], estimateBps,
  //            measuredBytes, measuredMs, recentErrors }
  function evaluate(input) {
    const i = input || {};
    if (!(i.requiredBps > 0)) {
      return null;
    }
    if (i.recentErrors >= ERROR_LIMIT) {
      return { trigger: "errors" };
    }
    const inflight = i.inflight || [];
    for (let k = 0; k < inflight.length; k += 1) {
      if (stuckVerdict(inflight[k], i.now, i.requiredBps, i.bufferAheadS)) {
        return { trigger: "stuck", req: inflight[k] };
      }
    }
    const enough = i.measuredBytes >= SHORTFALL_MIN_BYTES || i.measuredMs >= SHORTFALL_MIN_MS;
    if (enough && i.estimateBps != null && i.estimateBps < SHORTFALL_RATE_FACTOR * i.requiredBps &&
        i.bufferAheadS < SHORTFALL_BUFFER_S) {
      return { trigger: "shortfall" };
    }
    return null;
  }

  // ---- choosing -------------------------------------------------------------

  function historyScore(history, host) {
    const rec = history && history.hosts && history.hosts[host];
    return rec && rec.n > 0 ? rec.mbps : null;
  }

  function recentlyFailed(history, host, now) {
    const rec = history && history.hosts && history.hosts[host];
    return !!(rec && rec.lastFailAt && now - rec.lastFailAt < RECENT_FAILURE_MS);
  }

  // Two hosts to race against the current one. The other issued host comes
  // first until it has been measured this session: it is the player's own
  // alternative and sometimes the best. The rest go by history, with unknown
  // hosts scored as ordinary so they still get tried, and one pick in five
  // drawn at random so history keeps learning.
  //
  // Ties, which is every host before any history exists, go to mainland
  // mirrors. Bilibili assigns one overseas edge per region, so the overseas
  // mirrors it did not issue see little of that region's traffic and are cold,
  // while a mainland mirror sits next to origin and holds every file.
  //   input: { candidates, current, issued, measured, failed, lost, history,
  //            now, random }
  function pickChallengers(input) {
    const i = input || {};
    const now = i.now || 0;
    const rand = typeof i.random === "function" ? i.random : Math.random;
    const failed = i.failed || {};
    const lost = i.lost || {};
    const measured = i.measured || {};
    const pool = (i.candidates || []).filter(function (h) {
      return h && h !== i.current && !(failed[h] >= ERROR_LIMIT) &&
        !(lost[h] && now - lost[h] < LOST_RACE_REST_MS);
    });
    if (!pool.length) {
      return [];
    }
    const failedLately = function (h) { return recentlyFailed(i.history, h, now) ? 1 : 0; };
    // An unknown host counts as the lower median of the measured ones, so it
    // never outranks a host already measured as good.
    const known = pool.filter(function (h) { return !failedLately(h); })
      .map(function (h) { return historyScore(i.history, h); })
      .filter(function (s) { return s != null; }).sort(function (a, b) { return a - b; });
    const typical = known.length ? known[Math.floor((known.length - 1) / 2)] : UNKNOWN_HOST_MBPS;
    const score = function (h) {
      const s = historyScore(i.history, h);
      return s == null ? typical : s;
    };
    const overseas = function (h) { return describeHost(h).region === "overseas" ? 1 : 0; };
    // Hosts that failed within the hour go last, whatever they scored before.
    const ordered = pool.slice().sort(function (a, b) {
      return (failedLately(a) - failedLately(b)) || (score(b) - score(a)) || (overseas(a) - overseas(b));
    });
    const picks = [];
    (i.issued || []).forEach(function (h) {
      if (picks.length < 1 && pool.indexOf(h) !== -1 && !measured[h]) {
        picks.push(h);
      }
    });
    ordered.forEach(function (h) {
      if (picks.length < 2 && picks.indexOf(h) === -1) {
        picks.push(h);
      }
    });
    if (picks.length === 2 && rand() < EXPLORE_RATE) {
      const rest = pool.filter(function (h) { return picks.indexOf(h) === -1; });
      if (rest.length) {
        picks[1] = rest[Math.floor(rand() * rest.length) % rest.length];
      }
    }
    return picks;
  }

  // results: [{ host, ok, ms, bytes }]. The winner is the fastest complete
  // result; it replaces the current host only if it beat the time the current
  // host needs for the same bytes by SWITCH_GAIN.
  function raceVerdict(results, currentRateBps, raceBytes) {
    const done = (results || []).filter(function (r) { return r && r.ok && r.ms > 0; })
      .sort(function (a, b) { return a.ms - b.ms; });
    const bytes = raceBytes || RACE_BYTES;
    const currentMs = currentRateBps > 0 ? bytes * 8000 / currentRateBps : Infinity;
    if (!done.length) {
      return { winner: null, runnerUp: null, switchTo: null };
    }
    const winner = done[0];
    const better = winner.ms * SWITCH_GAIN <= currentMs;
    return {
      winner: winner.host,
      runnerUp: done[1] ? done[1].host : null,
      switchTo: better ? winner.host : null
    };
  }

  // A race for a stuck fragment answers two questions. The fragment goes to
  // the winner if the winner beats the stuck request. The video goes to the
  // winner only if it also beats what the current host has been delivering:
  // one request that hangs on a host that keeps up is a bad connection, not a
  // bad host (about one connection in ten to a mainland mirror takes 3 to 6 s
  // to set up). A host that already failed or hung within the error window
  // gets no credit for its past rate.
  //   returns raceVerdict's fields for the video, plus hostRateBps, the rate
  //   the video decision used, and retryOn: the host that takes just the stuck
  //   fragment while the video stays.
  function stuckRaceVerdict(results, stuckRateBps, sustainedBps, recentErrors, raceBytes) {
    const fragment = raceVerdict(results, stuckRateBps, raceBytes);
    const hostRateBps = recentErrors > 0 ? (stuckRateBps || 0) : Math.max(stuckRateBps || 0, sustainedBps || 0);
    const video = raceVerdict(results, hostRateBps, raceBytes);
    video.hostRateBps = hostRateBps;
    video.retryOn = !video.switchTo && fragment.switchTo ? fragment.switchTo : null;
    return video;
  }

  // Time before the next race: after a switch it doubles with each one; after
  // a race that changed nothing it doubles too, up to two minutes.
  function nextCooldown(kind, switches, previousMs) {
    if (kind === "switch") {
      return SWITCH_BACKOFF_MS * Math.pow(2, Math.max(0, switches - 1));
    }
    return Math.min(MAX_COOLDOWN_MS, previousMs ? previousMs * 2 : NO_SWITCH_COOLDOWN_MS);
  }

  // ---- history --------------------------------------------------------------

  function recordSample(history, host, mbps, now) {
    const h = history && typeof history === "object" ? history : {};
    h.hosts = h.hosts || {};
    const rec = h.hosts[host] || { mbps: 0, n: 0, at: now };
    const age = Math.max(0, now - (rec.at || now));
    const nEff = rec.n * Math.pow(0.5, age / HISTORY_HALF_LIFE_MS);
    rec.mbps = (rec.mbps * nEff + mbps) / (nEff + 1);
    rec.n = nEff + 1;
    rec.at = now;
    h.hosts[host] = rec;
    return h;
  }

  function recordFailure(history, host, now) {
    const h = history && typeof history === "object" ? history : {};
    h.hosts = h.hosts || {};
    const rec = h.hosts[host] || { mbps: 0, n: 0, at: now };
    rec.lastFailAt = now;
    h.hosts[host] = rec;
    return h;
  }

  // ---- labels ---------------------------------------------------------------

  const VENDORS = { cos: "tencent", ali: "alibaba", hw: "huawei", tx: "tencent", akam: "akamai" };

  // What a host is, for the panel: which side of the Pacific and whose cloud.
  function describeHost(host) {
    const h = String(host || "").toLowerCase();
    if (isAkamai(h)) {
      return { region: "overseas", vendor: "akamai", id: "akamai" };
    }
    let m = /^upos-[a-z]+-mirror([a-z0-9]+?)(ov)?\.bilivideo\.com$/.exec(h);
    if (m) {
      return { region: m[2] ? "overseas" : "mainland", vendor: VENDORS[m[1]] || null, id: m[1] + (m[2] || "") };
    }
    m = /^upos-tf-all-([a-z]+)\.bilivideo\.com$/.exec(h);
    if (m) {
      return { region: "mainland", vendor: VENDORS[m[1]] || null, id: "tf-" + m[1] };
    }
    return { region: null, vendor: null, id: h.split(".")[0] || h };
  }

  return {
    RACE_BYTES,
    RACE_TIMEOUT_MS,
    MAX_SWITCHES,
    ERROR_WINDOW_MS,
    SHORTFALL_RATE_FACTOR,
    SWITCH_GAIN,
    AUDIO_ID_RE,
    fileKey,
    cidOf,
    repIdOf,
    parseRange,
    dashContainers,
    buildTable,
    urlFor,
    candidatesFor,
    createEstimator,
    recentRate,
    stuckVerdict,
    evaluate,
    pickChallengers,
    raceVerdict,
    stuckRaceVerdict,
    nextCooldown,
    historyScore,
    recentlyFailed,
    recordSample,
    recordFailure,
    describeHost
  };
});

(function installBiliAccelerator(root) {
  "use strict";

  const core = root.BiliAcceleratorCore;
  const routing = root.BiliAcceleratorRouting;
  if (!core || !routing || root.__BILI_ACCELERATOR_INSTALLED__) {
    return;
  }
  root.__BILI_ACCELERATOR_INSTALLED__ = true;

  const VERSION = "0.5.1";
  const STORAGE_KEY = "biliAccelerator.config.v2";
  const LEGACY_KEY = "biliAccelerator.config.v1";
  // Per-host history of measured delivery, per region. It only orders the
  // hosts a race tries; nothing is ever picked from it without a race.
  const HISTORY_PREFIX = "biliAccelerator.hosts.v1.";
  // Rankings cached by 0.4.x. Nothing reads them any more.
  const LEGACY_RANK_PREFIX = "biliAccelerator.rank.";
  const BUTTON_ID = "bili-accelerator-button";
  const PANEL_ID = "bili-accelerator-panel";
  const IMMERSED_CLASS = "ba-immersed";
  const LIFTED_CLASS = "ba-lifted";
  const REVEAL_HOTZONE = 150;
  const REVEAL_TIMEOUT = 2600;
  const STALL_GRACE_MS = 2500;
  const ENGINE_TICK_MS = 500;
  // After a synthetic timeout the player retries the same range at once. If
  // no retry shows up this soon, the technique isn't working in this browser
  // and the page stops using it.
  const RETRY_WINDOW_MS = 3000;
  // A request that fails on the active host sends its retry elsewhere for this
  // long, so taking over routing never disables the player's own failover.
  const AVOID_MS = 3000;
  const MANUAL_SPACING_MS = 10000;
  const VERDICT_NOTE_MS = 12000;
  const MAX_SESSIONS = 4;

  const nativeJsonParse = JSON.parse;
  const nativeFetch = root.fetch;
  const NativeXHR = root.XMLHttpRequest;

  let immersive = false;
  let revealTimer = null;
  let playerObserver = null;
  let observedContainer = null;
  let watchedVideo = null;
  let stallTimer = null;

  const state = {
    rewrites: [],
    rewriteCount: 0,
    lastSource: "",
    status: "idle",
    stalls: 0,
    switches: 0,
    races: 0,
    p2pBlocked: 0,
    // Distinct P2P/PCDN hosts kept out of playback, for the panel's count.
    p2pAvoided: {},
    installedAt: new Date().toISOString()
  };

  // ---- config -------------------------------------------------------------

  function loadConfig() {
    try {
      const stored = root.localStorage.getItem(STORAGE_KEY) ||
        root.localStorage.getItem(LEGACY_KEY);
      return core.normalizeConfig(stored ? JSON.parse(stored) : null);
    } catch (_) {
      return core.normalizeConfig();
    }
  }

  let config = loadConfig();

  function saveConfig(nextConfig) {
    config = core.normalizeConfig(nextConfig);
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (_) {
      // storage may be unavailable; in-memory config still applies.
    }
  }

  // ---- panel appearance ---------------------------------------------------

  // Accent presets keyed by core.ACCENT_KEYS. `hex` is the primary accent,
  // `strong` the pressed/hover shade, `gradA`/`gradB` the ⚡ toggle gradient.
  const ACCENT_PRESETS = {
    bili:     { hex: "#00aeec", strong: "#0091cc", gradA: "#00b5f5", gradB: "#0091cc" },
    teal:     { hex: "#0d9488", strong: "#0b7d73", gradA: "#14b8a6", gradB: "#0b7d73" },
    emerald:  { hex: "#10b981", strong: "#0e9d6e", gradA: "#25c894", gradB: "#0e9d6e" },
    violet:   { hex: "#7c5cff", strong: "#6544e0", gradA: "#8f74ff", gradB: "#6544e0" },
    pink:     { hex: "#fb7299", strong: "#e85d86", gradA: "#ff86ab", gradB: "#e85d86" },
    sunset:   { hex: "#f97316", strong: "#db5f0c", gradA: "#ff8a3d", gradB: "#db5f0c" },
    graphite: { hex: "#46566a", strong: "#33404f", gradA: "#556579", gradB: "#33404f" }
  };

  // Header theme-toggle glyphs; swapped by updateAppearanceControls per resolved theme.
  const SUN_SVG = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm0 14a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM4 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm14 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM6.3 6.3a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4Zm9.3 9.3a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4Zm1.4-9.3a1 1 0 0 1 0 1.4l-.7.7a1 1 0 1 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0ZM7.7 15.6a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0Z\"/></svg>";
  const MOON_SVG = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z\"/></svg>";

  // Surface tokens per resolved theme; the accent tokens are layered on top.
  const SURFACES = {
    light: {
      "--ba-surface": "rgba(255,255,255,.97)", "--ba-card": "#ffffff",
      "--ba-border": "#e5eaf0", "--ba-border-in": "#d5dde5",
      "--ba-ink": "#17202a", "--ba-ink-strong": "#111827", "--ba-ink-mid": "#46515c",
      "--ba-ink-soft": "#6b7785", "--ba-ink-faint": "#8a95a1",
      "--ba-dot-bg": "#eef2f6", "--ba-dot": "#9aa6b2",
      "--ba-good-bg": "#e6f8ee", "--ba-good": "#19a974",
      "--ba-warn-bg": "#fff4e0", "--ba-warn": "#e8910c",
      "--ba-slider-off": "#c9d3dd", "--ba-panel-shadow": "rgba(21,32,43,.24)",
      "--ba-chevron": "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b7785' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"
    },
    dark: {
      "--ba-surface": "rgba(22,26,32,.975)", "--ba-card": "#1c222b",
      "--ba-border": "#2b323d", "--ba-border-in": "#38414d",
      "--ba-ink": "#e8edf2", "--ba-ink-strong": "#f4f7fa", "--ba-ink-mid": "#b9c3ce",
      "--ba-ink-soft": "#93a0ac", "--ba-ink-faint": "#6f7b87",
      "--ba-dot-bg": "#262d37", "--ba-dot": "#6f7b87",
      "--ba-good-bg": "rgba(25,169,116,.16)", "--ba-good": "#2ed3a0",
      "--ba-warn-bg": "rgba(232,145,12,.16)", "--ba-warn": "#f0a838",
      "--ba-slider-off": "#3a434f", "--ba-panel-shadow": "rgba(0,0,0,.5)",
      "--ba-chevron": "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2393a0ac' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")"
    }
  };

  // The speed canvas can't cheaply read CSS vars per frame, so applyTheme caches
  // the values it needs: accent for the line/fill, card for the endpoint halo.
  const speedPaint = { accent: "#00aeec", accentRgb: "0,174,236", card: "#ffffff" };

  function resolveTheme() {
    if (config.theme === "light" || config.theme === "dark") {
      return config.theme;
    }
    try {
      return root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark" : "light";
    } catch (_) {
      return "light";
    }
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",");
  }

  // Push the resolved accent + surface onto the shadow host as CSS custom
  // properties; the panel styles read them through var(). Custom properties
  // inherit across the shadow boundary, so setting them on the host is enough.
  function applyTheme() {
    const host = document.getElementById(BUTTON_ID);
    if (!host) {
      return;
    }
    const accent = ACCENT_PRESETS[config.accent] || ACCENT_PRESETS.bili;
    const surface = SURFACES[resolveTheme()] || SURFACES.light;
    Object.keys(surface).forEach(function (name) {
      host.style.setProperty(name, surface[name]);
    });
    const rgb = hexToRgb(accent.hex);
    host.style.setProperty("--ba-accent", accent.hex);
    host.style.setProperty("--ba-accent-strong", accent.strong);
    host.style.setProperty("--ba-grad-a", accent.gradA);
    host.style.setProperty("--ba-grad-b", accent.gradB);
    host.style.setProperty("--ba-accent-shadow", "rgba(" + rgb + ",.42)");
    speedPaint.accent = accent.hex;
    speedPaint.accentRgb = rgb;
    speedPaint.card = surface["--ba-card"];
    drawSpeed();
    updateAppearanceControls();
  }

  function watchSystemTheme() {
    try {
      const mq = root.matchMedia("(prefers-color-scheme: dark)");
      const onChange = function () {
        if (config.theme === "system") {
          applyTheme();
        }
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(onChange);
      }
    } catch (_) {
      // matchMedia unavailable — system theme just won't live-update.
    }
  }

  // A two-option sliding toggle (the header language + theme pills share it).
  // Both cells are equal width, so the 50%-wide thumb slides exactly one cell.
  // Mounts with the active index already set, so it never animates on first
  // paint — only later taps slide. options: [{ html, value, label }].
  function createSegToggle(id, options, activeIndex, onSelect) {
    const seg = document.createElement("div");
    seg.className = "ba-seg";
    seg.id = id;
    seg.dataset.active = String(activeIndex);
    const thumb = document.createElement("span");
    thumb.className = "ba-seg-thumb";
    seg.appendChild(thumb);
    options.forEach(function (opt, i) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ba-seg-opt";
      btn.innerHTML = opt.html;
      btn.setAttribute("aria-pressed", i === activeIndex ? "true" : "false");
      if (opt.label) {
        btn.title = opt.label;
        btn.setAttribute("aria-label", opt.label);
      }
      btn.addEventListener("click", function () { onSelect(opt.value, i); });
      seg.appendChild(btn);
    });
    return seg;
  }

  function setSegActive(seg, index) {
    if (!seg) {
      return;
    }
    seg.dataset.active = String(index);
    seg.querySelectorAll(".ba-seg-opt").forEach(function (opt, i) {
      opt.setAttribute("aria-pressed", i === index ? "true" : "false");
    });
  }

  function regionKey() {
    try {
      return (Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown") +
        "|" + (root.navigator && root.navigator.language || "");
    } catch (_) {
      return "unknown";
    }
  }

  function loadHistory() {
    try {
      const raw = root.localStorage.getItem(HISTORY_PREFIX + regionKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" && parsed.hosts && typeof parsed.hosts === "object"
        ? parsed
        : { hosts: {} };
    } catch (_) {
      return { hosts: {} };
    }
  }

  function saveHistory() {
    try {
      root.localStorage.setItem(HISTORY_PREFIX + regionKey(), JSON.stringify(engine.history));
    } catch (_) {
      // best effort; history only orders race contenders.
    }
  }

  function dropLegacyRankings() {
    try {
      const store = root.localStorage;
      const doomed = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && key.indexOf(LEGACY_RANK_PREFIX) === 0) {
          doomed.push(key);
        }
      }
      doomed.forEach(function (key) { store.removeItem(key); });
    } catch (_) {}
  }

  // ---- rewrite plumbing ---------------------------------------------------

  const P2P_REASONS = ["pcdn-host", "mcdn-host", "mcdn-proxy", "szbdyd-source", "live-pcdn-filter", "pcdn-promote"];

  function record(rewrites, source) {
    if (!rewrites || rewrites.length === 0) {
      return;
    }
    state.lastSource = source;
    state.rewriteCount += rewrites.length;
    state.rewrites = state.rewrites.concat(rewrites.map(function mapRewrite(item) {
      // Keep only bare host + reason — never the full media URL. Segment URLs
      // carry the viewer's mid, buvid, IP-derived oi and signed tokens, and the
      // diagnostics report is built to be pasted into public issues. Redacting
      // here (not just at display) means those tokens never persist in memory.
      const fromHost = core.hostOf(item.original);
      if (fromHost && P2P_REASONS.indexOf(item.reason) !== -1) {
        state.p2pAvoided[fromHost] = true;
      }
      return {
        at: new Date().toISOString(),
        source,
        reason: item.reason,
        fromHost,
        toHost: core.hostOf(item.url)
      };
    })).slice(-50);
    if (state.status === "idle") {
      state.status = "smooth";
    }
    renderStatus();
  }

  // The config the per-URL rules run with. Fixed selection uses the settings as
  // saved. Auto selection only keeps P2P, PCDN and MCDN off playback: which
  // healthy host serves the video is the routing engine's call, made from
  // measurements, so force mode, the Akamai rewrite and a saved target host
  // don't apply there.
  function rewriteConfig() {
    if (config.selection !== "auto") {
      return config;
    }
    return Object.assign({}, config, {
      mode: config.mode === "off" ? "off" : "bad-only",
      rewriteAkamai: false,
      pcdnHost: core.DEFAULT_CONFIG.pcdnHost
    });
  }

  function isUsableUrl(value) {
    try {
      const url = new URL(value);
      const verdict = core.classify(url, config);
      return !verdict.isPcdn && !verdict.isMcdn && verdict.kind !== "scheduler";
    } catch (_) {
      return false;
    }
  }

  // When Bilibili hands out a PCDN node as a representation's base URL and a
  // proper CDN URL as its backup, use the backup: it is issued, signed for its
  // own host, and needs no host swap. The player's own filterPdn does the same
  // under some conditions.
  function promoteIssued(payload, tracker) {
    if (config.selection !== "auto" || !config.enabled || config.mode === "off") {
      return;
    }
    routing.dashContainers(payload).forEach(function (dash) {
      ["video", "audio"].forEach(function (kind) {
        (Array.isArray(dash[kind]) ? dash[kind] : []).forEach(function (entry) {
          if (!entry || typeof entry !== "object") {
            return;
          }
          const baseKey = typeof entry.baseUrl === "string" ? "baseUrl" : "base_url";
          const backupKey = baseKey === "baseUrl" ? "backupUrl" : "backup_url";
          const base = entry[baseKey];
          const backups = Array.isArray(entry[backupKey]) ? entry[backupKey] : [];
          if (typeof base !== "string" || isUsableUrl(base)) {
            return;
          }
          const index = backups.findIndex(function (u) { return typeof u === "string" && isUsableUrl(u); });
          if (index === -1) {
            return;
          }
          const promoted = backups[index];
          entry[baseKey] = promoted;
          entry[backupKey] = backups.slice(0, index).concat(backups.slice(index + 1));
          tracker.changed = true;
          tracker.rewrites.push({ changed: true, original: base, url: promoted, reason: "pcdn-promote" });
        });
      });
    });
  }

  // Every playurl goes through the same steps, in this order: the engine reads
  // the URLs as issued, a PCDN base gives way to an issued backup, and then the
  // per-URL rules run.
  function rewritePlayurl(payload, tracker) {
    ingestPlayurl(payload);
    promoteIssued(payload, tracker);
    return core.rewriteObject(payload, rewriteConfig(), tracker);
  }

  function rewritePayload(payload, source) {
    const tracker = { changed: false, rewrites: [] };
    try {
      const rewritten = rewritePlayurl(payload, tracker);
      record(tracker.rewrites, source);
      filterLivePcdn(rewritten, source);
      return rewritten;
    } catch (error) {
      console.warn("[BiliAccelerator] rewrite failed", error);
      return payload;
    }
  }

  // Live playurl payloads list candidate hosts (url_info) instead of full URLs;
  // drop the PCDN/MCDN entries so the live player only ever dials official CDN.
  function filterLivePcdn(payload, source) {
    try {
      const filtered = core.filterLiveUrlInfo(payload, config);
      if (filtered.changed) {
        record(filtered.rewrites, source);
      }
    } catch (_) {
      // never let live filtering break payload delivery.
    }
  }

  // Quick check on a response body: does it plausibly carry media URLs?
  // Broader than "bilivideo" so renamed PCDN payloads aren't skipped.
  function bodyHasSignal(text) {
    return typeof text === "string" &&
      (text.indexOf("bilivideo") !== -1 ||
        text.indexOf("mcdn") !== -1 ||
        text.indexOf("upgcxcode") !== -1 ||
        text.indexOf("os=mcdn") !== -1 ||
        text.indexOf("akamaized") !== -1);
  }

  // Where one outgoing media request goes: the per-URL rules first (P2P,
  // PCDN, MCDN; in fixed mode also the fixed host), then, in auto mode, the
  // routing engine once it has taken over this video.
  function routeRequestUrl(rawUrl) {
    if (!core.hasMediaSignal(rawUrl)) {
      return rawUrl;
    }
    let url = rawUrl;
    try {
      const detail = core.rewriteUrlDetail(rawUrl, rewriteConfig());
      if (detail.changed) {
        record([detail], "segment");
        url = detail.url;
      }
    } catch (_) {
      return rawUrl;
    }
    try {
      return engineRoute(url);
    } catch (_) {
      return url;
    }
  }

  // ---- interception -------------------------------------------------------

  function isInterestingFetch(input) {
    const url = requestUrlOf(input);
    return typeof url === "string" &&
      (url.includes("/x/player") ||
        url.includes("/pgc/player") ||
        url.includes("playurl") ||
        url.includes("getRoomPlayInfo") ||
        url.includes("bilivideo"));
  }

  function patchJsonParse() {
    JSON.parse = function patchedJsonParse(text) {
      const parsed = nativeJsonParse.apply(this, arguments);
      if (config.enabled && bodyHasSignal(text)) {
        return rewritePayload(parsed, "JSON.parse");
      }
      return parsed;
    };
  }

  function requestUrlOf(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input && typeof input.href === "string") {
      return input.href; // URL instance
    }
    if (input && typeof input.url === "string") {
      return input.url; // Request instance
    }
    return null;
  }

  function patchFetch() {
    if (!nativeFetch) {
      return;
    }
    root.fetch = function patchedFetch(input, init) {
      let args = arguments;
      const reqUrl = requestUrlOf(input);
      const isMedia = !!reqUrl && core.hasMediaSignal(reqUrl);
      if (config.enabled && isMedia) {
        const swapped = routeRequestUrl(reqUrl);
        if (swapped !== reqUrl) {
          // string and URL inputs can be replaced by the string directly; only a
          // Request needs to be rebuilt to preserve its init options.
          input = (typeof input === "string" || typeof input.href === "string")
            ? swapped
            : new Request(swapped, input);
          args = [input, init];
        }
      }

      return nativeFetch.apply(this, args).then(function handleResponse(response) {
        if (!config.enabled) {
          return response;
        }
        const contentType = response.headers && response.headers.get("content-type");
        const isBinary = !contentType ||
          (!contentType.includes("json") && !contentType.includes("text"));

        // Never clone or consume media bodies here. In particular, Safari may
        // throttle the page-world reader after a tab is backgrounded; teeing the
        // player's response for the optional speed graph can then interfere with
        // MSE playback. XHR transfers are still measured below, and fetch-based
        // playback falls back to the buffer-ahead graph.
        if (isMedia && isBinary) {
          return response;
        }

        if (!isInterestingFetch(args[0]) || isBinary) {
          return response;
        }
        return response.clone().text().then(function rewriteText(text) {
          if (!bodyHasSignal(text)) {
            return response;
          }
          let parsed;
          const tracker = { changed: false, rewrites: [] };
          let live = { changed: false, rewrites: [] };
          try {
            parsed = nativeJsonParse(text);
            rewritePlayurl(parsed, tracker);
            live = core.filterLiveUrlInfo(parsed, config);
          } catch (_) {
            return response;
          }
          if (!tracker.changed && !live.changed) {
            return response;
          }
          record(tracker.rewrites, "fetch");
          record(live.rewrites, "fetch");
          const headers = new Headers(response.headers);
          headers.delete("content-length");
          return new Response(JSON.stringify(parsed), {
            status: response.status,
            statusText: response.statusText,
            headers
          });
        }).catch(function ignore() {
          return response;
        });
      });
    };
  }

  // XHR was the biggest coverage gap in v0.1.x: quality switches and some
  // playurl paths use it. Rewrite the request URL on open() and the JSON body
  // on load() via a responseText/response shim.
  function patchXHR() {
    if (!NativeXHR) {
      return;
    }
    const open = NativeXHR.prototype.open;
    const send = NativeXHR.prototype.send;
    const setRequestHeader = NativeXHR.prototype.setRequestHeader;

    NativeXHR.prototype.open = function patchedOpen(method, url) {
      const urlStr = typeof url === "string"
        ? url
        : (url && typeof url.href === "string" ? url.href : "");
      let finalUrl = url;
      if (config.enabled && urlStr && core.hasMediaSignal(urlStr)) {
        finalUrl = routeRequestUrl(urlStr);
      }
      this.__baAccel = { url: urlStr, finalUrl: typeof finalUrl === "string" ? finalUrl : urlStr, range: null };
      return open.apply(this, [method, finalUrl].concat([].slice.call(arguments, 2)));
    };

    // The player sends its byte range as a header; the engine needs it to know
    // which fragment a request carries and how big it is.
    if (typeof setRequestHeader === "function") {
      NativeXHR.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
        if (this.__baAccel && /^range$/i.test(String(name))) {
          this.__baAccel.range = String(value);
        }
        return setRequestHeader.apply(this, arguments);
      };
    }

    NativeXHR.prototype.send = function patchedSend() {
      const xhr = this;
      const meta = xhr.__baAccel || {};
      const isMedia = typeof meta.url === "string" && core.hasMediaSignal(meta.url);
      const interesting = typeof meta.url === "string" &&
        (meta.url.includes("playurl") || meta.url.includes("/x/player") ||
          meta.url.includes("/pgc/player") || meta.url.includes("getRoomPlayInfo") ||
          isMedia);

      // Count downloaded bytes for media segments (free via loadend.loaded) and
      // time send→loadend as the transfer duration for the throughput window.
      if (config.enabled && isMedia) {
        const startTs = nowMs();
        xhr.addEventListener("loadend", function onLoadEnd(event) {
          if (event && typeof event.loaded === "number") {
            recordTransfer(startTs, nowMs(), event.loaded);
          }
        });
        // The same request, as the routing engine sees it. Listeners only:
        // the player's own handlers are properties and stay untouched.
        let req = null;
        try {
          req = beginRequest(xhr, meta);
        } catch (_) {
          req = null;
        }
        if (req) {
          xhr.addEventListener("progress", function onProgress(event) {
            if (event && typeof event.loaded === "number") {
              noteProgress(req, event.loaded);
            }
          });
          xhr.addEventListener("abort", function onAbort() { req.aborted = true; });
          xhr.addEventListener("loadend", function onEnd(event) {
            endRequest(req, xhr.status, event && typeof event.loaded === "number" ? event.loaded : 0);
          });
        }
      }

      if (config.enabled && interesting) {
        xhr.addEventListener("load", function onLoad() {
          try {
            const ct = xhr.getResponseHeader && xhr.getResponseHeader("content-type");
            if (ct && !ct.includes("json") && !ct.includes("text")) {
              return;
            }
            const text = xhr.responseText;
            if (!bodyHasSignal(text)) {
              return;
            }
            const parsed = nativeJsonParse(text);
            const tracker = { changed: false, rewrites: [] };
            rewritePlayurl(parsed, tracker);
            const live = core.filterLiveUrlInfo(parsed, config);
            if (!tracker.changed && !live.changed) {
              return;
            }
            const rewrittenText = JSON.stringify(parsed);
            const shim = {
              configurable: true,
              get: function () { return rewrittenText; }
            };
            try { Object.defineProperty(xhr, "responseText", shim); } catch (_) {}
            try {
              Object.defineProperty(xhr, "response", {
                configurable: true,
                get: function () {
                  return xhr.responseType === "json" ? parsed : rewrittenText;
                }
              });
            } catch (_) {}
            record(tracker.rewrites, "xhr");
            record(live.rewrites, "xhr");
          } catch (_) {
            // leave the original response intact on any failure.
          }
        });
      }
      return send.apply(this, arguments);
    };
  }

  function patchGlobalPlayInfo(name) {
    let currentValue;
    const existing = Object.getOwnPropertyDescriptor(root, name);
    if (existing && existing.configurable === false) {
      return;
    }
    if (existing && "value" in existing) {
      currentValue = rewritePayload(existing.value, name);
    }
    try {
      Object.defineProperty(root, name, {
        configurable: true,
        enumerable: true,
        get: function () { return currentValue; },
        set: function (value) { currentValue = rewritePayload(value, name); }
      });
    } catch (_) {
      if (root[name]) {
        root[name] = rewritePayload(root[name], name);
      }
    }
  }

  // ---- optional P2P / bandwidth guard ------------------------------------

  function installP2PGuard() {
    if (!config.p2pGuard) {
      return;
    }
    // Stub Bilibili's P2P SDK entry points so the player never boots the
    // PCDN/seeder mesh (same surface MBGTEB neutralizes). Instances only need
    // an `on` no-op to satisfy the player's wiring code.
    function NoopSdk() {}
    NoopSdk.prototype.on = function () {};
    ["PCDNLoader", "BPP2PSDK", "SeederSDK"].forEach(function (name) {
      try {
        Object.defineProperty(root, name, {
          configurable: false,
          writable: false,
          value: NoopSdk
        });
      } catch (_) {
        // already defined and frozen; ignore.
      }
    });
    ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"].forEach(function (name) {
      try {
        const Blocked = function BlockedRTCPeerConnection() {
          state.p2pBlocked += 1;
          renderStatus();
          throw new DOMException("Blocked by Bilibili Accelerator", "NotAllowedError");
        };
        Object.defineProperty(root, name, {
          configurable: false,
          writable: false,
          value: Blocked
        });
      } catch (_) {
        // some environments freeze these; ignore.
      }
    });
  }

  // ---- VOD routing --------------------------------------------------------
  //
  // docs/vod-routing.md has the measurements behind this. The player is a
  // dash.js fork that already fails over between the URLs it was issued, but
  // only on errors and timeouts. It can't see a host that answers at once and
  // then delivers below the stream's bitrate, which is what an overseas edge
  // does while it relays a file it hasn't cached. So the engine watches the
  // player's own fragment downloads; when the host can't keep up it races two
  // alternatives on the bytes the player needs next, routes the rest of the
  // video to the winner, and stays there. A single fragment that hangs on a
  // host that has been keeping up is retried on the winner, and the video
  // stays put.

  const engine = {
    sessions: new Map(),        // cid -> session, one per video on the page
    current: null,              // the session whose video fragments came last
    history: loadHistory(),
    synthetic: { used: 0, disabled: false, pending: null, noRetry: 0 },
    hiddenSince: null,
    hiddenSpans: [],
    stalling: false,
    timer: null,
    rendered: ""
  };

  function autoRouting() {
    return config.enabled && config.mode !== "off" && config.selection === "auto";
  }

  // Races need Auto-switch on and a real player page. Hover previews on the
  // home page load playurls too, and racing for a muted thumbnail would only
  // cost bandwidth.
  function switchingAllowed() {
    return autoRouting() && config.stallRecovery && isPlayerPage();
  }

  function isPlayerPage() {
    let path = "";
    try {
      path = root.location.pathname || new URL(root.location.href).pathname;
    } catch (_) {
      path = "";
    }
    return /^\/(?:video|bangumi\/play|list|medialist\/play|festival|cheese\/play)\//.test(path || "");
  }

  function newSession(cid) {
    return {
      cid,
      table: { cid, reps: {} },
      requiredBps: 0,
      assigned: null,        // the host the player used first
      lastHost: null,        // the host of the latest video request
      active: null,          // where the engine routes; null leaves the player's URLs alone
      fallback: null,
      avoid: null,
      detour: null,          // { host, until }: a stuck fragment's retry, while the video stays
      lastVideoKey: null,
      ends: {},              // file -> end of the last completed video range
      hosts: {},
      requested: {},         // "file|start" -> seen, to tell a retry from a first attempt
      inflight: [],
      racing: null,
      nextRaceAt: 0,
      cooldownMs: 0,
      manualAt: -Infinity,
      failed: {},
      lost: {},
      measured: {},
      races: [],
      switches: [],
      stalls: 0,
      verdict: null
    };
  }

  function sessionFor(cid) {
    let session = engine.sessions.get(cid);
    if (!session) {
      session = newSession(cid);
      engine.sessions.set(cid, session);
      if (engine.sessions.size > MAX_SESSIONS) {
        const oldest = engine.sessions.keys().next().value;
        if (engine.sessions.get(oldest) !== engine.current) {
          engine.sessions.delete(oldest);
        }
      }
    }
    return session;
  }

  // Every DASH playurl the page receives, before anything is rewritten: the
  // issued URLs are what reaches Akamai at all, and what a host swap borrows
  // its signature from.
  function ingestPlayurl(payload) {
    if (!config.enabled || !payload || typeof payload !== "object") {
      return;
    }
    let table = null;
    try {
      table = routing.buildTable(payload, isUsableUrl);
    } catch (_) {
      table = null;
    }
    if (!table || !table.cid) {
      return;
    }
    const session = sessionFor(table.cid);
    // A refresh of the same video brings fresh signatures; take them.
    Object.keys(table.reps).forEach(function (key) {
      session.table.reps[key] = table.reps[key];
    });
  }

  function hostStats(session, host) {
    if (!session.hosts[host]) {
      session.hosts[host] = {
        est: routing.createEstimator(), requests: 0, bytes: 0, errors: [], ttfbs: []
      };
    }
    return session.hosts[host];
  }

  function hostOfUrl(value) {
    try {
      return new URL(value, root.location.href).host.toLowerCase();
    } catch (_) {
      return "";
    }
  }

  function beginRequest(xhr, meta) {
    const url = meta.finalUrl || meta.url;
    const key = routing.fileKey(url);
    const cid = routing.cidOf(key);
    if (!key || !cid || String(url).indexOf("/live-bvc/") !== -1) {
      return null;
    }
    const session = sessionFor(cid);
    const rep = session.table.reps[key];
    const kind = rep ? rep.kind : (routing.AUDIO_ID_RE.test(routing.repIdOf(key) || "") ? "audio" : "video");
    const range = routing.parseRange(meta.range);
    const start = range ? range.start : 0;
    const slot = key + "|" + start;
    const req = {
      xhr,
      session,
      key,
      kind,
      host: hostOfUrl(url),
      start,
      end: range && !isNaN(range.end) ? range.end : NaN,
      total: range && range.length > 0 ? range.length : NaN,
      startedAt: nowMs(),
      firstByteAt: null,
      loaded: 0,
      samples: [],
      retry: !!session.requested[slot],
      handed: false,
      raced: false,
      aborted: false,
      ended: false
    };
    session.requested[slot] = true;
    const pending = engine.synthetic.pending;
    if (pending && pending.slot === slot) {
      engine.synthetic.pending = null;
    }
    if (kind === "video") {
      // Nothing to watch until a video fragment is actually requested.
      startEngine();
      engine.current = session;
      session.lastVideoKey = key;
      session.lastHost = req.host;
      if (!session.assigned) {
        session.assigned = req.host;
      }
      if (rep && rep.bandwidth > session.requiredBps) {
        session.requiredBps = rep.bandwidth;
      }
      session.inflight.push(req);
    }
    return req;
  }

  function noteProgress(req, loaded) {
    const now = nowMs();
    if (!req.firstByteAt && loaded > 0) {
      req.firstByteAt = now;
    }
    req.loaded = loaded;
    req.samples.push([now, loaded]);
    if (req.samples.length > 60) {
      req.samples.splice(0, req.samples.length - 60);
    }
  }

  function endRequest(req, status, loaded) {
    const session = req.session;
    req.ended = true;
    const index = session.inflight.indexOf(req);
    if (index !== -1) {
      session.inflight.splice(index, 1);
    }
    if (req.handed) {
      return;
    }
    const now = nowMs();
    // The player cancels fragments it no longer needs (a seek, a quality
    // change), which says nothing about the host. It also aborts a request
    // that got no first byte within its ~2 s deadline, and that one does.
    const missedDeadline = req.aborted && !req.firstByteAt && now - req.startedAt >= 1800;
    if (req.aborted && !missedDeadline) {
      return;
    }
    const stats = hostStats(session, req.host);
    stats.requests += 1;
    if (missedDeadline || !((status === 200 || status === 206) && loaded > 0)) {
      stats.errors.push(now);
      session.failed[req.host] = (session.failed[req.host] || 0) + 1;
      engine.history = routing.recordFailure(engine.history, req.host, Date.now());
      if (session.active && req.host === session.active) {
        session.avoid = { host: req.host, until: now + AVOID_MS };
      }
      return;
    }
    stats.bytes += loaded;
    // An init or index segment is a few KB and says nothing about throughput.
    if (loaded >= 128 * 1024) {
      session.measured[req.host] = true;
    }
    if (req.firstByteAt) {
      stats.ttfbs.push(req.firstByteAt - req.startedAt);
      if (stats.ttfbs.length > 30) {
        stats.ttfbs.shift();
      }
    }
    if (req.kind === "video") {
      if (!overlapsHidden(req.startedAt, now)) {
        stats.est.sample(now - req.startedAt, loaded);
      }
      if (!isNaN(req.end)) {
        session.ends[req.key] = Math.max(session.ends[req.key] == null ? -1 : session.ends[req.key], req.end);
      }
    }
  }

  // A transfer that overlapped a hidden period measured the browser's
  // background throttling, not the host.
  function overlapsHidden(from, to) {
    if (engine.hiddenSince !== null && to > engine.hiddenSince) {
      return true;
    }
    return engine.hiddenSpans.some(function (span) { return from < span[1] && to > span[0]; });
  }

  function engineRoute(url) {
    if (!autoRouting()) {
      return url;
    }
    const key = routing.fileKey(url);
    const session = key ? engine.sessions.get(routing.cidOf(key)) : null;
    const rep = session ? session.table.reps[key] : null;
    if (!rep) {
      return url;
    }
    // A stuck fragment is being retried on the host that won its race. The
    // player sends the retry to the next URL in its own list, so for these few
    // seconds everything goes there, whatever host the request names.
    if (session.detour && nowMs() < session.detour.until) {
      return routing.urlFor(rep, session.detour.host) || url;
    }
    if (!session.active) {
      return url;
    }
    let target = session.active;
    // The active host just failed a request: its retry goes to the runner-up,
    // or where the player sends it, as the player's own failover would.
    if (session.avoid && session.avoid.host === target && nowMs() < session.avoid.until) {
      target = session.fallback;
    }
    return (target && routing.urlFor(rep, target)) || url;
  }

  function bufferAhead() {
    try {
      const video = watchedVideo;
      if (!video || !video.buffered) {
        return 0;
      }
      const t = video.currentTime;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.buffered.start(i) <= t + 0.3 && video.buffered.end(i) > t) {
          return video.buffered.end(i) - t;
        }
      }
    } catch (_) {}
    return 0;
  }

  function startEngine() {
    if (!engine.timer && typeof setInterval === "function") {
      engine.timer = setInterval(engineTick, ENGINE_TICK_MS);
    }
  }

  function engineTick() {
    const now = nowMs();
    const pending = engine.synthetic.pending;
    if (pending && now > pending.deadline) {
      // The player didn't retry the range it was handed a timeout for. Stop
      // doing that on this page; switches still apply to later requests.
      engine.synthetic.pending = null;
      engine.synthetic.disabled = true;
      engine.synthetic.noRetry += 1;
    }
    const session = engine.current;
    if (session && !document.hidden && switchingAllowed() && !session.racing &&
        now >= session.nextRaceAt && session.switches.length < routing.MAX_SWITCHES) {
      const host = session.active || session.lastHost;
      if (host) {
        const stats = hostStats(session, host);
        const verdict = routing.evaluate({
          now,
          requiredBps: session.requiredBps,
          bufferAheadS: bufferAhead(),
          // Only requests on the host the video is on say anything about it. A
          // retry sent elsewhere for a moment is left to the player's own timeouts.
          inflight: session.inflight.filter(function (r) {
            return r.kind === "video" && !r.handed && !r.raced && r.host === host;
          })
            .map(function (r) {
              return {
                total: r.total, loaded: r.loaded, startedAt: r.startedAt, firstByteAt: r.firstByteAt,
                rateBps: routing.recentRate(r.samples, now, 1000), ref: r
              };
            }),
          estimateBps: stats.est.estimate(),
          measuredBytes: stats.est.bytes(),
          measuredMs: stats.est.ms(),
          recentErrors: recentErrors(stats, now)
        });
        if (verdict) {
          startRace(session, verdict.trigger, verdict.req ? verdict.req.ref : null);
        }
      }
    }
    refreshStatus();
  }

  // Errors within the window, or only those before a given time.
  function recentErrors(stats, now, before) {
    return stats.errors.filter(function (t) {
      return now - t < routing.ERROR_WINDOW_MS && !(t >= before);
    }).length;
  }

  function startRace(session, trigger, stuckReq) {
    if (typeof nativeFetch !== "function") {
      return false;
    }
    const key = stuckReq ? stuckReq.key : session.lastVideoKey;
    const rep = key ? session.table.reps[key] : null;
    const current = session.active || session.lastHost;
    if (!rep || !current) {
      return false;
    }
    if (stuckReq && trigger === "stuck") {
      // Its bytes are raced once; after that the player's timeouts have it.
      stuckReq.raced = true;
    }
    const start = stuckReq ? stuckReq.start : (session.ends[key] != null ? session.ends[key] + 1 : NaN);
    if (!(start >= 0)) {
      return false;
    }
    let end = start + routing.RACE_BYTES - 1;
    if (stuckReq && stuckReq.end >= start) {
      end = Math.min(end, stuckReq.end);
    }
    const wall = Date.now();
    const now = nowMs();
    const challengers = routing.pickChallengers({
      candidates: routing.candidatesFor(rep, config.candidatePool),
      current,
      issued: rep.issued,
      measured: session.measured,
      failed: session.failed,
      lost: session.lost,
      history: engine.history,
      now: wall
    });
    let currentRate = 0;
    if (trigger !== "errors") {
      currentRate = stuckReq
        ? (stuckReq.loaded > 0 ? 8000 * stuckReq.loaded / Math.max(1, now - stuckReq.startedAt) : 0)
        : (hostStats(session, current).est.estimate() || 0);
    }
    const contenders = challengers.map(function (host) { return { host, url: routing.urlFor(rep, host) }; })
      .filter(function (c) { return c.url; });
    // A manual test with no measurement of the current host yet races it as
    // well, so every host is compared on the same bytes.
    const currentUrl = routing.urlFor(rep, current);
    if (trigger === "manual" && !(currentRate > 0) && currentUrl && contenders.length) {
      contenders.push({ host: current, url: currentUrl, incumbent: true });
    }
    if (!contenders.length) {
      concludeRace(session, trigger, [], currentRate, end - start + 1, current, null);
      return false;
    }
    session.racing = {
      trigger,
      compared: contenders.length + (contenders.some(function (c) { return c.incumbent; }) ? 0 : 1)
    };
    state.races += 1;
    renderStatus();
    runRace(contenders, start, end, function (late) {
      learnFromRace(session, late, true);
    }).then(function (results) {
      concludeRace(session, trigger, results, currentRate, end - start + 1, current, stuckReq);
    }, function () {
      session.racing = null;
    });
    return true;
  }

  // Fetch the same bytes from every contender at once and decide as soon as
  // the outcome is known: when the first challenger finishes, or, if the
  // current host is racing too, when it finishes or has taken SWITCH_GAIN
  // times the winner's time without finishing. Contenders still running then
  // get another second so their numbers reach history, and are cancelled.
  function runRace(contenders, start, end, onLate) {
    const expected = end - start + 1;
    return new Promise(function (resolve) {
      const t0 = nowMs();
      const results = contenders.map(function (c) {
        return { host: c.host, incumbent: !!c.incumbent, ok: false, status: 0, bytes: 0, ms: 0, cut: false, settled: false };
      });
      const incumbent = results.filter(function (r) { return r.incumbent; })[0] || null;
      const controllers = [];
      let left = results.length;
      let decided = false;
      let decideTimer = null;
      let cutTimer = null;
      let pendingAtDecision = [];
      const snapshot = function () { return results.map(function (r) { return Object.assign({}, r); }); };
      function decide() {
        if (decided) {
          return;
        }
        decided = true;
        if (decideTimer) {
          clearTimeout(decideTimer);
        }
        if (incumbent && !incumbent.settled) {
          incumbent.ms = nowMs() - t0;
        }
        pendingAtDecision = results.filter(function (r) { return !r.settled; }).map(function (r) { return r.host; });
        resolve(snapshot());
        cutTimer = setTimeout(function () {
          results.forEach(function (r, i) {
            if (!r.settled) {
              r.cut = true;
              try { if (controllers[i]) { controllers[i].abort(); } } catch (_) {}
            }
          });
        }, 1000);
      }
      function settle(i) {
        const r = results[i];
        r.settled = true;
        left -= 1;
        if (!decided) {
          if (r.incumbent || (r.ok && !incumbent)) {
            decide();
          } else if (r.ok && !decideTimer) {
            decideTimer = setTimeout(decide, Math.max(0, r.ms * routing.SWITCH_GAIN - (nowMs() - t0)));
          }
        }
        if (!left) {
          if (cutTimer) {
            clearTimeout(cutTimer);
          }
          if (!decided) {
            decide();
          } else if (onLate && pendingAtDecision.length) {
            // Only what was still running at the decision: the rest was
            // already learned from.
            onLate(snapshot().filter(function (x) { return pendingAtDecision.indexOf(x.host) !== -1; }));
          }
        }
      }
      contenders.forEach(function (c, i) {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        controllers.push(ctl);
        const timer = setTimeout(function () {
          try { if (ctl) { ctl.abort(); } } catch (_) {}
        }, routing.RACE_TIMEOUT_MS);
        fetchRange(c.url, start, end, ctl, function (bytes) {
          results[i].bytes = bytes;
          results[i].ms = nowMs() - t0;
        }).then(function (r) {
          results[i].status = r.status;
          results[i].bytes = r.bytes;
          results[i].ms = nowMs() - t0;
          results[i].ok = (r.status === 206 || r.status === 200) && r.bytes >= Math.min(expected, 64 * 1024);
        }, function () {
          results[i].ms = nowMs() - t0;
        }).then(function () {
          clearTimeout(timer);
          settle(i);
        });
      });
    });
  }

  function fetchRange(url, start, end, ctl, onBytes) {
    const init = {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { Range: "bytes=" + start + "-" + end }
    };
    if (ctl) {
      init.signal = ctl.signal;
    }
    return nativeFetch.call(root, url, init).then(function (response) {
      const status = response.status;
      const body = response.body;
      if (!body || typeof body.getReader !== "function") {
        return response.arrayBuffer().then(function (buf) { return { status, bytes: buf.byteLength }; });
      }
      const reader = body.getReader();
      let bytes = 0;
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) {
            return { status, bytes };
          }
          bytes += chunk.value ? chunk.value.length : 0;
          onBytes(bytes);
          return pump();
        });
      }
      return pump();
    });
  }

  // What a race taught about each contender. At decision time only settled
  // contenders count; the rest are learned from when they finish or are cut.
  function learnFromRace(session, results, late) {
    const wall = Date.now();
    results.forEach(function (r) {
      if (!r.settled) {
        return;
      }
      if (r.ok || (r.cut && r.bytes >= 64 * 1024)) {
        engine.history = routing.recordSample(engine.history, r.host, r.bytes * 8 / 1000 / Math.max(1, r.ms), wall);
        session.measured[r.host] = true;
        if (late && r.ok && session.active && r.host !== session.active && !session.fallback) {
          session.fallback = r.host;
        }
      } else if (!r.cut) {
        engine.history = routing.recordFailure(engine.history, r.host, wall);
        session.failed[r.host] = (session.failed[r.host] || 0) + 1;
      }
    });
    if (late) {
      saveHistory();
    }
  }

  function concludeRace(session, trigger, results, currentRate, raceBytes, current, stuckReq) {
    session.racing = null;
    const wall = Date.now();
    const now = nowMs();
    learnFromRace(session, results, false);
    const challengers = results.filter(function (r) { return !r.incumbent; });
    const incumbent = results.filter(function (r) { return r.incumbent && r.ok; })[0];
    let baseRate = incumbent ? incumbent.bytes * 8000 / Math.max(1, incumbent.ms) : currentRate;
    let verdict;
    if (trigger === "stuck" && !incumbent) {
      // Errors from before the stuck request: if the player's own timeout
      // ended it during the race, that is this same hang, not an earlier one.
      const stats = hostStats(session, current);
      verdict = routing.stuckRaceVerdict(challengers, currentRate, stats.est.estimate(),
        recentErrors(stats, now, stuckReq ? stuckReq.startedAt : undefined), raceBytes);
      baseRate = verdict.hostRateBps;
    } else {
      verdict = routing.raceVerdict(challengers, baseRate, raceBytes);
    }
    const retryOn = verdict.retryOn || null;
    results.forEach(function (r) {
      if (!r.incumbent && r.host !== verdict.switchTo && r.host !== retryOn) {
        session.lost[r.host] = wall;
      }
    });
    session.races.push({
      at: new Date(wall).toISOString(),
      trigger,
      from: current,
      currentMbps: round1(baseRate / 1e6),
      stuckMbps: trigger === "stuck" ? round1(currentRate / 1e6) : undefined,
      contenders: results.map(function (r) {
        return {
          host: r.host, ok: r.ok, ms: Math.round(r.ms), kb: Math.round(r.bytes / 1024),
          status: r.status, incumbent: r.incumbent || undefined, cut: r.cut || undefined
        };
      }),
      switchTo: verdict.switchTo,
      retryOn: retryOn || undefined
    });
    if (session.races.length > 10) {
      session.races.shift();
    }
    if (verdict.switchTo) {
      // The host being left was measured too, by the request that started the
      // race or by its traffic: it lost, so it rests like any other loser, and
      // what it delivered goes into history.
      if (current && current !== verdict.switchTo) {
        session.measured[current] = true;
        session.lost[current] = wall;
        if (baseRate > 0) {
          engine.history = routing.recordSample(engine.history, current, baseRate / 1e6, wall);
        }
      }
      session.active = verdict.switchTo;
      session.fallback = verdict.runnerUp && verdict.runnerUp !== verdict.switchTo ? verdict.runnerUp : null;
      session.avoid = null;
      session.detour = null;
      session.verdict = null;
      session.switches.push({
        at: new Date(wall).toISOString(), from: current, to: verdict.switchTo, trigger,
        beforeMbps: round1(baseRate / 1e6)
      });
      state.switches += 1;
      zapBadge();
      session.cooldownMs = 0;
      session.nextRaceAt = now + routing.nextCooldown("switch", session.switches.length);
      if (trigger === "stuck" && stuckReq) {
        handTimeout(stuckReq);
      }
    } else if (retryOn && stuckReq) {
      // The video stays and only this fragment moves. The next race may
      // start once the retry is under way, and by then the hang counts
      // against the host, whether our timeout or the player's ended it.
      retryStuck(session, current, retryOn, stuckReq);
      session.nextRaceAt = now + AVOID_MS;
    } else {
      session.cooldownMs = routing.nextCooldown("none", 0, session.cooldownMs);
      session.nextRaceAt = now + session.cooldownMs;
      session.verdict = {
        at: now, tested: results.length + (incumbent ? 0 : 1), rateBps: baseRate, manual: trigger === "manual"
      };
    }
    if (trigger === "manual") {
      session.manualAt = now;
    }
    saveHistory();
    renderStatus();
  }

  // End a stuck fragment request the way the player's own total timeout
  // would. Its handlers are properties set before send(): detach them, abort
  // the request natively so none of them hears it, then call its ontimeout
  // and onloadend. The player retries the range at once, and the retry is
  // routed to the host that just won. A native abort() alone won't do: the
  // loader takes an abort as deliberate and would run both its abort path and,
  // through onloadend, its retry path.
  function handTimeout(req) {
    const xhr = req.xhr;
    // A race can outlast the request: the player's own timeout may have ended
    // it already, and after abort() readyState reads 0, not 4.
    if (engine.synthetic.disabled || req.retry || req.handed || req.ended || !xhr || xhr.readyState === 4) {
      return false;
    }
    const onTimeout = xhr.ontimeout;
    const onEnd = xhr.onloadend;
    if (typeof onTimeout !== "function" || typeof onEnd !== "function") {
      return false;
    }
    req.handed = true;
    xhr.onload = null;
    xhr.onloadend = null;
    xhr.onerror = null;
    xhr.onprogress = null;
    xhr.onabort = null;
    xhr.ontimeout = null;
    xhr.onreadystatechange = null;
    try { xhr.abort(); } catch (_) {}
    engine.synthetic.used += 1;
    engine.synthetic.pending = { slot: req.key + "|" + req.start, deadline: nowMs() + RETRY_WINDOW_MS };
    try { onTimeout.call(xhr, progressEvent("timeout")); } catch (_) {}
    try { onEnd.call(xhr, progressEvent("loadend")); } catch (_) {}
    return true;
  }

  // Retry one stuck fragment on another host and leave the video where it is.
  // After a timeout, the player's own or ours, the player moves to the next
  // URL in its list for good, so leaving the video where it is means routing
  // it there from now on; a request that fails there retries on the winner.
  // The detour goes in before the timeout is handed over, because the player
  // may open its retry from inside the timeout handler. The hang counts
  // against its host like a failed request, so a second one within the error
  // window moves the video. When no timeout can be handed over (the player's
  // own timeout ended the request first, it is a retry, or synthetic timeouts
  // are off), the player's timeout does the retry and records the error.
  function retryStuck(session, current, host, req) {
    if (!session.active) {
      session.active = current;
    }
    session.fallback = host;
    session.detour = { host, until: nowMs() + AVOID_MS };
    if (!handTimeout(req)) {
      session.detour = null;
      return;
    }
    hostStats(session, req.host || current).errors.push(nowMs());
  }

  function progressEvent(type) {
    try {
      return new ProgressEvent(type);
    } catch (_) {
      return { type };
    }
  }

  // "测试其他线路": a race now, for the fragment in flight or the bytes after
  // the last one. It follows the same rule as an automatic race and never
  // saves anything.
  function retest() {
    const session = engine.current;
    if (!session || session.racing || !autoRouting() || nowMs() - session.manualAt < MANUAL_SPACING_MS) {
      return false;
    }
    const inflight = session.inflight.filter(function (r) {
      return r.kind === "video" && !r.handed && r.total >= 128 * 1024;
    })[0];
    return startRace(session, "manual", inflight || null);
  }

  // ---- playback state -----------------------------------------------------

  function handleStall() {
    // Browsers throttle media/MSE work in background tabs, which can make the
    // player emit a transient waiting/stalled event. A stall is counted only
    // once the page is visible (see onVisibilityChange). Stalls are recorded
    // for the panel; the routing engine acts on what the downloads show.
    stallTimer = null;
    if (document.hidden || !watchedVideo || watchedVideo.paused || watchedVideo.ended) {
      return;
    }
    if (watchedVideo.readyState >= 3) {
      return;
    }
    if (!engine.stalling) {
      engine.stalling = true;
      state.stalls += 1;
      if (engine.current) {
        engine.current.stalls += 1;
      }
    }
    renderStatus();
  }

  function onWaiting() {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (document.hidden) {
      return;
    }
    stallTimer = setTimeout(handleStall, STALL_GRACE_MS);
  }

  function onPlaying() {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
    if (engine.stalling) {
      engine.stalling = false;
      renderStatus();
    }
  }

  function onVisibilityChange() {
    const now = nowMs();
    if (document.hidden) {
      if (engine.hiddenSince === null) {
        engine.hiddenSince = now;
      }
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      return;
    }
    if (engine.hiddenSince !== null) {
      engine.hiddenSpans.push([engine.hiddenSince, now]);
      if (engine.hiddenSpans.length > 20) {
        engine.hiddenSpans.shift();
      }
      engine.hiddenSince = null;
    }

    // A waiting event fired while hidden is deliberately ignored, and 'waiting'
    // does not re-fire for an element that is already waiting. Re-check once
    // foregrounded, so a stall that began hidden and is still unresolved gets
    // counted. The grace period keeps the brief readyState dip a tab switch
    // itself produces from counting: handleStall re-tests readyState first.
    if (watchedVideo && !watchedVideo.paused && !watchedVideo.ended &&
        watchedVideo.readyState < 3) {
      onWaiting();
    } else {
      onPlaying();
    }
  }

  function watchVideo() {
    const video = document.querySelector("video");
    if (!video || video === watchedVideo) {
      return;
    }
    watchedVideo = video;
    video.addEventListener("waiting", onWaiting, { passive: true });
    video.addEventListener("stalled", onWaiting, { passive: true });
    video.addEventListener("playing", onPlaying, { passive: true });
    video.addEventListener("canplay", onPlaying, { passive: true });
  }

  // ---- diagnostics --------------------------------------------------------

  function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function median(list) {
    if (!list || !list.length) {
      return null;
    }
    const sorted = list.slice().sort(function (a, b) { return a - b; });
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  }

  // No URL, query string or video id: hosts, sizes and timings only.
  function sessionReport(session) {
    const hosts = {};
    Object.keys(session.hosts).forEach(function (host) {
      const s = session.hosts[host];
      const est = s.est.estimate();
      hosts[host] = {
        requests: s.requests,
        mb: round1(s.bytes / 1e6),
        mbps: est === null ? null : round1(est / 1e6),
        firstByteMs: median(s.ttfbs),
        errors: s.errors.length
      };
    });
    const issued = {};
    Object.keys(session.table.reps).forEach(function (key) {
      const rep = session.table.reps[key];
      issued[rep.kind + " " + rep.id + " " + String(rep.codecs || "").split(".")[0]] = rep.issued.slice();
    });
    return {
      requiredMbps: round1(session.requiredBps / 1e6),
      assignedHost: session.assigned,
      activeHost: session.active,
      bufferS: round1(bufferAhead()),
      stalls: session.stalls,
      hosts,
      issued,
      races: session.races.slice(),
      switches: session.switches.slice()
    };
  }

  function buildDiagnostics() {
    return {
      version: VERSION,
      installedAt: state.installedAt,
      region: regionKey().split("|")[0],   // timezone only — drop locale
      config,
      status: computeStatus().key,
      counters: {
        rewrites: state.rewriteCount,
        stalls: state.stalls,
        switches: state.switches,
        races: state.races,
        p2pAvoided: Object.keys(state.p2pAvoided).length,
        p2pBlocked: state.p2pBlocked
      },
      synthetic: {
        used: engine.synthetic.used,
        disabled: engine.synthetic.disabled,
        noRetry: engine.synthetic.noRetry
      },
      session: engine.current ? sessionReport(engine.current) : null,
      recentRewrites: state.rewrites.slice(-15)
    };
  }

  // ---- speed visualization ------------------------------------------------

  const SPEED_SAMPLES = 60;       // ~60s of history at 1s resolution
  const SPEED_TICK_MS = 1000;
  const SPEED_WINDOW_MS = 3000;   // trailing window for active-throughput math
  const MIN_TRANSFER_MS = 8;      // ignore sub-8ms reads (cache hits) as rate noise
  const speed = {
    mode: "speed",                // "speed" (Mbps) | "buffer" (seconds ahead)
    mbpsSeries: [],
    bufSeries: [],
    transfers: [],                // recent { start, end, bytes } media transfers
    currentMbps: 0,               // displayed (eased) rate — mirrors dispMbps
    dispMbps: 0,                  // eased value driving the curve + big readout
    avgMbps: 0,                   // slow average, used as the idle anchor
    peakMbps: 0,
    bufferSec: 0,
    dispMax: 0,                   // eased y-axis maximum (smooth rescaling)
    maxAt: 0,                     // when dispMax was last eased
    sawBytes: false,
    activeTicks: 0,               // ticks where playback advanced
    lastTime: 0,
    playing: false,               // playback advanced during the last tick
    prevMbps: 0,                  // dispMbps one tick ago, for the readout tween
    tickAt: 0                     // when the last sample was pushed
  };
  let speedTimer = null;

  // Panel motion. While the panel is open the chart is redrawn every frame so
  // the curve glides between the one-second samples; `live` adds the chart
  // effects reserved for smooth playback (glint, endpoint pulse). The status
  // dot has its own animation per state, see syncMotion().
  const motion = { raf: 0, live: false };
  const GLINT_MS = 3200;
  const PULSE_MS = 2000;

  function nowMs() {
    return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
  }

  // Record one completed media transfer for the active-throughput window. Bytes
  // are measured at the XHR layer rather than via Resource Timing, because
  // Bilibili's media CDN omits Timing-Allow-Origin and would report 0
  // transferSize. Fetch media bodies stay completely untouched; the graph falls
  // back to buffer health when the player uses fetch.
  function recordTransfer(start, end, bytes) {
    if (!(bytes > 0)) {
      return;
    }
    speed.sawBytes = true;
    // Near-instant reads are cache hits, not the network — counting them would
    // spike the rate to absurd values, so only their "bytes seen" flag matters.
    if (end - start >= MIN_TRANSFER_MS) {
      speed.transfers.push({ start: start, end: end, bytes: bytes });
    }
  }

  function installSpeedMeter() {
    if (!speedTimer && typeof setInterval === "function") {
      speedTimer = setInterval(tickSpeed, SPEED_TICK_MS);
    }
  }

  function tickSpeed() {
    const now = nowMs();
    // Active throughput: bytes per second of time actually spent transferring in
    // the trailing window, so the player's idle gaps between burst downloads
    // don't drag a fast link to zero.
    const sample = core.aggregateThroughput(speed.transfers, now, SPEED_WINDOW_MS);
    speed.transfers = speed.transfers.filter(function keep(tr) {
      return tr.end > now - SPEED_WINDOW_MS;
    });

    // Background tabs get throttled timers anyway; skip the series/UI work and
    // resume cleanly when the tab is visible again.
    if (document.hidden) {
      return;
    }

    let playing = false;
    try {
      if (watchedVideo) {
        if (watchedVideo.buffered && watchedVideo.buffered.length) {
          const end = watchedVideo.buffered.end(watchedVideo.buffered.length - 1);
          speed.bufferSec = Math.max(0, end - watchedVideo.currentTime);
        }
        playing = !watchedVideo.paused && !watchedVideo.ended &&
          watchedVideo.currentTime !== speed.lastTime;
        speed.lastTime = watchedVideo.currentTime;
      }
    } catch (_) {}

    if (sample > 0) {
      // Downloading: ease up toward the measured rate and keep a slow average
      // as the anchor to hold at once the burst ends.
      speed.avgMbps = speed.avgMbps > 0
        ? speed.avgMbps + (sample - speed.avgMbps) * 0.25
        : sample;
      speed.dispMbps += (sample - speed.dispMbps) * 0.45;
      if (sample > speed.peakMbps) {
        speed.peakMbps = sample;
      }
    } else if (playing) {
      // Buffer full, nothing in flight: the link is idle, not slow — drift
      // gently toward the recent average instead of dropping to 0.
      speed.dispMbps += (speed.avgMbps - speed.dispMbps) * 0.05;
    } else {
      // Genuinely idle (paused/ended): relax the reading toward 0.
      speed.dispMbps *= 0.8;
      speed.avgMbps *= 0.8;
    }
    if (speed.dispMbps < 0.05) {
      speed.dispMbps = 0;
    }
    speed.prevMbps = speed.currentMbps;
    speed.currentMbps = speed.dispMbps;
    speed.playing = playing;
    speed.tickAt = now;

    // One sample more than the chart shows: the oldest slides out on the left
    // while the newest slides in on the right.
    speed.mbpsSeries.push(speed.dispMbps);
    if (speed.mbpsSeries.length > SPEED_SAMPLES + 1) {
      speed.mbpsSeries.shift();
    }

    speed.bufSeries.push(speed.bufferSec);
    if (speed.bufSeries.length > SPEED_SAMPLES + 1) {
      speed.bufSeries.shift();
    }

    // If playback is clearly advancing but the CDN never exposes byte sizes
    // (opaque cross-origin), fall back to visualizing buffer health instead.
    if (playing) {
      speed.activeTicks += 1;
    }
    if (speed.mode === "speed" && !speed.sawBytes && speed.activeTicks >= 6) {
      speed.mode = "buffer";
    }

    if (panelIsOpen()) {
      syncMotion();
      drawSpeed();
      updateSpeedReadouts();
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  // How far the current one-second tick has run, 0..1. Without the frame loop
  // (panel closed, reduced motion) it is 1: the chart shows the newest sample
  // at the right edge and only moves once a second.
  function tickPhase() {
    if (!motion.raf) {
      return 1;
    }
    return Math.max(0, Math.min(1, (nowMs() - speed.tickAt) / SPEED_TICK_MS));
  }

  // Start or stop the frame loop and set the status dot's class. Called on
  // every tick and status render; the loop also ends itself once the panel
  // closes or the tab is hidden, and the next tick restarts it.
  function syncMotion(info) {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    const status = info || computeStatus();
    const run = panelIsOpen() && !document.hidden &&
      typeof root.requestAnimationFrame === "function" && !prefersReducedMotion();
    motion.live = run && speed.playing && status.key === "smooth";
    // The dot moves only while something is in progress: playback, a race, or
    // the player waiting for data. Slow, idle and off are standing conditions
    // and stay still.
    const animate = motion.live || (run && (status.key === "testing" || status.key === "buffering"));
    const dot = shadow.getElementById("ba-dot");
    if (dot) {
      const name = "ba-dot ba-" + status.key + (animate ? " ba-live" : "");
      if (dot.className !== name) {
        dot.className = name;
      }
    }
    if (run && !motion.raf) {
      motion.raf = root.requestAnimationFrame(motionFrame);
    } else if (!run && motion.raf) {
      if (typeof root.cancelAnimationFrame === "function") {
        root.cancelAnimationFrame(motion.raf);
      }
      motion.raf = 0;
    }
  }

  function motionFrame() {
    motion.raf = 0;
    if (!panelIsOpen() || document.hidden) {
      return;
    }
    motion.raf = root.requestAnimationFrame(motionFrame);
    drawSpeed();
    const shadow = getShadow();
    const value = shadow && shadow.getElementById("ba-spd-now");
    if (value && speed.mode === "speed") {
      const text = shownMbps().toFixed(1);
      if (value.textContent !== text) {
        value.textContent = text;
      }
    }
  }

  // The readout counts up or down to the new sample over the first 0.6 s of a
  // tick instead of jumping.
  function shownMbps() {
    const k = Math.min(1, tickPhase() / 0.6);
    const eased = 1 - Math.pow(1 - k, 3);
    return speed.prevMbps + (speed.currentMbps - speed.prevMbps) * eased;
  }

  function speedSeries() {
    return speed.mode === "buffer" ? speed.bufSeries : speed.mbpsSeries;
  }

  // Round a value up to a "nice" axis maximum (1/2/5 × 10ⁿ) so the y-scale
  // lands on tidy numbers instead of arbitrary peaks.
  function niceCeil(v) {
    if (!(v > 0)) {
      return 1;
    }
    const pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  // Light 3-point moving average to calm per-second jitter before smoothing.
  function smoothSeries(arr) {
    if (arr.length < 3) {
      return arr.slice();
    }
    const out = arr.slice();
    for (let i = 1; i < arr.length - 1; i += 1) {
      out[i] = (arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4;
    }
    return out;
  }

  // Monotone cubic (Fritsch–Carlson) tangents — same family as d3.curveMonotoneX:
  // smooth through every point with no overshoot. Best fit for time series.
  function monotoneTangents(xs, ys) {
    const n = xs.length;
    const slopes = new Array(n - 1);
    const tan = new Array(n);
    for (let i = 0; i < n - 1; i += 1) {
      slopes[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    }
    tan[0] = slopes[0];
    tan[n - 1] = slopes[n - 2];
    for (let i = 1; i < n - 1; i += 1) {
      tan[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
    }
    for (let i = 0; i < n - 1; i += 1) {
      if (slopes[i] === 0) {
        tan[i] = 0;
        tan[i + 1] = 0;
        continue;
      }
      const a = tan[i] / slopes[i];
      const b = tan[i + 1] / slopes[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        tan[i] = tau * a * slopes[i];
        tan[i + 1] = tau * b * slopes[i];
      }
    }
    return tan;
  }

  function tracePath(ctx, xs, ys, tan) {
    ctx.moveTo(xs[0], ys[0]);
    if (xs.length < 2) {
      return;
    }
    for (let i = 0; i < xs.length - 1; i += 1) {
      const dx = (xs[i + 1] - xs[i]) / 3;
      ctx.bezierCurveTo(
        xs[i] + dx, ys[i] + tan[i] * dx,
        xs[i + 1] - dx, ys[i + 1] - tan[i + 1] * dx,
        xs[i + 1], ys[i + 1]
      );
    }
  }

  function drawSpeed() {
    const shadow = getShadow();
    const canvas = shadow && shadow.getElementById("ba-spd-canvas");
    if (!canvas || typeof canvas.getContext !== "function") {
      return;
    }
    const dpr = root.devicePixelRatio || 1;
    const w = canvas.clientWidth || 296;
    const h = canvas.clientHeight || 46;
    // Assigning a canvas size reallocates its buffer, so only do it on change.
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const raw = speedSeries();
    const series = smoothSeries(raw);
    if (!series.length) {
      return;
    }
    const n = series.length;
    const p = tickPhase();
    // A new sample turns the previous endpoint into an interior point, which
    // the moving average would shift at once. Blend that in over the tick so
    // the endpoint dot leaves from exactly where it was.
    if (n >= 3) {
      series[n - 2] = raw[n - 2] + (series[n - 2] - raw[n - 2]) * p;
    }

    const floor = speed.mode === "buffer" ? 30 : 1;
    let dataMax = floor;
    for (let i = 0; i < n; i += 1) {
      if (series[i] > dataMax) {
        dataMax = series[i];
      }
    }
    // Ease the displayed maximum toward a nice ceiling so rescaling glides.
    // The rate is per second, so it holds whatever the frame rate is.
    const target = niceCeil(dataMax);
    const now = nowMs();
    const dt = speed.maxAt ? Math.min(1, (now - speed.maxAt) / SPEED_TICK_MS) : 1;
    speed.maxAt = now;
    speed.dispMax = speed.dispMax > 0
      ? speed.dispMax + (target - speed.dispMax) * (1 - Math.pow(0.75, dt))
      : target;
    const max = Math.max(speed.dispMax, floor);

    const padTop = 5;
    const padBottom = 2;
    // Room on the right for the endpoint dot and its pulse.
    const plotW = w - 7;
    // The curve ends at a point that travels from the previous sample to the
    // newest one over the tick, so it advances continuously. While the series
    // is still filling, the x-axis is elastic and stretches across the full
    // width; once it holds SPEED_SAMPLES + 1 points the window slides instead.
    const left = n > SPEED_SAMPLES ? p : 0;
    const right = Math.max(n - 2 + p, 0);
    const step = plotW / Math.max(right - left, 0.05);
    const xs = [];
    const ys = [];
    for (let i = 0; i < n; i += 1) {
      xs.push((i - left) * step);
      ys.push(h - padBottom - (series[i] / max) * (h - padTop - padBottom));
    }
    const tan = n >= 2 ? monotoneTangents(xs, ys) : [0];

    // Where the curve crosses the right edge of the plot: the last segment
    // evaluated at p (x is linear in the Bézier parameter here).
    const lx = n >= 2 ? plotW : 0;
    let ly = ys[n - 1];
    if (n >= 2 && p < 1) {
      const dx = step / 3;
      const y0 = ys[n - 2];
      const c0 = y0 + tan[n - 2] * dx;
      const c1 = ys[n - 1] - tan[n - 1] * dx;
      const q = 1 - p;
      ly = q * q * q * y0 + 3 * q * q * p * c0 + 3 * q * p * p * c1 + p * p * p * ys[n - 1];
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, n >= 2 ? plotW : w, h);
    ctx.clip();

    // Gradient area fill.
    ctx.beginPath();
    tracePath(ctx, xs, ys, tan);
    ctx.lineTo(xs[n - 1], h);
    ctx.lineTo(xs[0], h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(" + speedPaint.accentRgb + ",0.30)");
    grad.addColorStop(1, "rgba(" + speedPaint.accentRgb + ",0.02)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Smooth line.
    ctx.beginPath();
    tracePath(ctx, xs, ys, tan);
    ctx.lineWidth = 2;
    ctx.strokeStyle = speedPaint.accent;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // Smooth playback: a highlight runs along the line toward the endpoint.
    if (motion.live) {
      // A wide accent glow under a white core, so it reads on both themes.
      const band = 46;
      const gx = -band + ((now % GLINT_MS) / GLINT_MS) * (plotW + band * 2);
      const glow = ctx.createLinearGradient(gx - band, 0, gx + band, 0);
      glow.addColorStop(0, "rgba(" + speedPaint.accentRgb + ",0)");
      glow.addColorStop(0.5, "rgba(" + speedPaint.accentRgb + ",0.38)");
      glow.addColorStop(1, "rgba(" + speedPaint.accentRgb + ",0)");
      ctx.lineWidth = 6;
      ctx.strokeStyle = glow;
      ctx.stroke();
      const core = ctx.createLinearGradient(gx - band / 2, 0, gx + band / 2, 0);
      core.addColorStop(0, "rgba(255,255,255,0)");
      core.addColorStop(0.5, "rgba(255,255,255,0.6)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.lineWidth = 2;
      ctx.strokeStyle = core;
      ctx.stroke();
    }
    ctx.restore();

    // Smooth playback: the endpoint sends out a fading ring.
    if (motion.live) {
      const k = (now % PULSE_MS) / PULSE_MS;
      const eased = 1 - Math.pow(1 - k, 3);
      ctx.beginPath();
      ctx.arc(lx, ly, 3.2 + eased * 3.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + speedPaint.accentRgb + "," + (0.4 * (1 - eased)).toFixed(3) + ")";
      ctx.fill();
    }

    // Leading-edge dot at the current value.
    ctx.beginPath();
    ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = speedPaint.accent;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = speedPaint.card;
    ctx.stroke();
  }

  function updateSpeedReadouts() {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    const card = shadow.getElementById("ba-speed");
    const label = shadow.getElementById("ba-spd-label");
    const value = shadow.getElementById("ba-spd-now");
    const unit = shadow.getElementById("ba-spd-unit");
    const foot = shadow.getElementById("ba-spd-foot");
    if (!card) {
      return;
    }
    const series = speedSeries();
    const empty = series.length === 0 || (!speed.sawBytes && speed.mode === "speed");
    card.className = empty ? "ba-speed empty" : "ba-speed";
    if (label) {
      label.textContent = t(speed.mode === "buffer" ? "bufTitle" : "spdTitle");
    }
    if (unit) {
      unit.textContent = speed.mode === "buffer" ? t("bufUnit") : t("spdUnit");
    }
    if (value) {
      value.textContent = speed.mode === "buffer"
        ? String(Math.round(speed.bufferSec))
        : shownMbps().toFixed(1);
    }
    if (foot) {
      foot.textContent = speed.mode === "buffer"
        ? t("spdBuffering")
        : t("spdPeak") + " " + speed.peakMbps.toFixed(1) + " " + t("spdUnit");
    }
  }

  // ---- immersive badge handling ------------------------------------------

  function setBadgeHidden(hidden) {
    const host = document.getElementById(BUTTON_ID);
    if (!host) {
      return;
    }
    host.classList.toggle(IMMERSED_CLASS, hidden);
  }

  function panelIsOpen() {
    const host = document.getElementById(BUTTON_ID);
    return !!(host && host.shadowRoot && host.shadowRoot.querySelector(".ba-panel.open"));
  }

  // The video just moved to another server: one ring leaves the badge and the
  // bolt flickers. The panel is usually closed at that moment, so this is the
  // only sign of it. Skipped where it would not be seen, or is not wanted.
  function zapBadge() {
    const host = document.getElementById(BUTTON_ID);
    const badge = host && host.shadowRoot && host.shadowRoot.querySelector(".ba-toggle");
    if (!badge || !badge.classList || document.hidden || prefersReducedMotion() ||
        host.classList.contains(IMMERSED_CLASS)) {
      return;
    }
    // Dropping the class and reading layout restarts a zap still in flight.
    badge.classList.remove("ba-zap");
    void badge.offsetWidth;
    badge.classList.add("ba-zap");
  }

  function revealBadge() {
    setBadgeHidden(false);
    if (revealTimer) {
      clearTimeout(revealTimer);
    }
    revealTimer = setTimeout(function () {
      if (immersive && !panelIsOpen()) {
        setBadgeHidden(true);
      }
    }, REVEAL_TIMEOUT);
  }

  function setImmersive(next) {
    if (next === immersive) {
      return;
    }
    immersive = next;
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
    setBadgeHidden(immersive && !panelIsOpen());
  }

  // Live rooms run a different player: no .bpx-player-container, no data-screen,
  // nothing detectScreenMode() can read (checked against a real room — a live
  // page has zero bpx-* elements). Without this the badge sits permanently over
  // the chat column.
  //
  // Kept separate from detectScreenMode() on purpose. That function answers
  // "what screen mode is the player in", and answering "web" for a live page
  // would also satisfy the setLifted() test below, nudging the badge to
  // bottom:84px on every live page as a side effect.
  function isLivePage() {
    const host = root.location && typeof root.location.hostname === "string"
      ? root.location.hostname.toLowerCase()
      : "";
    return host === "live.bilibili.com" || host === "live.bilibili.tv";
  }

  function detectScreenMode() {
    const container = document.querySelector(".bpx-player-container");
    if (container) {
      const mode = container.getAttribute("data-screen");
      if (mode) {
        return mode;
      }
    }
    if (document.querySelector(".mode-webscreen")) {
      return "web";
    }
    return "normal";
  }

  function setLifted(lifted) {
    const host = document.getElementById(BUTTON_ID);
    if (host) {
      host.classList.toggle(LIFTED_CLASS, lifted);
    }
  }

  function refreshImmersive() {
    const mode = detectScreenMode();
    setLifted(mode === "web" || mode === "full" || mode === "wide");
    setImmersive(mode === "web" || mode === "full" || isLivePage());
  }

  function ensurePlayerObserver() {
    const container = document.querySelector(".bpx-player-container");
    if (container && container !== observedContainer) {
      if (playerObserver) {
        playerObserver.disconnect();
      }
      observedContainer = container;
      playerObserver = new MutationObserver(refreshImmersive);
      playerObserver.observe(container, {
        attributes: true,
        attributeFilter: ["data-screen", "class"]
      });
    }
    refreshImmersive();
    watchVideo();
  }

  function handlePointerMove(event) {
    if (!immersive) {
      return;
    }
    const nearRight = (root.innerWidth - event.clientX) < REVEAL_HOTZONE;
    const nearBottom = (root.innerHeight - event.clientY) < REVEAL_HOTZONE;
    if (nearRight && nearBottom) {
      revealBadge();
    }
  }

  function installImmersiveWatch() {
    document.addEventListener("mousemove", handlePointerMove, { passive: true });
    document.addEventListener("fullscreenchange", refreshImmersive);
    document.addEventListener("webkitfullscreenchange", refreshImmersive);
    document.addEventListener("visibilitychange", onVisibilityChange);
    ensurePlayerObserver();
    setInterval(ensurePlayerObserver, 1500);
  }

  // ---- UI -----------------------------------------------------------------

  const STRINGS = {
    en: {
      title: "Bilibili Accelerator",
      status: {
        off: ["Acceleration off", "Turn it on to move slow videos to faster servers"],
        idle: ["Ready", "Open a video and it'll kick in"],
        smooth: ["Playing smoothly", ""],
        testing: ["Testing other servers…", ""],
        buffering: ["Buffering", ""],
        slow: ["Slow network", ""]
      },
      notes: {
        native: function (server) { return "Native server · " + server; },
        switched: function (server) { return "Switched to " + server; },
        fixed: function (server) { return "Fixed server · " + server; },
        short: "The current server is too slow for this video",
        failing: "The current server is failing requests",
        stuck: "This part of the video is downloading too slowly",
        comparing: function (n) { return "Comparing " + n + " servers"; },
        keepingUp: "The server is keeping up; waiting for the player",
        measuring: "Measuring the current server",
        fastest: function (n) { return "Compared " + n + " servers; this one is fastest"; }
      },
      regions: { overseas: "Overseas", mainland: "Mainland" },
      vendors: { tencent: "Tencent Cloud", alibaba: "Alibaba Cloud", huawei: "Huawei Cloud", akamai: "Akamai" },
      switchCount: function (n) { return "Switched servers " + n + (n === 1 ? " time" : " times") + " on this video"; },
      p2pCount: function (n) { return "Kept " + n + " P2P node" + (n === 1 ? "" : "s") + " out of playback"; },
      spdTitle: "Download speed",
      spdUnit: "Mbps",
      spdPeak: "peak",
      spdBuffering: "seconds buffered ahead",
      bufTitle: "Buffer ahead",
      bufUnit: "s",
      spdWaiting: "Waiting for playback…",
      masterTitle: "Acceleration",
      masterNote: "Speed up slow videos automatically",
      retest: "Test other servers",
      advShow: "Advanced settings",
      advHide: "Hide advanced",
      fAccent: "Accent",
      themeLight: "Light theme", themeDark: "Dark theme",
      accents: {
        bili: "Bilibili Blue", teal: "Teal", emerald: "Emerald", violet: "Violet",
        pink: "Pink", sunset: "Sunset", graphite: "Graphite"
      },
      fServer: "Server", fWhen: "Apply to", fFixed: "Fixed server", fMcdn: "MCDN",
      selAuto: "Auto (by measurement)", selFixed: "Use a fixed server",
      hostCustom: "Custom…", fCustomHost: "Server address", hostPlaceholder: "Enter a server address",
      modeBad: "P2P/PCDN nodes only", modeForce: "All video requests",
      mcdnAll: "Proxy all MCDN", mcdnV1: "Proxy /v1 only", mcdnReplace: "Replace host",
      portTitle: "Catch hidden PCDN", portNote: "Treat odd ports as slow (recommended)",
      stallTitle: "Auto-switch servers", stallNote: "Switch when a server can't keep up",
      akamaiTitle: "Rewrite Akamai", akamaiNote: "Only if Akamai is slow on your network",
      p2pTitle: "Stop bandwidth sharing", p2pNote: "Block Bilibili's P2P upload (reload to apply)",
      diag: "Copy report", diagCopied: "Copied ✓", diagConsole: "See console",
      reload: "Reload"
    },
    zh: {
      title: "Bilibili Accelerator",
      status: {
        off: ["已关闭加速", "打开后自动为慢视频选择更快的线路"],
        idle: ["就绪", "打开视频后自动生效"],
        smooth: ["播放流畅", ""],
        testing: ["正在测试其他线路…", ""],
        buffering: ["缓冲中", ""],
        slow: ["网络较慢", ""]
      },
      notes: {
        native: function (server) { return "原生线路 · " + server; },
        switched: function (server) { return "已切换到 " + server; },
        fixed: function (server) { return "固定线路 · " + server; },
        short: "当前线路速度不足",
        failing: "当前线路请求失败",
        stuck: "当前片段下载过慢",
        comparing: function (n) { return "正在比较 " + n + " 条线路"; },
        keepingUp: "线路速度正常，等待播放器缓冲",
        measuring: "正在测量当前线路",
        fastest: function (n) { return "已比较 " + n + " 条线路，当前线路最快"; }
      },
      regions: { overseas: "海外", mainland: "大陆" },
      vendors: { tencent: "腾讯云", alibaba: "阿里云", huawei: "华为云", akamai: "Akamai" },
      switchCount: function (n) { return "本视频切换了 " + n + " 次线路"; },
      p2pCount: function (n) { return "已避开 " + n + " 个 P2P 节点"; },
      spdTitle: "下载速度",
      spdUnit: "Mbps",
      spdPeak: "峰值",
      spdBuffering: "已缓冲秒数",
      bufTitle: "缓冲时长",
      bufUnit: "秒",
      spdWaiting: "等待播放…",
      masterTitle: "加速",
      masterNote: "自动为慢视频提速",
      retest: "测试其他线路",
      advShow: "高级设置",
      advHide: "收起高级设置",
      fAccent: "主题色",
      themeLight: "浅色", themeDark: "深色",
      accents: {
        bili: "哔哩蓝", teal: "青碧", emerald: "翠绿", violet: "星紫",
        pink: "少女粉", sunset: "落日橙", graphite: "石墨灰"
      },
      fServer: "服务器", fWhen: "适用范围", fFixed: "固定服务器", fMcdn: "MCDN",
      selAuto: "自动（按实测选择）", selFixed: "使用固定服务器",
      hostCustom: "自定义…", fCustomHost: "服务器地址", hostPlaceholder: "请输入服务器地址",
      modeBad: "仅 P2P/PCDN 节点", modeForce: "所有视频请求",
      mcdnAll: "代理所有 MCDN", mcdnV1: "仅代理 /v1", mcdnReplace: "替换域名",
      portTitle: "抓取隐藏 PCDN", portNote: "把奇怪端口的服务器当作慢节点（推荐）",
      stallTitle: "自动切换线路", stallNote: "线路速度不足时，自动切换到更快的线路",
      akamaiTitle: "改写 Akamai", akamaiNote: "仅当 Akamai 在你的网络上很慢时使用",
      p2pTitle: "停止带宽共享", p2pNote: "阻止 B 站的 P2P 上传（刷新后生效）",
      diag: "复制诊断报告", diagCopied: "已复制 ✓", diagConsole: "见控制台",
      reload: "刷新"
    }
  };

  function lang() {
    return config.lang === "zh" ? "zh" : "en";
  }

  function t(key) {
    return STRINGS[lang()][key];
  }

  function getShadow() {
    const host = document.getElementById(BUTTON_ID);
    return host && host.shadowRoot;
  }

  // What the panel reports, from what the engine measured and did. Live pages
  // and pages without a video keep the simple states.
  function computeStatus() {
    if (!config.enabled) {
      return { key: "off", legacy: true };
    }
    const session = engine.current;
    if (!session || isLivePage()) {
      return { key: state.status === "smooth" ? "smooth" : "idle", legacy: true };
    }
    const host = session.active || session.lastHost;
    const stats = host ? session.hosts[host] : null;
    const rateBps = stats ? stats.est.estimate() : null;
    const info = {
      key: "smooth",
      session,
      host,
      rateBps,
      // Below what the stream needs, by the same margin a shortfall race uses.
      short: rateBps !== null && session.requiredBps > 0 &&
        rateBps < routing.SHORTFALL_RATE_FACTOR * session.requiredBps,
      // A retry can pin the video to the host it is on without switching it.
      switched: session.switches.length > 0 && !!session.active && session.active !== session.assigned
    };
    if (session.racing) {
      info.key = "testing";
    } else if (engine.stalling) {
      info.key = "buffering";
    } else if (session.verdict && info.short) {
      info.key = "slow";
    }
    if (session.verdict && (info.key === "slow" ||
        (session.verdict.manual && nowMs() - session.verdict.at < VERDICT_NOTE_MS))) {
      info.verdict = session.verdict;
    }
    return info;
  }

  // "海外 · 腾讯云" rather than upos-sz-mirrorcosov.bilivideo.com.
  function hostLabel(host) {
    const d = routing.describeHost(host);
    const s = STRINGS[lang()];
    const vendor = d.vendor ? s.vendors[d.vendor] : d.id;
    return d.region ? s.regions[d.region] + " · " + vendor : vendor;
  }

  // The status line says which server is in use and what happened, with no
  // rates: the speed card below it is the one place that shows one. The
  // engine's own estimate counts video fragments only, per request, and would
  // never match the card, which averages every media transfer over a few
  // seconds. Each note fits one line of the panel in both languages.
  function statusNote(info) {
    const s = STRINGS[lang()];
    if (info.legacy || !info.session) {
      return s.status[info.key] ? s.status[info.key][1] : s.status.idle[1];
    }
    const n = s.notes;
    const server = info.host ? hostLabel(info.host) : "";
    if (info.key === "testing") {
      const racing = info.session.racing;
      if (racing.trigger === "manual") {
        return n.comparing(racing.compared);
      }
      if (racing.trigger === "errors") {
        return n.failing;
      }
      return racing.trigger === "stuck" ? n.stuck : n.short;
    }
    if (info.key === "buffering") {
      if (info.rateBps === null) {
        return n.measuring;
      }
      return info.short ? n.short : n.keepingUp;
    }
    if (info.verdict) {
      return n.fastest(info.verdict.tested);
    }
    if (!server) {
      return n.measuring;
    }
    if (config.selection !== "auto") {
      return n.fixed(server);
    }
    return info.switched ? n.switched(server) : n.native(server);
  }

  function countText(info) {
    const s = STRINGS[lang()];
    const switches = info && info.session ? info.session.switches.length : 0;
    if (switches > 0) {
      return s.switchCount(switches);
    }
    const p2p = Object.keys(state.p2pAvoided).length;
    return p2p > 0 ? s.p2pCount(p2p) : "";
  }

  // Redraw when anything the panel shows would change: the state, the server,
  // the switch count, the verdict, or whether the server measures short (which
  // decides whether 测试其他线路 is offered).
  function refreshStatus() {
    const info = computeStatus();
    const signature = [info.key, info.host || "", info.session ? info.session.switches.length : 0,
      !!info.short, info.verdict ? info.verdict.at : 0].join("|");
    if (signature !== engine.rendered) {
      engine.rendered = signature;
      renderStatus();
    }
  }

  // Re-translate every tagged node + the dynamic bits, no reload needed.
  function applyLang() {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    shadow.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    shadow.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    const adv = shadow.querySelector(".ba-adv");
    setAdvToggleLabel(adv && adv.classList.contains("open"));
    updateLangButtons();
    updateAppearanceControls();
    updateSpeedReadouts();
    renderStatus();
  }

  function updateLangButtons() {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    setSegActive(shadow.getElementById("ba-lang-seg"), lang() === "zh" ? 1 : 0);
  }

  // Reflect the stored accent + theme back onto the picker controls, and keep
  // the swatch tooltips localized. Safe to call before the panel exists.
  function updateAppearanceControls() {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    const names = STRINGS[lang()].accents || {};
    shadow.querySelectorAll(".ba-sw").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.accent === config.accent ? "true" : "false");
      const name = names[b.dataset.accent];
      if (name) {
        b.title = name;
        b.setAttribute("aria-label", name);
      }
    });
    const themeSeg = shadow.getElementById("ba-theme-seg");
    if (themeSeg) {
      // Slide the thumb to the resolved theme (also animates when the OS flips).
      setSegActive(themeSeg, resolveTheme() === "dark" ? 1 : 0);
      const opts = themeSeg.querySelectorAll(".ba-seg-opt");
      const labels = [t("themeLight"), t("themeDark")];
      opts.forEach(function (opt, i) {
        opt.title = labels[i];
        opt.setAttribute("aria-label", labels[i]);
      });
    }
  }

  function setAdvToggleLabel(open) {
    const shadow = getShadow();
    if (!shadow) {
      return;
    }
    const label = shadow.getElementById("ba-adv-label");
    const arrow = shadow.getElementById("ba-adv-arrow");
    if (label) {
      label.textContent = t(open ? "advHide" : "advShow");
    }
    if (arrow) {
      arrow.textContent = open ? "▴" : "▾";
    }
  }

  function makeOption(value, key, selectedValue) {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.i18n = key;
    option.textContent = t(key);
    option.selected = value === selectedValue;
    return option;
  }

  function createSelect(options, value, onChange) {
    const select = document.createElement("select");
    select.className = "ba-control";
    select.addEventListener("change", function () { onChange(select.value); });
    options.forEach(function (option) {
      select.appendChild(makeOption(option.value, option.key, value));
    });
    return select;
  }

  function createField(key, control) {
    const label = document.createElement("label");
    label.className = "ba-field";
    const caption = document.createElement("span");
    caption.dataset.i18n = key;
    caption.textContent = t(key);
    label.appendChild(caption);
    label.appendChild(control);
    return label;
  }

  // Like createField but a plain <div> instead of <label>, so a row of buttons
  // (the accent swatches) doesn't forward stray clicks to the first button.
  function createSwatchField(key, control) {
    const row = document.createElement("div");
    row.className = "ba-field";
    const caption = document.createElement("span");
    caption.dataset.i18n = key;
    caption.textContent = t(key);
    row.appendChild(caption);
    row.appendChild(control);
    return row;
  }

  function createAccentPicker() {
    const wrap = document.createElement("div");
    wrap.className = "ba-swatches";
    core.ACCENT_KEYS.forEach(function (key) {
      const preset = ACCENT_PRESETS[key];
      if (!preset) {
        return;
      }
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "ba-sw";
      swatch.dataset.accent = key;
      swatch.style.background = preset.hex;
      swatch.setAttribute("aria-pressed", key === config.accent ? "true" : "false");
      swatch.addEventListener("click", function () {
        saveConfig(Object.assign({}, config, { accent: key }));
        applyTheme();
      });
      wrap.appendChild(swatch);
    });
    return wrap;
  }

  function createSwitchRow(titleKey, noteKey, checked, onChange) {
    const row = document.createElement("label");
    row.className = "ba-switch-row";
    const copy = document.createElement("span");
    copy.className = "ba-switch-text";
    const titleEl = document.createElement("span");
    titleEl.className = "ba-switch-title";
    titleEl.dataset.i18n = titleKey;
    titleEl.textContent = t(titleKey);
    const noteEl = document.createElement("span");
    noteEl.className = "ba-switch-note";
    noteEl.dataset.i18n = noteKey;
    noteEl.textContent = t(noteKey);
    copy.appendChild(titleEl);
    copy.appendChild(noteEl);
    const sw = document.createElement("span");
    sw.className = "ba-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", function () { onChange(input.checked); });
    const slider = document.createElement("span");
    slider.className = "ba-slider";
    sw.appendChild(input);
    sw.appendChild(slider);
    row.appendChild(copy);
    row.appendChild(sw);
    return row;
  }

  function renderStatus() {
    const host = document.getElementById(BUTTON_ID);
    const shadow = host && host.shadowRoot;
    if (!shadow) {
      return;
    }
    const info = computeStatus();
    const strings = STRINGS[lang()];
    const words = strings.status[info.key] || strings.status.idle;

    const word = shadow.getElementById("ba-word");
    const note = shadow.getElementById("ba-note");
    const count = shadow.getElementById("ba-count");
    const retestButton = shadow.getElementById("ba-retest");
    const master = shadow.getElementById("ba-master");

    syncMotion(info);
    if (word) {
      word.textContent = words[0];
    }
    if (note) {
      note.textContent = statusNote(info);
    }
    if (count) {
      count.textContent = countText(info);
    }
    if (master) {
      master.checked = config.enabled;
    }
    if (retestButton) {
      // Offered only when there is something to fix: this video stalled, or
      // the server measured below what the stream needs.
      const session = info.session;
      const relevant = !info.legacy && !!session && !session.racing && autoRouting() && isPlayerPage() &&
        (session.stalls > 0 || info.key === "buffering" || info.short);
      retestButton.style.display = relevant ? "block" : "none";
    }
  }

  function installUi() {
    if (!document.documentElement || document.getElementById(BUTTON_ID)) {
      return;
    }

    const host = document.createElement("div");
    host.id = BUTTON_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = [
      // Appearance tokens (light + Bilibili-blue baseline). applyTheme() layers
      // the resolved accent + dark/light surface over these via inline vars on
      // the host, which inherit across the shadow boundary.
      ":host{--ba-accent:#00aeec;--ba-accent-strong:#0091cc;--ba-grad-a:#00b5f5;--ba-grad-b:#0091cc;--ba-accent-shadow:rgba(0,174,236,.42);--ba-surface:rgba(255,255,255,.97);--ba-card:#fff;--ba-border:#e5eaf0;--ba-border-in:#d5dde5;--ba-ink:#17202a;--ba-ink-strong:#111827;--ba-ink-mid:#46515c;--ba-ink-soft:#6b7785;--ba-ink-faint:#8a95a1;--ba-dot-bg:#eef2f6;--ba-dot:#9aa6b2;--ba-good-bg:#e6f8ee;--ba-good:#19a974;--ba-warn-bg:#fff4e0;--ba-warn:#e8910c;--ba-slider-off:#c9d3dd;--ba-panel-shadow:rgba(21,32,43,.24);--ba-chevron:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236b7785' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")}",
      ":host{position:fixed;right:18px;bottom:18px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ba-ink);transition:opacity .25s ease}",
      ":host(.ba-immersed){opacity:0;pointer-events:none}",
      ":host(.ba-lifted){bottom:84px}",
      "*{box-sizing:border-box}",
      "button,input,select{font:inherit}",
      // The rim is an inset shadow of one width all the way round. It used to
      // be a translucent border plus a highlight along the top edge only, which
      // left the ring bright and thick on top and faint at the bottom.
      ".ba-toggle{position:relative;display:grid;place-items:center;width:40px;height:40px;border:none;border-radius:50%;background:linear-gradient(135deg,var(--ba-grad-a),var(--ba-grad-b));color:#fff;box-shadow:0 8px 22px var(--ba-accent-shadow),0 0 0 1px rgba(255,255,255,.34) inset;cursor:pointer;padding:0;transition:transform .16s ease,box-shadow .16s ease}",
      ".ba-toggle:hover{transform:translateY(-1px);box-shadow:0 10px 28px var(--ba-accent-shadow),0 0 0 1px rgba(255,255,255,.34) inset}",
      ".ba-toggle:active{transform:scale(.93)}",
      ".ba-toggle svg{width:20px;height:20px;display:block}",
      // The badge sits beside the video on every page, so it never loops. The
      // bolt flickers once on hover, and once with a ring when zapBadge() marks
      // a server switch.
      ".ba-toggle:hover svg,.ba-toggle.ba-zap svg{animation:ba-strike .5s ease-out}",
      ".ba-toggle.ba-zap:after{content:'';position:absolute;inset:0;border-radius:50%;border:2px solid var(--ba-accent);opacity:0;pointer-events:none;animation:ba-burst .8s cubic-bezier(.2,.6,.35,1)}",
      "@keyframes ba-strike{0%,100%{transform:scale(1);opacity:1}18%{transform:scale(1.22) rotate(-6deg);opacity:.5}32%{opacity:1}46%{transform:scale(1.12) rotate(3deg);opacity:.65}62%{opacity:1}}",
      // 1.8 keeps the ring inside the 18px between the badge and the viewport edge.
      "@keyframes ba-burst{0%{opacity:.75;transform:scale(1)}100%{opacity:0;transform:scale(1.8)}}",
      ".ba-panel{display:none;flex-direction:column;position:absolute;right:0;bottom:48px;width:min(340px,calc(100vw - 36px));max-height:calc(100vh - 96px);padding:16px;border:1px solid var(--ba-border);border-radius:14px;background:var(--ba-surface);box-shadow:0 18px 46px var(--ba-panel-shadow);backdrop-filter:saturate(180%) blur(18px);-webkit-backdrop-filter:saturate(180%) blur(18px)}",
      ".ba-panel.open{display:flex}",
      ".ba-body{overflow-y:auto;min-height:0}",
      ".ba-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}",
      ".ba-head>svg{width:18px;height:18px;color:var(--ba-accent);flex:0 0 auto}",
      ".ba-seg{position:relative;display:inline-grid;grid-template-columns:32px 32px;height:24px;border:1px solid var(--ba-border-in);border-radius:8px;background:var(--ba-dot-bg);overflow:hidden;flex:0 0 auto}",
      ".ba-seg-end{margin-left:auto}",
      ".ba-seg-thumb{position:absolute;z-index:0;top:0;bottom:0;left:0;width:50%;background:var(--ba-accent);border-radius:7px;transition:transform .2s cubic-bezier(.4,0,.2,1)}",
      ".ba-seg[data-active=\"1\"] .ba-seg-thumb{transform:translateX(100%)}",
      ".ba-seg-opt{position:relative;z-index:1;display:grid;place-items:center;border:none;background:none;padding:0;cursor:pointer;color:var(--ba-ink-soft);font-size:11px;font-weight:700;line-height:1;transition:color .18s ease}",
      ".ba-seg-opt svg{width:15px;height:15px;display:block}",
      ".ba-seg-opt[aria-pressed=\"true\"]{color:#fff}",
      "@media (prefers-reduced-motion:reduce){.ba-seg-thumb{transition:none}.ba-toggle:hover svg{animation:none}}",
      ".ba-hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding:4px 0 14px}",
      ".ba-dot{position:relative;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;margin-bottom:8px;background:var(--ba-dot-bg);transition:background-color .3s ease}",
      ".ba-dot:after{content:'';position:relative;width:14px;height:14px;border-radius:50%;background:var(--ba-dot);transition:background-color .3s ease}",
      // syncMotion() sets ba-live while the state is in progress, and never
      // under prefers-reduced-motion. Smooth: two rings leave the dot half a
      // cycle apart while the dot breathes.
      ".ba-ring{position:absolute;inset:0;border-radius:50%;background:var(--ba-good);opacity:0;pointer-events:none}",
      ".ba-smooth.ba-live .ba-ring{animation:ba-ripple 2.8s cubic-bezier(.2,.6,.35,1) infinite}",
      ".ba-smooth.ba-live .ba-ring+.ba-ring{animation-delay:1.4s}",
      ".ba-smooth.ba-live:after{animation:ba-breathe 2.8s ease-in-out infinite}",
      "@keyframes ba-ripple{0%{opacity:.42;transform:scale(.3)}75%,100%{opacity:0;transform:scale(1.3)}}",
      "@keyframes ba-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}",
      // Testing: an arc circles the dot, as a spinner would.
      ".ba-testing.ba-live .ba-ring:first-child{inset:-4px;opacity:1;background:conic-gradient(transparent 25%,var(--ba-warn));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px));mask:radial-gradient(farthest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px));animation:ba-spin 1s linear infinite}",
      "@keyframes ba-spin{to{transform:rotate(360deg)}}",
      // Buffering: a ring closes in on the dot, the smooth ripple in reverse,
      // and the dot dims until it arrives.
      ".ba-buffering.ba-live .ba-ring:first-child{background:var(--ba-warn);animation:ba-gather 1.5s cubic-bezier(.45,0,.85,.6) infinite}",
      ".ba-buffering.ba-live:after{animation:ba-dim 1.5s ease-in-out infinite}",
      "@keyframes ba-gather{0%{opacity:0;transform:scale(1.2)}25%{opacity:.34}100%{opacity:.12;transform:scale(.3)}}",
      "@keyframes ba-dim{0%,100%{opacity:1}55%{opacity:.5}}",
      ".ba-dot.ba-smooth{background:var(--ba-good-bg)}.ba-dot.ba-smooth:after{background:var(--ba-good)}",
      ".ba-dot.ba-testing,.ba-dot.ba-buffering,.ba-dot.ba-slow{background:var(--ba-warn-bg)}.ba-dot.ba-testing:after,.ba-dot.ba-buffering:after,.ba-dot.ba-slow:after{background:var(--ba-warn)}",
      ".ba-dot.ba-off:after{background:var(--ba-dot)}",
      ".ba-word{font-size:15px;font-weight:800;color:var(--ba-ink)}",
      // Notes are written to fit one line. When one can't (a custom host name,
      // a narrow window), balance the two lines rather than leave a stub.
      ".ba-subnote{font-size:11px;color:var(--ba-ink-soft);margin-top:2px;line-height:1.4;text-wrap:balance}",
      ".ba-count{font-size:11px;color:var(--ba-ink-faint);margin-top:6px;text-wrap:balance}",
      ".ba-speed{margin:0 0 10px;padding:10px 12px;border:1px solid var(--ba-border);border-radius:10px;background:var(--ba-card)}",
      ".ba-speed-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}",
      ".ba-speed-label{font-size:12px;font-weight:700;color:var(--ba-ink-mid)}",
      ".ba-speed-val{font-size:11px;color:var(--ba-ink-faint);white-space:nowrap}",
      ".ba-speed-val b{font-size:17px;color:var(--ba-accent);font-weight:800;margin-right:3px}",
      ".ba-spd-canvas{display:block;width:100%;height:46px;margin-top:6px}",
      ".ba-spd-foot{font-size:10px;color:var(--ba-ink-faint);margin-top:4px}",
      ".ba-spd-empty{display:none;font-size:11px;color:var(--ba-ink-faint);padding:8px 0 4px;text-align:center}",
      ".ba-speed.empty .ba-spd-canvas,.ba-speed.empty .ba-spd-foot,.ba-speed.empty .ba-speed-val{display:none}",
      ".ba-speed.empty .ba-spd-empty{display:block}",
      ".ba-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;padding:10px 12px;border:1px solid var(--ba-border);border-radius:10px;background:var(--ba-card)}",
      ".ba-switch-row[hidden]{display:none}",
      ".ba-switch-text{display:grid;gap:2px}",
      ".ba-switch-title{font-size:13px;font-weight:750;color:var(--ba-ink)}",
      ".ba-switch-note{font-size:11px;color:var(--ba-ink-soft);line-height:1.3;text-wrap:balance}",
      ".ba-switch{position:relative;display:inline-flex;width:42px;height:24px;flex:0 0 auto}",
      ".ba-switch input{position:absolute;opacity:0;width:1px;height:1px}",
      ".ba-slider{position:absolute;inset:0;border-radius:999px;background:var(--ba-slider-off);cursor:pointer;transition:background .16s ease}",
      ".ba-slider:before{content:'';position:absolute;width:20px;height:20px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.22);transition:transform .16s ease}",
      ".ba-switch input:checked+.ba-slider{background:var(--ba-accent)}",
      ".ba-switch input:checked+.ba-slider:before{transform:translateX(18px)}",
      ".ba-retest{display:none;width:100%;height:38px;margin-top:4px;border:1px solid var(--ba-accent);border-radius:10px;background:var(--ba-accent);color:#fff;font-size:13px;font-weight:700;cursor:pointer}",
      ".ba-retest:hover{background:var(--ba-accent-strong);border-color:var(--ba-accent-strong)}",
      ".ba-adv-toggle{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;flex:0 0 auto;margin-top:10px;padding-top:11px;border:none;border-top:1px solid var(--ba-border);background:none;color:var(--ba-ink-soft);font-size:11px;font-weight:650;cursor:pointer}",
      ".ba-adv-toggle:hover{color:var(--ba-accent)}",
      ".ba-adv{display:none;margin-top:8px}",
      ".ba-adv.open{display:block}",
      ".ba-field{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:9px;margin:9px 0;font-size:12px}",
      ".ba-field[hidden]{display:none}",
      ".ba-field span{color:var(--ba-ink-mid);font-weight:650}",
      ".ba-control,.ba-field input[type=text],.ba-field select{width:100%;min-width:0;height:32px;border:1px solid var(--ba-border-in);border-radius:8px;padding:0 9px;background:var(--ba-card);color:var(--ba-ink);outline:none;font-size:11px}",
      // Native <select> adds its own start inset on top of our padding (4px in
      // Chromium, 8px in WebKit), so its text never lined up with a text input.
      // Dropping the native appearance removes the inset; the chevron is ours.
      ".ba-field select{-webkit-appearance:none;appearance:none;padding-right:26px;background-image:var(--ba-chevron);background-repeat:no-repeat;background-position:right 8px center;background-size:8px 5px}",
      ".ba-swatches{display:flex;align-items:center;gap:7px;min-height:32px;flex-wrap:wrap}",
      ".ba-sw{width:22px;height:22px;border-radius:50%;padding:0;border:none;cursor:pointer;box-shadow:0 0 0 1px var(--ba-border-in) inset;transition:transform .12s ease}",
      ".ba-sw:hover{transform:scale(1.12)}",
      ".ba-sw[aria-pressed=\"true\"]{box-shadow:0 0 0 2px var(--ba-card),0 0 0 4px var(--ba-accent)}",
      ".ba-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}",
      ".ba-actions button{height:32px;border:1px solid var(--ba-border-in);border-radius:8px;background:var(--ba-card);color:var(--ba-ink);padding:0 11px;cursor:pointer;font-size:12px;font-weight:700}",
      ".ba-actions button.primary{border-color:var(--ba-accent);background:var(--ba-accent);color:#fff}",
      ".ba-mini{font-size:11px;color:var(--ba-ink-soft);margin:8px 0 0;line-height:1.4}"
    ].join("");

    const toggle = document.createElement("button");
    toggle.className = "ba-toggle";
    toggle.type = "button";
    toggle.title = "Bilibili Accelerator";
    toggle.setAttribute("aria-label", "Bilibili Accelerator");
    toggle.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M13 2 4 14h7l-1 8 10-13h-7l1-7Z\"/></svg>";
    toggle.addEventListener("mouseenter", function () { if (immersive) { revealBadge(); } });
    toggle.addEventListener("animationend", function (event) {
      if (event.animationName === "ba-burst") {
        toggle.classList.remove("ba-zap");
      }
    });

    const panel = document.createElement("section");
    panel.className = "ba-panel";
    panel.id = PANEL_ID;

    // Header: ⚡ mark + theme toggle (left), language toggle (right). The product
    // name is dropped — the mark carries identity and frees room for the toggle.
    const head = document.createElement("div");
    head.className = "ba-head";
    head.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M13 2 4 14h7l-1 8 10-13h-7l1-7Z\"/></svg>";

    // Theme toggle (sun | moon). Tapping a side picks it explicitly; the thumb
    // sits on the resolved side until then. Default stays "system".
    const themeSeg = createSegToggle("ba-theme-seg", [
      { html: SUN_SVG, value: "light", label: t("themeLight") },
      { html: MOON_SVG, value: "dark", label: t("themeDark") }
    ], resolveTheme() === "dark" ? 1 : 0, function (value) {
      saveConfig(Object.assign({}, config, { theme: value }));
      applyTheme();
    });
    head.appendChild(themeSeg);

    // Language toggle (EN | 中), pushed to the right edge of the header.
    const langSeg = createSegToggle("ba-lang-seg", [
      { html: "EN", value: "en" },
      { html: "中", value: "zh" }
    ], lang() === "zh" ? 1 : 0, function (value) {
      if (config.lang === value) {
        return;
      }
      saveConfig(Object.assign({}, config, { lang: value }));
      applyLang();
    });
    langSeg.classList.add("ba-seg-end");
    head.appendChild(langSeg);

    // Hero status
    const hero = document.createElement("div");
    hero.className = "ba-hero";
    const dot = document.createElement("div");
    dot.id = "ba-dot";
    dot.className = "ba-dot";
    for (let i = 0; i < 2; i += 1) {
      const ring = document.createElement("span");
      ring.className = "ba-ring";
      dot.appendChild(ring);
    }
    const word = document.createElement("div");
    word.id = "ba-word";
    word.className = "ba-word";
    const subnote = document.createElement("div");
    subnote.id = "ba-note";
    subnote.className = "ba-subnote";
    const count = document.createElement("div");
    count.id = "ba-count";
    count.className = "ba-count";
    hero.appendChild(dot);
    hero.appendChild(word);
    hero.appendChild(subnote);
    hero.appendChild(count);

    // Live speed card
    const speedCard = document.createElement("div");
    speedCard.id = "ba-speed";
    speedCard.className = "ba-speed empty";
    const speedTop = document.createElement("div");
    speedTop.className = "ba-speed-top";
    const speedLabel = document.createElement("span");
    speedLabel.className = "ba-speed-label";
    speedLabel.id = "ba-spd-label";
    speedLabel.textContent = t("spdTitle");
    const speedVal = document.createElement("span");
    speedVal.className = "ba-speed-val";
    const speedNow = document.createElement("b");
    speedNow.id = "ba-spd-now";
    speedNow.textContent = "0.0";
    const speedUnit = document.createElement("span");
    speedUnit.id = "ba-spd-unit";
    speedUnit.textContent = t("spdUnit");
    speedVal.appendChild(speedNow);
    speedVal.appendChild(speedUnit);
    speedTop.appendChild(speedLabel);
    speedTop.appendChild(speedVal);
    const speedCanvas = document.createElement("canvas");
    speedCanvas.id = "ba-spd-canvas";
    speedCanvas.className = "ba-spd-canvas";
    const speedFoot = document.createElement("div");
    speedFoot.className = "ba-spd-foot";
    speedFoot.id = "ba-spd-foot";
    const speedEmpty = document.createElement("div");
    speedEmpty.className = "ba-spd-empty";
    speedEmpty.dataset.i18n = "spdWaiting";
    speedEmpty.textContent = t("spdWaiting");
    speedCard.appendChild(speedTop);
    speedCard.appendChild(speedCanvas);
    speedCard.appendChild(speedFoot);
    speedCard.appendChild(speedEmpty);

    // Master switch
    const master = createSwitchRow("masterTitle", "masterNote",
      config.enabled, function (checked) {
        saveConfig(Object.assign({}, config, { enabled: checked }));
        if (!checked) {
          state.status = "off";
        } else if (state.status === "off") {
          state.status = "idle";
        }
        renderStatus();
      });
    master.querySelector("input").id = "ba-master";

    // Contextual action: one race now, for the fragment the player is on. It
    // follows the same rule as an automatic race and never saves anything.
    const retestButton = document.createElement("button");
    retestButton.id = "ba-retest";
    retestButton.className = "ba-retest";
    retestButton.type = "button";
    retestButton.dataset.i18n = "retest";
    retestButton.textContent = t("retest");
    retestButton.addEventListener("click", function () { retest(); });

    // Advanced toggle (pinned at panel bottom) + section. Keeping the toggle as
    // the bottom-most element means expanding grows the panel upward while the
    // toggle stays under the cursor — click to expand, click again to collapse.
    const adv = document.createElement("div");
    adv.className = "ba-adv";
    const advToggle = document.createElement("button");
    advToggle.className = "ba-adv-toggle";
    advToggle.id = "ba-adv-toggle";
    advToggle.type = "button";
    advToggle.innerHTML = "<span id=\"ba-adv-label\"></span><span id=\"ba-adv-arrow\">▾</span>";
    advToggle.addEventListener("click", function () {
      const open = adv.classList.toggle("open");
      setAdvToggleLabel(open);
    });

    const selection = createSelect([
      { value: "auto", key: "selAuto" },
      { value: "fixed", key: "selFixed" }
    ], config.selection, function (value) {
      saveConfig(Object.assign({}, config, { selection: value }));
      syncHostControls();
      renderStatus();
    });

    // What the fixed server is used for. In auto mode the routing engine picks
    // healthy hosts from measurements, so neither this nor the Akamai rewrite
    // applies there and both rows are hidden.
    const mode = createSelect([
      { value: "bad-only", key: "modeBad" },
      { value: "force", key: "modeForce" }
    ], config.mode, function (value) {
      saveConfig(Object.assign({}, config, { mode: value }));
      renderStatus();
    });
    const modeField = createField("fWhen", mode);
    const akamaiRow = createSwitchRow("akamaiTitle", "akamaiNote",
      config.rewriteAkamai, function (checked) {
        saveConfig(Object.assign({}, config, { rewriteAkamai: checked }));
      });

    const hostInput = document.createElement("input");
    hostInput.type = "text";
    hostInput.id = "ba-custom-host";
    hostInput.className = "ba-control";
    hostInput.dataset.i18nPlaceholder = "hostPlaceholder";
    hostInput.placeholder = t("hostPlaceholder");
    const customHostField = createField("fCustomHost", hostInput);
    const hostSelect = document.createElement("select");
    hostSelect.id = "ba-fixed-host";
    hostSelect.className = "ba-control";
    core.CANDIDATE_POOL.forEach(function (h) {
      const option = document.createElement("option");
      option.value = h;
      option.textContent = h;
      hostSelect.appendChild(option);
    });
    // This sentinel belongs only to the UI; never persist it as a host.
    hostSelect.appendChild(makeOption("custom", "hostCustom", ""));
    const fixedHostField = createField("fFixed", hostSelect);

    // Show the host in use. Only fixed mode displays these rows, and in fixed
    // mode nothing but these two controls changes pcdnHost.
    function syncHostControls() {
      const fixed = config.selection === "fixed";
      const listed = core.CANDIDATE_POOL.indexOf(config.pcdnHost) !== -1;
      hostSelect.value = listed ? config.pcdnHost : "custom";
      hostInput.value = config.pcdnHost;
      fixedHostField.hidden = !fixed;
      customHostField.hidden = !fixed || listed;
      modeField.hidden = !fixed;
      akamaiRow.hidden = !fixed;
    }
    syncHostControls();

    hostInput.addEventListener("change", function () {
      const value = hostInput.value.trim();
      if (value) {
        saveConfig(Object.assign({}, config, { pcdnHost: value }));
      }
      // An empty address is never saved: this puts the host in use back.
      syncHostControls();
    });
    hostSelect.addEventListener("change", function () {
      if (hostSelect.value === "custom") {
        customHostField.hidden = false;
        hostInput.focus();
        hostInput.select();
        return;
      }
      saveConfig(Object.assign({}, config, { pcdnHost: hostSelect.value }));
      syncHostControls();
    });

    const mcdn = createSelect([
      { value: "proxy-all", key: "mcdnAll" },
      { value: "proxy-v1", key: "mcdnV1" },
      { value: "replace", key: "mcdnReplace" }
    ], config.mcdnStrategy, function (value) {
      saveConfig(Object.assign({}, config, { mcdnStrategy: value }));
    });

    const portRow = createSwitchRow("portTitle", "portNote",
      config.portHeuristic, function (checked) {
        saveConfig(Object.assign({}, config, { portHeuristic: checked }));
      });

    const stallRow = createSwitchRow("stallTitle", "stallNote",
      config.stallRecovery, function (checked) {
        saveConfig(Object.assign({}, config, { stallRecovery: checked }));
      });

    const p2pRow = createSwitchRow("p2pTitle", "p2pNote",
      config.p2pGuard, function (checked) {
        saveConfig(Object.assign({}, config, { p2pGuard: checked }));
      });

    const diag = document.createElement("button");
    diag.type = "button";
    diag.dataset.i18n = "diag";
    diag.textContent = t("diag");
    diag.addEventListener("click", function () {
      const text = JSON.stringify(buildDiagnostics(), null, 2);
      try {
        root.navigator.clipboard.writeText(text);
        diag.textContent = t("diagCopied");
        setTimeout(function () { diag.textContent = t("diag"); }, 1500);
      } catch (_) {
        console.info("[BiliAccelerator] diagnostics", text);
        diag.textContent = t("diagConsole");
      }
    });

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "primary";
    reload.dataset.i18n = "reload";
    reload.textContent = t("reload");
    reload.addEventListener("click", function () { root.location.reload(); });

    const actions = document.createElement("div");
    actions.className = "ba-actions";
    actions.appendChild(diag);
    actions.appendChild(reload);

    adv.appendChild(createSwatchField("fAccent", createAccentPicker()));
    adv.appendChild(createField("fServer", selection));
    adv.appendChild(fixedHostField);
    adv.appendChild(customHostField);
    adv.appendChild(modeField);
    adv.appendChild(createField("fMcdn", mcdn));
    adv.appendChild(portRow);
    adv.appendChild(stallRow);
    adv.appendChild(akamaiRow);
    adv.appendChild(p2pRow);
    adv.appendChild(actions);

    // Scrollable body holds everything; the advanced toggle is pinned below it
    // as a footer so it never moves when the section expands.
    const body = document.createElement("div");
    body.className = "ba-body";
    body.appendChild(head);
    body.appendChild(hero);
    body.appendChild(speedCard);
    body.appendChild(master);
    body.appendChild(retestButton);
    body.appendChild(adv);

    panel.appendChild(body);
    panel.appendChild(advToggle);

    function closePanel() {
      if (!panel.classList.contains("open")) {
        return;
      }
      panel.classList.remove("open");
      if (immersive) {
        revealBadge();
      }
    }

    toggle.addEventListener("click", function () {
      panel.classList.toggle("open");
      renderStatus();
      if (panel.classList.contains("open")) {
        drawSpeed();
        updateSpeedReadouts();
      }
      if (!immersive) {
        return;
      }
      if (panel.classList.contains("open")) {
        if (revealTimer) {
          clearTimeout(revealTimer);
          revealTimer = null;
        }
        setBadgeHidden(false);
      } else {
        revealBadge();
      }
    });

    document.addEventListener("click", function (event) {
      if (!panel.classList.contains("open")) {
        return;
      }
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.indexOf(host) !== -1 || event.target === host) {
        return;
      }
      closePanel();
    });

    shadow.appendChild(style);
    shadow.appendChild(panel);
    shadow.appendChild(toggle);
    document.documentElement.appendChild(host);
    applyLang();
    applyTheme();
    watchSystemTheme();
  }

  // ---- external config bridge (extension popup → page) -------------------

  function installConfigBridge() {
    if (typeof root.addEventListener !== "function") {
      return;
    }
    root.addEventListener("message", function (event) {
      if (event.source !== root) {
        return;
      }
      const data = event.data;
      if (data && data.__biliAccel === "config" && data.config) {
        saveConfig(Object.assign({}, config, data.config));
        applyLang();
        applyTheme();
      }
    });
  }

  root.BiliAccelerator = {
    getConfig: function () { return Object.assign({}, config); },
    setConfig: function (next) { saveConfig(Object.assign({}, config, next || {})); renderStatus(); applyTheme(); return this.getConfig(); },
    getStats: function () { return JSON.parse(JSON.stringify(state)); },
    getDiagnostics: function () { return buildDiagnostics(); },
    rewriteUrl: function (url) { return core.rewriteUrl(url, rewriteConfig()); },
    retest: function () { return retest(); }
  };

  dropLegacyRankings();
  patchJsonParse();
  patchFetch();
  patchXHR();
  patchGlobalPlayInfo("__playinfo__");
  patchGlobalPlayInfo("__INITIAL_STATE__");
  patchGlobalPlayInfo("__NEPTUNE_IS_MY_WAIFU__"); // live room initial state
  installP2PGuard();
  installConfigBridge();

  function bootstrapUi() {
    installUi();
    installImmersiveWatch();
    installSpeedMeter();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapUi, { once: true });
  } else {
    bootstrapUi();
  }

  console.info("[BiliAccelerator] installed", root.BiliAccelerator.getConfig());
})(typeof globalThis !== "undefined" ? globalThis : window);


})();

;(function biliUnlock() {
'use strict'
const __BU_DEV__ = false
const __BU_VERSION__ = '0.2.0'

// ===== src/md5.js =====
// 精简版 MD5（RFC 1321），只用于 B站 TV 登录接口的签名。
const md5 = (() => {
    function add(x, y) {
        const l = (x & 0xffff) + (y & 0xffff)
        return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff)
    }
    const rol = (n, c) => (n << c) | (n >>> (32 - c))
    const cmn = (q, a, b, x, s, t) => add(rol(add(add(a, q), add(x, t)), s), b)
    const ff = (a, b, c, d, x, s, t) => cmn((b & c) | (~b & d), a, b, x, s, t)
    const gg = (a, b, c, d, x, s, t) => cmn((b & d) | (c & ~d), a, b, x, s, t)
    const hh = (a, b, c, d, x, s, t) => cmn(b ^ c ^ d, a, b, x, s, t)
    const ii = (a, b, c, d, x, s, t) => cmn(c ^ (b | ~d), a, b, x, s, t)

    function blocks(bytes) {
        const n = ((bytes.length + 8) >> 6) + 1
        const w = new Array(n * 16).fill(0)
        for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8)
        w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8)
        w[n * 16 - 2] = bytes.length * 8
        return w
    }

    return function md5(str) {
        const x = blocks(new TextEncoder().encode(str))
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878
        for (let i = 0; i < x.length; i += 16) {
            const oa = a, ob = b, oc = c, od = d
            a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586)
            c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330)
            a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426)
            c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983)
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417)
            c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162)
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101)
            c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329)
            a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632)
            c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302)
            a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083)
            c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848)
            a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690)
            c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501)
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784)
            c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734)
            a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463)
            c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556)
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353)
            c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640)
            a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222)
            c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189)
            a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835)
            c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651)
            a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415)
            c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055)
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606)
            c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799)
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744)
            c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649)
            a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379)
            c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551)
            a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od)
        }
        return [a, b, c, d].map(v => {
            let s = ''
            for (let j = 0; j < 4; j++) s += ((v >> (j * 8)) & 0xff).toString(16).padStart(2, '0')
            return s
        }).join('')
    }
})()


// ===== src/base.js =====
// ---- 基础：日志、存储、配置 ----
// __BU_DEV__ / __BU_VERSION__ 由构建脚本注入

const TAG = '[bili-unlock]'
const SECRET_RE = /(access_key|access_token|refresh_token|SESSDATA|bili_jct|csrf|sign)=[^&\s"']+/gi
const redact = s => String(s).replace(SECRET_RE, '$1=***')

const debugLines = []
let debugBox = null
function renderDebug() {
    // 诊断小窗默认关闭；需要时在控制台执行 localStorage.bu_debug_box = 'true' 再刷新
    if (!__BU_DEV__ || window.top !== window || store.get('debug_box', false) !== true) return
    if (!document.body) return void setTimeout(renderDebug, 200)
    if (!debugBox) {
        debugBox = document.createElement('pre')
        debugBox.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:46vw;max-height:40vh;overflow:hidden;margin:0;padding:6px 8px;background:rgba(0,0,0,.82);color:#7CFC9A;font:11px/1.35 Menlo,monospace;white-space:pre-wrap;word-break:break-all;border-radius:6px;pointer-events:none'
        document.body.appendChild(debugBox)
    }
    debugBox.textContent = `[bili-unlock ${__BU_VERSION__} dev]\n` + debugLines.slice(-20).join('\n')
}
function beacon(line) {
    if (!__BU_DEV__) return
    try { new Image().src = 'http://127.0.0.1:17865/beacon?' + encodeURIComponent(line.slice(0, 600)) } catch (_) { }
}
function log(...args) {
    const line = redact(args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch (_) { return String(a) } })()).join(' '))
    console.log(TAG, line)
    if (__BU_DEV__) { debugLines.push(line.slice(0, 300)); beacon(line); renderDebug() }
}

const store = {
    get(k, d) { try { const v = localStorage.getItem('bu_' + k); return v == null ? d : JSON.parse(v) } catch (_) { return d } },
    set(k, v) { try { localStorage.setItem('bu_' + k, JSON.stringify(v)) } catch (_) { } },
    del(k) { try { localStorage.removeItem('bu_' + k) } catch (_) { } },
}

const DEFAULT_SERVERS = ['https://bili.nepnep.moe']
const config = {
    get servers() {
        const s = store.get('servers', null)
        return Array.isArray(s) && s.length ? s : DEFAULT_SERVERS
    },
    set servers(v) { store.set('servers', v) },
    get quality() { return store.get('quality', 127) }, // 想要的最高画质 qn
    set quality(v) { store.set('quality', v) },
    get resume() { return store.get('resume', true) },
    set resume(v) { store.set('resume', v) },
    get autoplay() { return store.get('autoplay', true) },
    set autoplay(v) { store.set('autoplay', v) },
    get rate() { return store.get('rate', 1) },
    set rate(v) { store.set('rate', v) },
}

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : ''
}

async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts)
    const text = await res.text()
    try { return JSON.parse(text) } catch (_) { throw new Error(`非 JSON 响应 (${res.status}): ${text.slice(0, 120)}`) }
}

function signParams(params, appsec) {
    const q = Object.keys(params).sort().map(k => k + '=' + encodeURIComponent(params[k])).join('&')
    return q + '&sign=' + md5(q + appsec)
}


// ===== src/auth.js =====
// ---- 授权：用当前已登录的 B站 账号，走 TV 扫码登录接口自己确认，拿到 access_key ----
// 令牌只保存在本浏览器的 localStorage（bilibili.com 域），只在请求代理服务器时带上。

const TV_APPKEY = '27eb53fc9058f8c3'
const TV_APPSEC = 'c2ed53a74eeefe3cf99fbd01d8c9c375'
const PASSPORT = 'https://passport.bilibili.com/x/passport-tv-login'

const auth = {
    get token() {
        const t = store.get('auth', null)
        if (!t || !t.access_key) return null
        if (t.expires_at && Date.now() > t.expires_at) return null
        return t
    },
    get accessKey() { return this.token ? this.token.access_key : '' },
    clear() { store.del('auth'); store.del('authorized_once') },

    async login() {
        if (!getCookie('DedeUserID')) throw new Error('请先登录 B站')
        const ts = () => String(Math.floor(Date.now() / 1000))

        const r1 = await fetchJSON(`${PASSPORT}/qrcode/auth_code?` + signParams({ appkey: TV_APPKEY, local_id: '0', ts: ts() }, TV_APPSEC), { method: 'POST' })
        if (r1.code !== 0 || !r1.data || !r1.data.auth_code) throw new Error('获取授权码失败: ' + (r1.message || r1.code))
        const authCode = r1.data.auth_code
        log('auth: got auth_code')

        const confirmQuery = ['auth_code=' + encodeURIComponent(authCode), 'build=7082000', 'csrf=' + encodeURIComponent(getCookie('bili_jct'))].join('&')
        const r2 = await fetchJSON(`${PASSPORT}/h5/qrcode/confirm?` + confirmQuery, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        if (r2.code !== 0) throw new Error('确认授权失败: ' + (r2.message || r2.code))
        log('auth: confirmed')

        let r3
        for (let i = 0; i < 5; i++) {
            r3 = await fetchJSON(`${PASSPORT}/qrcode/poll?` + signParams({ appkey: TV_APPKEY, auth_code: authCode, local_id: '0', ts: ts() }, TV_APPSEC), { method: 'POST' })
            if (r3.code === 0 && r3.data) break
            await new Promise(r => setTimeout(r, 1000))
        }
        if (!r3 || r3.code !== 0 || !r3.data) throw new Error('获取令牌失败: ' + (r3 && (r3.message || r3.code)))
        const info = r3.data.token_info || r3.data
        const token = {
            access_key: info.access_token,
            refresh_token: info.refresh_token,
            expires_at: Date.now() + (info.expires_in || 0) * 1000,
            mid: info.mid,
        }
        if (!token.access_key) throw new Error('令牌为空')
        store.set('auth', token)
        store.set('authorized_once', true)
        log('auth: ok, expires', new Date(token.expires_at).toLocaleDateString())
        return token
    },
}


// ===== src/unlock.js =====
// ---- 识别被区域限制的番剧页，向代理要播放地址 ----

function readPlayInfo() {
    const pi = window.__PLAYURL_HYDRATE_DATA__ || window.__playinfo__
    const r = pi && (pi.result || pi.data)
    if (!r) return null
    const blocked = (r.plugins || []).some(p => p && p.name === 'AreaLimitPanel' && p.config && p.config.is_block)
        || r.play_video_type === 'none' && /AREA|LIMIT/i.test(JSON.stringify(r.play_check || ''))
    const ep = (r.play_view_business_info && r.play_view_business_info.episode_info) || {}
    const sup = (r.supplement && r.supplement.ogv_episode_info) || {}
    const arc = r.arc || {}
    return {
        blocked,
        playType: r.play_video_type,
        isDrm: !!(r.video_info && r.video_info.is_drm),
        epId: ep.ep_id || sup.episode_id,
        cid: ep.cid || arc.cid,
        aid: ep.aid || arc.aid,
        seasonId: r.supplement && r.supplement.ogv_season_info && r.supplement.ogv_season_info.season_id,
    }
}

// 从页面的番剧信息里推断地区，决定先用哪个 area 参数
function guessAreas() {
    let names = ''
    try {
        const qs = window.__NEXT_DATA__.props.pageProps.dehydratedState.queries
        for (const q of qs) {
            const d = q && q.state && q.state.data
            if (d && d.areas) { names = d.areas.map(a => a.name).join(','); break }
        }
    } catch (_) { }
    const title = document.title
    if (/台湾|臺灣/.test(names + title)) return ['tw', 'hk', 'cn']
    if (/香港|港澳/.test(names + title)) return ['hk', 'tw', 'cn']
    if (/东南亚|泰国/.test(names + title)) return ['th', 'cn', 'hk']
    return ['cn', 'hk', 'tw']
}

const AREA_NAME = { cn: '大陆', hk: '香港', tw: '台湾', th: '东南亚' }

// 代理/B站 常见错误码 → 人话
function explainCode(code, message) {
    const m = {
        '-101': '未授权或授权已过期',
        '401': '未授权或授权已过期',
        '-10403': '该地区的服务器也看不了',
        '-404': '服务器不支持这个接口，或地址填错了',
        '-403': '没有权限（会员内容需要大会员，付费内容需要已购买）',
        '-412': '请求被拦截，稍后再试',
        '6002003': '该内容需要大会员',
        '-3': '服务器校验失败',
    }[String(code)]
    return m ? `${m}（${code}${message ? ' ' + message : ''}）` : `${code} ${message || ''}`.trim()
}

function playurlUrl(server, info, area) {
    const q = new URLSearchParams({
        avid: info.aid || '', cid: info.cid || '', ep_id: info.epId,
        qn: 127, fnver: 0, fnval: 4048, fourk: 1, area,
    })
    if (auth.accessKey) q.set('access_key', auth.accessKey)
    return `${server.replace(/\/+$/, '')}/pgc/player/web/playurl?${q}`
}

async function requestPlayurl(info) {
    const errors = []
    let needAuth = !auth.accessKey
    for (const server of config.servers) {
        for (const area of guessAreas()) {
            try {
                const j = await fetchJSON(playurlUrl(server, info, area), { credentials: 'omit' })
                const result = j.result || j.data
                log('playurl', server, area, 'code=' + j.code, j.message || '', result && result.dash ? 'dash' : (result && result.durl ? 'durl' : ''))
                if (j.code === 0 && result && (result.dash || result.durl)) return { result, server, area }
                errors.push(`${server} · ${AREA_NAME[area] || area}：${explainCode(j.code, j.message)}`)
                if (j.code === -101 || j.code === 401) { needAuth = true; break } // 未授权，换地区也没用
                if (j.code === -404 || j.code === -3) break                       // 这台服务器不行，换下一台
            } catch (e) {
                log('playurl error', server, area, e.message)
                errors.push(`${server}：连不上（${e.message}）`)
                break
            }
        }
    }
    const err = new Error(errors.join('\n') || '没有可用的代理服务器')
    err.needAuth = needAuth
    throw err
}

// 设置面板里的“测试”：只测当前视频在这台服务器上能不能拿到地址
async function probeServer(server, info) {
    const t0 = performance.now()
    for (const area of guessAreas()) {
        try {
            const j = await fetchJSON(playurlUrl(server, info, area), { credentials: 'omit' })
            const ms = Math.round(performance.now() - t0)
            const r = j.result || j.data
            if (j.code === 0 && r && (r.dash || r.durl)) return { ok: true, text: `可用 · ${AREA_NAME[area]} · ${ms}ms` }
            if (j.code === -101 || j.code === 401 || j.code === -404) return { ok: false, text: explainCode(j.code).split('（')[0], title: explainCode(j.code, j.message) }
        } catch (e) {
            return { ok: false, text: '连不上', title: e.message }
        }
    }
    return { ok: false, text: '各地区都不行' }
}


// ===== src/player.js =====
// ---- 把代理返回的 DASH 数据变成 MPD，用 dash.js 播放 ----

// 纯播放器版本：不带 DRM/EME 模块（用不上，而且 Safari 上 EME 检测会出错）
const DASHJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.mediaplayer.min.js'
const QN_NAME = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P' }

// B站 页面自带一个精简版 window.dashjs（没有 Debug 等）。dash.js 内部组件会通过
// window.dashjs 互相查找，两套混用会出错。被限制的页面上 B站 自己的播放器不工作，
// 所以这里直接让 window.dashjs 指向我们的完整版，不再还原。
let ownDashjs = null
function loadDashJs() {
    if (ownDashjs) return Promise.resolve(ownDashjs)
    return new Promise((resolve, reject) => {
        const pageDashjs = window.dashjs
        try { delete window.dashjs } catch (_) { }
        if (window.dashjs) window.dashjs = undefined
        const s = document.createElement('script')
        s.src = DASHJS_URL
        s.onload = () => {
            const d = window.dashjs
            if (d && d.MediaPlayer && d.Debug && d !== pageDashjs) { ownDashjs = d; resolve(d) }
            else reject(new Error('dash.js 加载后不完整'))
        }
        s.onerror = () => { if (pageDashjs) window.dashjs = pageDashjs; reject(new Error('dash.js 加载失败（cdnjs 不可用？）')) }
        document.head.appendChild(s)
    })
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k] }

function segBase(item) {
    const sb = pick(item, 'segment_base', 'SegmentBase', 'segmentBase') || {}
    return {
        init: pick(sb, 'initialization', 'Initialization'),
        index: pick(sb, 'index_range', 'indexRange'),
    }
}

// 主地址 + 备用地址；加速脚本在的话先让它换成更快的线路
function mediaUrls(item) {
    const urls = [pick(item, 'baseUrl', 'base_url')].concat(pick(item, 'backupUrl', 'backup_url') || []).filter(Boolean)
    const out = []
    for (const u of urls) {
        let v = u
        try { if (window.BiliAccelerator && window.BiliAccelerator.rewriteUrl) v = window.BiliAccelerator.rewriteUrl(u) || u } catch (_) { }
        if (!out.includes(v)) out.push(v)
        if (!out.includes(u)) out.push(u)
    }
    return out.slice(0, 4)
}

// Safari 对 HEVC/AV1 的 MSE 支持不稳定，优先 AVC；同一画质只留一条
function chooseVideoTracks(videos) {
    const canPlay = v => !window.MediaSource || MediaSource.isTypeSupported(`${pick(v, 'mimeType', 'mime_type') || 'video/mp4'}; codecs="${v.codecs}"`)
    const supported = videos.filter(canPlay)
    const pool = supported.length ? supported : videos
    const rank = v => /^avc/.test(v.codecs) ? 0 : /^(hev|hvc)/.test(v.codecs) ? 1 : 2
    const byQn = new Map()
    for (const v of pool) {
        const cur = byQn.get(v.id)
        if (!cur || rank(v) < rank(cur)) byQn.set(v.id, v)
    }
    return [...byQn.values()].sort((a, b) => a.bandwidth - b.bandwidth)
}

function buildMpd(dash, videos = chooseVideoTracks(dash.video || [])) {
    const duration = dash.duration || dash.timelength / 1000 || 0
    const rep = (item, kind) => {
        const { init, index } = segBase(item)
        const attrs = kind === 'video'
            ? `width="${item.width}" height="${item.height}" frameRate="${pick(item, 'frameRate', 'frame_rate') || ''}"`
            : `audioSamplingRate="44100"`
        return `<Representation id="${kind}-${item.id}-${item.codecid || ''}" bandwidth="${item.bandwidth}" codecs="${xmlEsc(item.codecs)}" mimeType="${pick(item, 'mimeType', 'mime_type')}" ${attrs}>` +
            mediaUrls(item).map(u => `<BaseURL>${xmlEsc(u)}</BaseURL>`).join('') +
            `<SegmentBase indexRange="${index}"><Initialization range="${init}"/></SegmentBase></Representation>`
    }
    const audios = [].concat(dash.audio || [], (dash.flac && dash.flac.audio) ? [dash.flac.audio] : [])
        .filter(a => a && /mp4a/.test(a.codecs))
    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S" mediaPresentationDuration="PT${duration}S">` +
        `<Period start="PT0S">` +
        `<AdaptationSet contentType="video" segmentAlignment="true" subsegmentAlignment="true">${videos.map(v => rep(v, 'video')).join('')}</AdaptationSet>` +
        (audios.length ? `<AdaptationSet contentType="audio" segmentAlignment="true" subsegmentAlignment="true">${audios.map(a => rep(a, 'audio')).join('')}</AdaptationSet>` : '') +
        `</Period></MPD>`
}

// 返回 { player, tracks }，tracks 与 dash.js 的画质下标一一对应（都按码率升序）
async function playDash(video, dash, preferQn) {
    const dashjs = await loadDashJs()
    const tracks = chooseVideoTracks(dash.video || [])
    const mpd = buildMpd(dash, tracks)
    const url = URL.createObjectURL(new Blob([mpd], { type: 'application/dash+xml' }))
    let start = tracks.length - 1
    for (let i = tracks.length - 1; i >= 0; i--) { if (tracks[i].id <= preferQn) { start = i; break } }
    const player = dashjs.MediaPlayer().create()
    player.updateSettings({
        streaming: {
            abr: { autoSwitchBitrate: { video: false, audio: true }, initialBitrate: { video: (tracks[start] ? tracks[start].bandwidth / 1000 : 1e9) } },
            buffer: { fastSwitchEnabled: true, bufferTimeAtTopQuality: 30, stableBufferTime: 20 },
            retryAttempts: { MediaSegment: 4, InitializationSegment: 4, IndexSegment: 4 },
        },
        debug: { logLevel: dashjs.Debug.LOG_LEVEL_WARNING },
    })
    player.on(dashjs.MediaPlayer.events.ERROR, e => log('dash error', e && e.error && (e.error.message || e.error.code)))
    player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => { try { player.setQualityFor('video', start, true) } catch (_) { } })
    player.initialize(video, url, false)
    return { player, tracks, start }
}

// 有些代理只给 durl（mp4 单文件）
function playDurl(video, result) {
    const seg = result.durl && result.durl[0]
    if (!seg) throw new Error('没有可播放的地址')
    video.src = seg.url
    return { player: null, tracks: [], start: 0 }
}


// ===== src/ui.js =====
// ---- 界面：盖在播放器上的面板、操作栏、设置 ----

const ICON = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
}

const CSS = `
#big-block-panel{display:none!important}
.bu-layer{--bu-accent:#00aeec;--bu-accent2:#fb7299;position:absolute;inset:0;z-index:1000;background:#0b0d10;color:#e9edf1;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none}
.bu-layer *{box-sizing:border-box}
.bu-layer.bu-webfs{position:fixed;z-index:2147483000}
.bu-layer video{position:absolute;inset:0;width:100%;height:100%;background:#000;outline:none}
.bu-layer svg{width:16px;height:16px;display:block;flex:none}
.bu-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(120% 90% at 50% 0%,#1a2230 0%,#0b0d10 60%)}
.bu-card{width:min(440px,100%);text-align:center}
.bu-card .bu-ico{width:52px;height:52px;margin:0 auto 14px;border-radius:16px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--bu-accent),#5b8cff);box-shadow:0 10px 30px rgba(0,174,236,.35)}
.bu-card .bu-ico svg{width:26px;height:26px}
.bu-card h3{margin:0 0 8px;font-size:18px;font-weight:650;color:#fff;letter-spacing:.2px}
.bu-card p{margin:0 0 18px;color:#9aa6b2;font-size:13px;white-space:pre-wrap}
.bu-card pre{margin:0 0 16px;max-height:110px;overflow:auto;text-align:left;font:11px/1.45 ui-monospace,Menlo,monospace;color:#ffb4b4;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.18);border-radius:8px;padding:8px 10px;white-space:pre-wrap;user-select:text;-webkit-user-select:text}
.bu-card .bu-foot{margin-top:18px;font-size:11px;color:#5d6873}
.bu-card .bu-foot a{color:#7c8b99;text-decoration:none}
.bu-spin{width:30px;height:30px;margin:0 auto 16px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:var(--bu-accent);animation:bu-rot .8s linear infinite}
@keyframes bu-rot{to{transform:rotate(360deg)}}
.bu-btn{display:inline-flex;align-items:center;gap:6px;margin:4px;padding:8px 18px;border:0;border-radius:9px;background:var(--bu-accent);color:#fff;font:600 13px/1 inherit;cursor:pointer;transition:filter .15s,transform .1s}
.bu-btn:hover{filter:brightness(1.1)}.bu-btn:active{transform:scale(.97)}
.bu-btn.ghost{background:rgba(255,255,255,.07);color:#cfd6dd;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.bu-btn.danger{background:rgba(255,90,90,.12);color:#ff9b9b;box-shadow:inset 0 0 0 1px rgba(255,90,90,.25)}
.bu-btn.sm{padding:6px 11px;font-size:12px;border-radius:7px;margin:0}
.bu-top{position:absolute;left:0;right:0;top:0;z-index:3;display:flex;align-items:center;gap:8px;padding:10px 12px 26px;background:linear-gradient(rgba(0,0,0,.7),rgba(0,0,0,0));transition:opacity .25s}
.bu-layer.bu-idle .bu-top{opacity:0;pointer-events:none}
.bu-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:rgba(0,174,236,.18);color:#bfefff;font-size:12px;font-weight:600;box-shadow:inset 0 0 0 1px rgba(0,174,236,.35)}
.bu-sub{font-size:12px;color:#aab4be;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bu-grow{flex:1;min-width:0}
.bu-chip{position:relative;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;font:600 12px/1 inherit;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.bu-chip:hover{background:rgba(255,255,255,.18)}
.bu-chip.icon{width:30px;padding:0;justify-content:center}
.bu-chip.on{color:#ffe08a}
.bu-menu{position:absolute;top:36px;right:0;min-width:132px;padding:6px;border-radius:10px;background:rgba(22,26,32,.96);box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.08);display:none;z-index:5}
.bu-menu.open{display:block}
.bu-menu button{display:flex;width:100%;justify-content:space-between;gap:12px;padding:7px 10px;border:0;border-radius:7px;background:none;color:#dfe5ea;font:13px/1.2 inherit;cursor:pointer;text-align:left}
.bu-menu button:hover{background:rgba(255,255,255,.08)}
.bu-menu button.cur{color:var(--bu-accent);font-weight:650}
.bu-menu small{color:#7d8893;font-size:11px}
.bu-toast{position:absolute;left:50%;top:18%;z-index:4;transform:translate(-50%,-6px);padding:8px 14px;border-radius:10px;background:rgba(0,0,0,.72);color:#fff;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.bu-toast.show{opacity:1;transform:translate(-50%,0)}
.bu-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,7,10,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.bu-sheet{width:min(560px,100%);max-height:100%;overflow:auto;border-radius:16px;background:#151a20;box-shadow:0 24px 80px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.07);user-select:text;-webkit-user-select:text}
.bu-sheet header{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:14px 16px;background:#151a20;border-bottom:1px solid rgba(255,255,255,.06);z-index:1}
.bu-sheet header h4{margin:0;flex:1;font-size:15px;color:#fff}
.bu-sec{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.bu-sec:last-child{border-bottom:0}
.bu-sec h5{margin:0 0 10px;font-size:12px;font-weight:650;letter-spacing:.6px;color:#7d8893;text-transform:uppercase}
.bu-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.bu-row .bu-grow{font-size:13px;color:#dfe5ea}
.bu-row .bu-hint{display:block;font-size:11.5px;color:#7d8893}
.bu-srv{display:flex;align-items:center;gap:6px;padding:7px 8px;margin:4px 0;border-radius:9px;background:rgba(255,255,255,.04)}
.bu-srv code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px ui-monospace,Menlo,monospace;color:#dfe5ea}
.bu-pill{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.08);color:#9aa6b2;white-space:nowrap}
.bu-pill.ok{background:rgba(46,204,113,.15);color:#7ee2a8}.bu-pill.bad{background:rgba(255,90,90,.14);color:#ff9b9b}
.bu-iconbtn{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:7px;background:none;color:#9aa6b2;cursor:pointer}
.bu-iconbtn:hover{background:rgba(255,255,255,.08);color:#fff}
.bu-input,.bu-select{height:32px;padding:0 10px;border:0;border-radius:8px;background:rgba(255,255,255,.07);color:#fff;font:13px inherit;outline:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.bu-input{flex:1;min-width:0}.bu-input:focus,.bu-select:focus{box-shadow:inset 0 0 0 1px var(--bu-accent)}
.bu-switch{position:relative;width:38px;height:22px;flex:none;border-radius:999px;background:rgba(255,255,255,.16);cursor:pointer;transition:background .2s;border:0}
.bu-switch:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.bu-switch.on{background:var(--bu-accent)}.bu-switch.on:after{transform:translateX(16px)}
.bu-kbd{display:inline-block;min-width:20px;padding:1px 5px;margin:0 2px;border-radius:4px;background:rgba(255,255,255,.1);font:11px ui-monospace,Menlo,monospace;text-align:center;color:#cfd6dd}
`

function ensureStyle() {
    if (document.getElementById('bu-style')) return
    const st = document.createElement('style')
    st.id = 'bu-style'
    st.textContent = CSS
    ;(document.head || document.documentElement).appendChild(st)
}

function findPlayerBox() {
    // 2026 版番剧页：#bilibili-player-wrap > … > #bilibili-player > #big-block-panel(z=100, 阻断提示)
    for (const sel of ['#bilibili-player-wrap', '#bilibili-player']) {
        const e = document.querySelector(sel)
        if (e && e.offsetWidth > 300) return e
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
        if (/无法观看|無法觀看/.test(n.nodeValue)) {
            let e = n.parentElement
            while (e && e !== document.body && !(e.offsetWidth >= 480 && e.offsetHeight >= 260)) e = e.parentElement
            if (e && e !== document.body) return e
        }
    }
    return null
}

function createLayer() {
    ensureStyle()
    const box = findPlayerBox()
    if (!box) return null
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative'
    let layer = box.querySelector(':scope > .bu-layer')
    if (!layer) {
        layer = document.createElement('div')
        layer.className = 'bu-layer'
        layer.tabIndex = -1
        box.appendChild(layer)
    }
    return layer
}

// 小型 DOM 构造器
function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue
        if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn)
        else if (k === 'text') e.textContent = v
        else if (k === 'html') e.innerHTML = v // 只用于内置的 SVG 图标
        else if (k === 'class') e.className = v
        else e.setAttribute(k, v === true ? '' : v)
    }
    for (const c of [].concat(children)) if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    return e
}
const iconEl = (name, cls = '') => el('span', { class: cls, html: ICON[name] })

const FOOT = () => el('div', { class: 'bu-foot' }, [
    `bili-unlock ${__BU_VERSION__} · `,
    el('a', { href: 'https://github.com/LucasYanzy/bili-unlock', target: '_blank', rel: 'noopener', text: 'GitHub' }),
])

// 播放前的各种状态卡片
function showCard(layer, { title, text, error, buttons = [], icon = 'lock', loading = false }) {
    log('card:', title)
    layer.replaceChildren(el('div', { class: 'bu-center' }, el('div', { class: 'bu-card' }, [
        loading ? el('div', { class: 'bu-spin' }) : el('div', { class: 'bu-ico', html: ICON[icon] }),
        el('h3', { text: title }),
        text ? el('p', { text }) : null,
        error ? el('pre', { text: error }) : null,
        buttons.length ? el('div', {}, buttons.map(b => el('button', { class: 'bu-btn' + (b.kind ? ' ' + b.kind : ''), text: b.label, on: { click: b.onClick } }))) : null,
        FOOT(),
    ])))
}

function toast(layer, msg, ms = 1400) {
    let t = layer.querySelector('.bu-toast')
    if (!t) { t = el('div', { class: 'bu-toast' }); layer.appendChild(t) }
    t.textContent = msg
    t.classList.add('show')
    clearTimeout(t._h)
    t._h = setTimeout(() => t.classList.remove('show'), ms)
}

// 下拉菜单：chip 按钮 + 选项列表
function dropdown(label, items, onPick, title) {
    const menu = el('div', { class: 'bu-menu' })
    const chip = el('button', { class: 'bu-chip', title, text: label })
    const wrap = el('div', { style: 'position:relative' }, [chip, menu])
    const render = (cur) => {
        menu.replaceChildren(...items().map(it => el('button', {
            class: it.value === cur ? 'cur' : '',
            on: { click: (e) => { e.stopPropagation(); menu.classList.remove('open'); onPick(it.value) } },
        }, [it.label, it.hint ? el('small', { text: it.hint }) : null])))
    }
    chip.addEventListener('click', (e) => {
        e.stopPropagation()
        const open = !menu.classList.contains('open')
        wrap.closest('.bu-layer').querySelectorAll('.bu-menu.open').forEach(m => m.classList.remove('open'))
        if (open) { render(wrap._cur); menu.classList.add('open') }
    })
    return { wrap, set(text, cur) { chip.textContent = text; wrap._cur = cur } }
}

function switchEl(on, onChange) {
    const s = el('button', { class: 'bu-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) })
    s.addEventListener('click', () => { const v = !s.classList.contains('on'); s.classList.toggle('on', v); s.setAttribute('aria-checked', String(v)); onChange(v) })
    return s
}

// 打开内置加速脚本的面板（它的按钮在 shadow DOM 里）
function openAcceleratorPanel() {
    const host = document.getElementById('bili-accelerator-button')
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector('.ba-toggle')
    if (btn) { btn.click(); return true }
    return false
}
function acceleratorMode() {
    try { return window.BiliAccelerator ? window.BiliAccelerator.getConfig().mode : null } catch (_) { return null }
}
const ACCEL_MODE_NAME = { 'bad-only': '卡顿时加速', force: '始终加速', off: '已关闭' }


// ===== src/settings.js =====
// ---- 设置面板 ----

const QUALITY_PREFS = [
    { value: 127, label: '最高可用' },
    { value: 120, label: '4K' },
    { value: 112, label: '1080P 高码率' },
    { value: 80, label: '1080P' },
    { value: 64, label: '720P' },
    { value: 32, label: '480P（省流量）' },
]

function openSettings(layer, { onChange } = {}) {
    layer.querySelector('.bu-modal')?.remove()
    const changed = { servers: false, auth: false }
    const close = () => {
        modal.remove()
        layer.focus()
        if (onChange && (changed.servers || changed.auth)) onChange(changed)
    }
    const modal = el('div', { class: 'bu-modal', on: { click: (e) => { if (e.target === modal) close() } } })
    const sheet = el('div', { class: 'bu-sheet', role: 'dialog', 'aria-label': 'bili-unlock 设置' })
    modal.appendChild(sheet)

    sheet.appendChild(el('header', {}, [
        iconEl('gear'),
        el('h4', { text: 'bili-unlock 设置' }),
        el('button', { class: 'bu-iconbtn', title: '关闭 (Esc)', html: ICON.close, on: { click: close } }),
    ]))

    // 授权
    const authSec = el('div', { class: 'bu-sec' })
    const renderAuth = () => {
        const t = auth.token
        authSec.replaceChildren(
            el('h5', { text: '账号授权' }),
            el('div', { class: 'bu-row' }, [
                el('div', { class: 'bu-grow' }, [
                    t ? `已授权 · 有效期至 ${new Date(t.expires_at).toLocaleDateString()}` : '未授权',
                    el('span', { class: 'bu-hint', text: '令牌只保存在本浏览器，只发给你设置的代理服务器。' }),
                ]),
                el('button', {
                    class: 'bu-btn sm', text: t ? '重新授权' : '授权', on: {
                        click: async (e) => {
                            e.target.disabled = true; e.target.textContent = '授权中…'
                            try { await auth.login(); changed.auth = true } catch (err) { alert('授权失败：' + redact(err.message)) }
                            renderAuth()
                        }
                    }
                }),
                t ? el('button', { class: 'bu-btn sm danger', text: '退出', on: { click: () => { auth.clear(); changed.auth = true; renderAuth() } } }) : null,
            ]),
        )
    }
    renderAuth()
    sheet.appendChild(authSec)

    // 代理服务器
    const srvSec = el('div', { class: 'bu-sec' })
    const status = {}
    const renderServers = () => {
        const list = config.servers
        const input = el('input', { class: 'bu-input', placeholder: 'https://example.com', spellcheck: 'false' })
        const add = () => {
            const v = input.value.trim().replace(/\/+$/, '')
            if (!/^https?:\/\/[^/\s]+$/.test(v)) { input.focus(); input.style.boxShadow = 'inset 0 0 0 1px #ff6b6b'; return }
            if (!list.includes(v)) { config.servers = list.concat(v); changed.servers = true }
            renderServers()
        }
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); e.stopPropagation() })
        const move = (i, d) => { const l = list.slice(); const [x] = l.splice(i, 1); l.splice(i + d, 0, x); config.servers = l; changed.servers = true; renderServers() }
        srvSec.replaceChildren(
            el('h5', { text: '代理服务器（按顺序尝试）' }),
            ...list.map((s, i) => el('div', { class: 'bu-srv' }, [
                el('code', { text: s, title: s }),
                status[s] ? el('span', { class: 'bu-pill ' + (status[s].ok ? 'ok' : 'bad'), text: status[s].text, title: status[s].title || '' }) : null,
                el('button', { class: 'bu-iconbtn', title: '上移', html: ICON.up, disabled: i === 0, on: { click: () => move(i, -1) } }),
                el('button', { class: 'bu-iconbtn', title: '下移', html: ICON.down, disabled: i === list.length - 1, on: { click: () => move(i, 1) } }),
                el('button', {
                    class: 'bu-iconbtn', title: '删除', html: ICON.close, on: {
                        click: () => { config.servers = list.filter(x => x !== s); changed.servers = true; renderServers() }
                    }
                }),
            ])),
            el('div', { class: 'bu-row' }, [input, el('button', { class: 'bu-btn sm', text: '添加', on: { click: add } })]),
            el('div', { class: 'bu-row' }, [
                el('button', {
                    class: 'bu-btn sm ghost', text: '测试当前视频', on: {
                        click: async (e) => {
                            const info = readPlayInfo()
                            if (!info || !info.epId) { alert('请在番剧/影视播放页使用'); return }
                            e.target.disabled = true; e.target.textContent = '测试中…'
                            for (const s of config.servers) { status[s] = { text: '…' }; renderServers() ; status[s] = await probeServer(s, info) }
                            renderServers()
                        }
                    }
                }),
                el('button', { class: 'bu-btn sm ghost', text: '恢复默认', on: { click: () => { config.servers = DEFAULT_SERVERS; changed.servers = true; renderServers() } } }),
            ]),
            el('span', { class: 'bu-hint', html: '兼容 <a href="https://github.com/yujincheng08/BiliRoaming/wiki/%E5%85%AC%E5%85%B1%E8%A7%A3%E6%9E%90%E6%9C%8D%E5%8A%A1%E5%99%A8" target="_blank" rel="noopener" style="color:#7cc8ff">哔哩漫游公共解析服务器</a>。代理能看到你的授权令牌，只用信任的服务器。' }),
        )
    }
    renderServers()
    sheet.appendChild(srvSec)

    // 播放
    const qSel = el('select', { class: 'bu-select' }, QUALITY_PREFS.map(q => el('option', { value: String(q.value), text: q.label })))
    qSel.value = String(config.quality)
    qSel.addEventListener('change', () => { config.quality = Number(qSel.value) })
    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('h5', { text: '播放' }),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow', text: '默认画质' }), qSel]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['记住播放进度', el('span', { class: 'bu-hint', text: '下次打开同一集从上次的位置继续' })]), switchEl(config.resume, v => { config.resume = v })]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['自动播放', el('span', { class: 'bu-hint', text: '解锁成功后立即开始播放' })]), switchEl(config.autoplay, v => { config.autoplay = v })]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['快捷键', el('span', { class: 'bu-hint', html: '<span class="bu-kbd">空格</span>播放/暂停 <span class="bu-kbd">←</span><span class="bu-kbd">→</span>快退/快进 5 秒 <span class="bu-kbd">↑</span><span class="bu-kbd">↓</span>音量 <span class="bu-kbd">F</span>全屏 <span class="bu-kbd">M</span>静音 <span class="bu-kbd">[</span><span class="bu-kbd">]</span>倍速' })])]),
    ]))

    // 加速
    const mode = acceleratorMode()
    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('h5', { text: '播放加速' }),
        el('div', { class: 'bu-row' }, [
            el('div', { class: 'bu-grow' }, [
                mode ? `内置加速：${ACCEL_MODE_NAME[mode] || mode}` : '内置加速未运行',
                el('span', { class: 'bu-hint', text: '自动为卡顿的视频换更快的 CDN 线路，解锁后的视频同样有效。基于 realzza/bilibili-accelerator。' }),
            ]),
            el('button', { class: 'bu-btn sm ghost', text: '打开加速面板', on: { click: () => { close(); if (!openAcceleratorPanel()) alert('没找到加速面板（页面右下角的 ⚡）') } } }),
        ]),
    ]))

    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('div', { class: 'bu-row' }, [
            el('div', { class: 'bu-grow' }, [`bili-unlock ${__BU_VERSION__}`, el('span', { class: 'bu-hint', text: 'MIT 开源 · 遇到问题欢迎反馈' })]),
            el('a', { class: 'bu-btn sm ghost', href: 'https://github.com/LucasYanzy/bili-unlock', target: '_blank', rel: 'noopener', text: 'GitHub ★' }),
            el('a', { class: 'bu-btn sm ghost', href: 'https://github.com/LucasYanzy/bili-unlock/issues/new', target: '_blank', rel: 'noopener', text: '反馈' }),
        ]),
    ]))

    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation() })
    layer.appendChild(modal)
    sheet.tabIndex = -1
    sheet.focus()
}


// ===== src/main.js =====
// ---- 入口：状态流转 + 播放器操作栏 ----

const isBangumiPage = () => location.hostname === 'www.bilibili.com' && /\/bangumi\/play\/(ep|ss)\d+/.test(location.pathname)
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const fmtTime = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0') }

let current = null // { player, video, timers }

function teardown() {
    if (!current) return
    try { current.player && current.player.reset() } catch (_) { }
    current.timers.forEach(clearInterval)
    current.cleanup.forEach(fn => { try { fn() } catch (_) { } })
    current = null
}

function settingsAction(layer, info) {
    return () => openSettings(layer, { onChange: () => run(layer, info) })
}

async function run(layer, info, { retriedAuth = false } = {}) {
    teardown()
    const openSet = settingsAction(layer, info)

    if (!getCookie('DedeUserID')) {
        return showCard(layer, {
            title: '需要先登录 B站',
            text: '解锁会用你的账号向代理请求播放地址。\n登录后刷新本页即可。',
            buttons: [
                { label: '去登录', onClick: () => { location.href = 'https://passport.bilibili.com/login?gourl=' + encodeURIComponent(location.href) } },
                { label: '设置', kind: 'ghost', onClick: openSet },
            ],
        })
    }

    // 授权过期且以前授权过：静默续期，不再打扰
    if (!auth.accessKey && store.get('authorized_once', false) && !retriedAuth) {
        showCard(layer, { title: '正在续期授权…', loading: true })
        try { await auth.login(); return run(layer, info, { retriedAuth: true }) } catch (e) { log('silent re-auth failed', e.message) }
    }

    if (!auth.accessKey) {
        return showCard(layer, {
            icon: 'globe',
            title: '这部内容在你所在的地区不可播放',
            text: 'bili-unlock 可以通过代理服务器帮你播放。\n\n第一次使用需要授权一次：用当前登录的账号生成令牌，只保存在本浏览器，只发给代理服务器。',
            buttons: [
                { label: '授权并播放', onClick: () => doAuth(layer, info) },
                { label: '设置', kind: 'ghost', onClick: openSet },
            ],
        })
    }

    showCard(layer, { title: '正在解锁…', text: `通过 ${config.servers[0].replace(/^https?:\/\//, '')} 获取播放地址`, loading: true })
    let got
    try {
        got = await requestPlayurl(info)
    } catch (e) {
        log('unlock failed', e.message)
        if (e.needAuth && !retriedAuth) {
            showCard(layer, { title: '授权已失效，正在重新授权…', loading: true })
            try { await auth.login(); return run(layer, info, { retriedAuth: true }) } catch (e2) { log('re-auth failed', e2.message) }
        }
        return showCard(layer, {
            icon: 'globe',
            title: '解锁失败',
            text: e.needAuth ? '代理说没有授权。可以重新授权试试。' : '代理服务器没有返回可用的播放地址。可以换一个代理再试。',
            error: redact(e.message),
            buttons: [
                { label: '重试', onClick: () => run(layer, info) },
                e.needAuth ? { label: '重新授权', kind: 'ghost', onClick: () => doAuth(layer, info) } : null,
                { label: '更换代理', kind: 'ghost', onClick: openSet },
            ].filter(Boolean),
        })
    }

    try {
        await startPlayer(layer, info, got)
    } catch (e) {
        log('player failed', e.message)
        showCard(layer, {
            title: '播放器启动失败', error: redact(e.message),
            buttons: [{ label: '重试', onClick: () => run(layer, info) }, { label: '反馈问题', kind: 'ghost', onClick: () => window.open('https://github.com/LucasYanzy/bili-unlock/issues/new') }],
        })
    }
}

async function startPlayer(layer, info, { result, server, area }) {
    layer.replaceChildren()
    const video = el('video', { controls: true, playsinline: true, preload: 'auto' })
    layer.appendChild(video)
    current = { player: null, video, timers: [], cleanup: [] }

    const { player, tracks, start } = result.dash
        ? await playDash(video, result.dash, config.quality)
        : playDurl(video, result)
    current.player = player

    // ---- 顶部操作栏 ----
    const top = el('div', { class: 'bu-top' })
    const host = server.replace(/^https?:\/\//, '')
    top.appendChild(el('span', { class: 'bu-badge' }, [iconEl('lock'), '已解锁']))
    top.appendChild(el('span', { class: 'bu-sub bu-grow', text: `${AREA_NAME[area] || area} · ${host}`, title: server }))

    const qualityName = i => tracks[i] ? (QN_NAME[tracks[i].id] || `${tracks[i].height}P`) : '自动'
    let quality = null
    if (player && tracks.length > 1) {
        quality = dropdown(qualityName(start), () => tracks.map((t, i) => ({ value: i, label: QN_NAME[t.id] || `${t.height}P`, hint: `${t.width}×${t.height}` })).reverse(), (i) => {
            player.setQualityFor('video', i, true)
            quality.set(qualityName(i), i)
            toast(layer, '切换到 ' + qualityName(i))
            log('quality', qualityName(i))
        }, '画质')
        quality.set(qualityName(start), start)
        top.appendChild(quality.wrap)
    }

    const rateLabel = r => r === 1 ? '倍速' : r + 'x'
    const setRate = r => { video.playbackRate = r; config.rate = r; rate.set(rateLabel(r), r) }
    const rate = dropdown(rateLabel(config.rate), () => RATES.slice().reverse().map(r => ({ value: r, label: r + 'x' })), (r) => { setRate(r); toast(layer, '倍速 ' + r + 'x') }, '倍速')
    rate.set(rateLabel(config.rate), config.rate)
    top.appendChild(rate.wrap)

    const accel = acceleratorMode()
    if (accel) {
        top.appendChild(el('button', {
            class: 'bu-chip icon' + (accel !== 'off' ? ' on' : ''), title: `播放加速：${ACCEL_MODE_NAME[accel] || accel}（点击打开加速面板）`,
            html: ICON.bolt, on: { click: () => openAcceleratorPanel() },
        }))
    }
    const toggleWebFs = () => { layer.classList.toggle('bu-webfs'); toast(layer, layer.classList.contains('bu-webfs') ? '网页全屏（Esc 退出）' : '退出网页全屏') }
    top.appendChild(el('button', { class: 'bu-chip icon', title: '网页全屏', html: ICON.expand, on: { click: toggleWebFs } }))
    top.appendChild(el('button', { class: 'bu-chip icon', title: '设置', html: ICON.gear, on: { click: settingsAction(layer, info) } }))
    layer.appendChild(top)

    // 鼠标不动 2.5 秒隐藏操作栏
    let idleTimer
    const wake = () => { layer.classList.remove('bu-idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!video.paused) layer.classList.add('bu-idle') }, 2500) }
    layer.addEventListener('mousemove', wake)
    video.addEventListener('pause', wake)
    document.addEventListener('click', () => layer.querySelectorAll('.bu-menu.open').forEach(m => m.classList.remove('open')))
    wake()

    // ---- 播放进度记忆 ----
    const progKey = 'progress_' + info.epId
    video.addEventListener('loadedmetadata', () => {
        video.playbackRate = config.rate
        const p = store.get(progKey, null)
        if (config.resume && p && p.t > 10 && video.duration && p.t < video.duration - 20) {
            video.currentTime = p.t
            toast(layer, '已从 ' + fmtTime(p.t) + ' 继续播放', 2200)
        }
        if (config.autoplay) video.play().catch(() => toast(layer, '点击播放', 2000))
    }, { once: true })
    const saveProgress = () => {
        if (!config.resume || !video.duration) return
        if (video.currentTime > video.duration - 20) store.del(progKey)
        else if (video.currentTime > 10) store.set(progKey, { t: Math.floor(video.currentTime), d: Math.floor(video.duration), at: Date.now() })
    }
    current.timers.push(setInterval(saveProgress, 5000))
    video.addEventListener('pause', saveProgress)
    window.addEventListener('pagehide', saveProgress)
    current.cleanup.push(() => { saveProgress(); window.removeEventListener('pagehide', saveProgress) })

    // ---- 快捷键（鼠标在播放器上或播放器有焦点时） ----
    let hover = false
    layer.addEventListener('mouseenter', () => { hover = true })
    layer.addEventListener('mouseleave', () => { hover = false })
    const onKey = (e) => {
        if (!layer.isConnected || (!hover && !layer.contains(document.activeElement) && !layer.classList.contains('bu-webfs'))) return
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || e.target.isContentEditable) return
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const k = e.key
        let handled = true
        if (k === ' ' || k === 'k') video.paused ? video.play() : video.pause()
        else if (k === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); toast(layer, '◀ ' + fmtTime(video.currentTime)) }
        else if (k === 'ArrowRight') { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 5); toast(layer, fmtTime(video.currentTime) + ' ▶') }
        else if (k === 'ArrowUp') { video.volume = Math.min(1, video.volume + 0.1); toast(layer, '音量 ' + Math.round(video.volume * 100) + '%') }
        else if (k === 'ArrowDown') { video.volume = Math.max(0, video.volume - 0.1); toast(layer, '音量 ' + Math.round(video.volume * 100) + '%') }
        else if (k === 'm') { video.muted = !video.muted; toast(layer, video.muted ? '静音' : '取消静音') }
        else if (k === 'f') {
            const fs = document.fullscreenElement || document.webkitFullscreenElement
            if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document)
            else if (layer.requestFullscreen) layer.requestFullscreen().catch(() => { })
            else if (layer.webkitRequestFullscreen) layer.webkitRequestFullscreen()
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen()
        }
        else if (k === 'Escape' && layer.classList.contains('bu-webfs')) toggleWebFs()
        else if (k === '[' || k === ']') {
            const i = RATES.indexOf(video.playbackRate)
            const r = RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))]
            setRate(r); toast(layer, '倍速 ' + r + 'x')
        }
        else handled = false
        if (handled) { e.preventDefault(); e.stopPropagation(); wake() }
    }
    window.addEventListener('keydown', onKey, true)
    current.cleanup.push(() => window.removeEventListener('keydown', onKey, true))

    video.addEventListener('error', () => log('video error', video.error && video.error.code))
    video.addEventListener('playing', () => log('playing', qualityName(start)), { once: true })
    log('stream', tracks.map(t => QN_NAME[t.id] || t.height).join('/'))
}

async function doAuth(layer, info) {
    showCard(layer, { title: '正在授权…', text: '使用当前登录的账号生成令牌', loading: true })
    try {
        await auth.login()
        run(layer, info)
    } catch (e) {
        log('auth failed', e.message)
        showCard(layer, {
            title: '授权失败', error: redact(e.message),
            buttons: [{ label: '再试一次', onClick: () => doAuth(layer, info) }, { label: '设置', kind: 'ghost', onClick: settingsAction(layer, info) }],
        })
    }
}

async function boot() {
    if (!isBangumiPage()) return
    let info = null
    for (let i = 0; i < 40 && !(info = readPlayInfo()); i++) await new Promise(r => setTimeout(r, 250))
    log('page', location.pathname, info ? JSON.stringify({ blocked: info.blocked, ep: info.epId, cid: info.cid, type: info.playType, drm: info.isDrm }) : 'no playinfo', 'auth=' + (auth.accessKey ? 1 : 0))
    if (!info || !info.blocked) return
    if (auth.accessKey) store.set('authorized_once', true)

    let layer = null
    for (let i = 0; i < 40 && !(layer = createLayer()); i++) await new Promise(r => setTimeout(r, 250))
    if (!layer) return log('找不到播放器区域')
    log('layer mounted in', layer.parentElement && (layer.parentElement.id || layer.parentElement.className))

    if (info.isDrm) {
        return showCard(layer, { title: '这部内容使用了 DRM 加密', text: 'bili-unlock 无法播放加密内容。', buttons: [] })
    }
    run(layer, info)

    // B站 的 React 会重渲染播放器区域，把面板挤掉；被移除就挂回去（保留里面的状态）
    let reattach = 0
    setInterval(() => {
        if (layer.isConnected && layer.offsetWidth > 0) return
        if (layer.classList.contains('bu-webfs') && layer.isConnected) return
        const box = findPlayerBox()
        if (!box) return
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative'
        box.appendChild(layer)
        if (++reattach <= 5) log('layer re-attached', reattach)
    }, 400)

    // 番剧页切集是前端路由，页面数据不会更新；切集后整页刷新让服务端重新给数据
    const startPath = location.pathname
    setInterval(() => { if (location.pathname !== startPath && isBangumiPage()) location.reload() }, 800)
}

if (window.top === window) {
    log('loaded', __BU_VERSION__, location.pathname)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
    else boot()
}

})();
