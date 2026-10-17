/**
 * 麻豆 ForwardWidget
 * 站点: https://madou.club
 * 列表: article.excerpt，封面优先 data-src
 * 播放: 详情 iframe → dash.madou.club/share/xxx → m3u8?token=
 * 宣传: https://t.me/nostremby （欢迎加入 宝宝巴士乐园）
 */
WidgetMetadata = {
  id: "forward.madou.tut",
  title: "麻豆",
  version: "1.0.2",
  requiredVersion: "0.0.1",
  description: "麻豆社在线：分栏分类/搜索，详情解析 HLS · CapyPlayer 适配版 | 欢迎加入 宝宝巴士乐园 t.me/nostremby",
  author: "宝宝巴士",
  site: "https://t.me/nostremby",
  detailCacheDuration: 300,
  globalParams: [
    {
      name: "baseUrl",
      title: "站点域名",
      type: "input",
      value: "https://madou.club"
    }
  ],
  modules: [
    { id: "home", title: "最新", functionName: "loadHome", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "madou", title: "麻豆传媒", functionName: "loadMadou", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "hkd", title: "HongKongDoll", functionName: "loadHkd", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "guodong", title: "果冻传媒", functionName: "loadGuodong", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "mitao", title: "蜜桃影像", functionName: "loadMitao", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "tianmei", title: "天美传媒", functionName: "loadTianmei", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "jingdong", title: "精东影业", functionName: "loadJingdong", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "jy91", title: "91制片厂", functionName: "load91", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "huangjia", title: "皇家华人", functionName: "loadHuangjia", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "tuzi", title: "兔子先生", functionName: "loadTuzi", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "xingkong", title: "星空无限", functionName: "loadXingkong", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "aidou", title: "爱豆", functionName: "loadAidou", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "daoyan", title: "导演系列", functionName: "loadDaoyan", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "daxiang", title: "大象传媒", functionName: "loadDaxiang", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "maozhua", title: "猫爪影像", functionName: "loadMaozhua", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "xingba", title: "杏吧", functionName: "loadXingba", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "lebo", title: "乐播传媒", functionName: "loadLebo", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "psycho", title: "PsychoPorn", functionName: "loadPsycho", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "fanwai", title: "番外篇", functionName: "loadFanwai", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    { id: "huaxu", title: "花絮", functionName: "loadHuaxu", cacheDuration: 300, params: [{ name: "page", title: "页码", type: "page" }] },
    {
      id: "search",
      title: "搜索",
      functionName: "search",
      cacheDuration: 300,
      params: [
        { name: "keyword", title: "关键词", type: "input" },
        { name: "page", title: "页码", type: "page" }
      ]
    }
  ]
};

var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function t(v) {
  return String(v == null ? "" : v).trim();
}

function baseOf(params) {
  return t((params && params.baseUrl) || "https://madou.club").replace(/\/+$/, "");
}

function hdr(base) {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: base + "/"
  };
}

async function fetchHtml(url, base) {
  var resp = await Widget.http.get(url, { headers: hdr(base), timeout: 20000 });
  if (!resp) throw new Error("空响应");
  if (typeof resp.data === "string") return resp.data;
  if (resp.data != null) return String(resp.data);
  throw new Error("无法读取: " + url);
}

function absUrl(base, u) {
  u = t(u);
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return base + u;
  return base + "/" + u;
}

function decodeHtml(s) {
  return t(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** 封面：优先 data-src / data-original，去掉占位 thumb.png；尽量升到原图 */
function pickCover(chunk, base) {
  var candidates = [];
  var re = /(?:data-src|data-original|data-thumb|src)=["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(chunk))) {
    var u = m[1];
    if (!u) continue;
    if (/thumb\.png|logo\.png|avatar|loading|placeholder/i.test(u)) continue;
    candidates.push(u);
  }
  if (!candidates.length) return "";
  var cover = candidates[0];
  // -240x180.jpg → 尝试原图路径（去掉尺寸后缀）
  cover = cover.replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))/i, "$1");
  return absUrl(base, cover);
}

function listUrl(base, cat, page) {
  page = Number(page || 1) || 1;
  cat = t(cat);
  if (!cat || cat === "home" || cat === "latest") {
    return page <= 1 ? base + "/" : base + "/page/" + page;
  }
  // 分类 slug：中文或英文路径
  var path = base + "/category/" + encodeURIComponent(cat);
  if (page > 1) path += "/page/" + page;
  return path;
}

function parseList(html, base) {
  if (!html) return [];
  var out = [];
  var seen = {};
  var re = /<article[^>]*class="[^"]*excerpt[^"]*"[\s\S]*?<\/article>/gi;
  var m;
  while ((m = re.exec(html))) {
    var chunk = m[0];
    var hm = chunk.match(
      /<a[^>]+class="[^"]*thumbnail[^"]*"[^>]+href=["']([^"']+)["']/i
    );
    if (!hm) hm = chunk.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["']/i);
    if (!hm) hm = chunk.match(/href=["'](https?:\/\/[^"']+\.html)["']/i);
    if (!hm) continue;
    var link = absUrl(base, hm[1]);
    if (seen[link]) continue;
    seen[link] = 1;

    var title = "";
    var tm = chunk.match(/<h2[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    if (tm) title = decodeHtml(tm[1]);
    if (!title) {
      tm = chunk.match(/title=["']([^"']+)["']/i);
      if (tm) title = decodeHtml(tm[1]);
    }
    if (!title) title = link;

    var cover = pickCover(chunk, base);
    var id = link;
    var idm = link.match(/\/([^\/]+)\.html/i);
    if (idm) id = decodeURIComponent(idm[1]);

    out.push({
      id: id,
      type: "link",
      title: title,
      coverUrl: cover,
      posterPath: cover,
      backdropPath: cover,
      posterUrl: cover,
      backdropUrl: cover,
      description: "",
      mediaType: "movie",
      link: link,
      customHeaders: {
        "User-Agent": UA,
        Referer: base + "/"
      }
    });
  }
  return out;
}

async function loadByCat(params, cat) {
  params = params || {};
  var base = baseOf(params);
  var page = params.page || 1;
  var url = listUrl(base, cat, page);
  var html = await fetchHtml(url, base);
  return parseList(html, base);
}

async function loadHome(params) {
  return loadByCat(params, "home");
}
async function loadMadou(params) {
  return loadByCat(params, "麻豆传媒");
}
async function loadHkd(params) {
  return loadByCat(params, "hongkongdoll");
}
async function loadGuodong(params) {
  return loadByCat(params, "果冻传媒");
}
async function loadMitao(params) {
  return loadByCat(params, "蜜桃影像");
}
async function loadTianmei(params) {
  return loadByCat(params, "天美传媒");
}
async function loadJingdong(params) {
  return loadByCat(params, "精东影业");
}
async function load91(params) {
  return loadByCat(params, "91制片厂");
}
async function loadHuangjia(params) {
  return loadByCat(params, "皇家华人");
}
async function loadTuzi(params) {
  return loadByCat(params, "兔子先生");
}
async function loadXingkong(params) {
  return loadByCat(params, "星空无限传媒");
}
async function loadAidou(params) {
  return loadByCat(params, "爱豆");
}
async function loadDaoyan(params) {
  return loadByCat(params, "麻豆导演系列");
}
async function loadDaxiang(params) {
  return loadByCat(params, "大象传媒");
}
async function loadMaozhua(params) {
  return loadByCat(params, "猫爪影像");
}
async function loadXingba(params) {
  return loadByCat(params, "杏吧");
}
async function loadLebo(params) {
  return loadByCat(params, "乐播传媒");
}
async function loadPsycho(params) {
  return loadByCat(params, "psychoporntw");
}
async function loadFanwai(params) {
  return loadByCat(params, "麻豆番外篇");
}
async function loadHuaxu(params) {
  return loadByCat(params, "麻豆花絮");
}

async function search(params) {
  params = params || {};
  var base = baseOf(params);
  var kw = t(params.keyword || params.wd || "");
  if (!kw) return [];
  var page = Number(params.page || 1) || 1;
  var url = base + "/?s=" + encodeURIComponent(kw);
  if (page > 1) url = base + "/page/" + page + "/?s=" + encodeURIComponent(kw);
  var html = await fetchHtml(url, base);
  return parseList(html, base);
}

function extractShareUrl(html) {
  if (!html) return "";
  var m =
    html.match(
      /src\s*=\s*["']?(https?:\/\/dash\.madou\.club\/share\/[a-zA-Z0-9]+)["'\s>]/i
    ) ||
    html.match(
      /src\s*=\s*["']?(https?:\/\/[^"'\s>]+\.madou\.[^"'\s>]+\/share\/[a-zA-Z0-9]+)["'\s>]/i
    ) ||
    html.match(/https?:\/\/dash\.madou\.club\/share\/[a-zA-Z0-9]+/i);
  if (!m) return "";
  return m[1] || m[0];
}

async function resolvePlayFromShare(shareUrl, base) {
  shareUrl = t(shareUrl);
  if (!shareUrl) return null;
  var playerHtml = await fetchHtml(shareUrl, base);
  var tokenM = playerHtml.match(/var\s+token\s*=\s*["']([^"']*)["']/);
  var m3u8M = playerHtml.match(/var\s+m3u8\s*=\s*["']([^"']+)["']/);
  if (!m3u8M) return null;
  var path = m3u8M[1];
  var dashBase =
    (shareUrl.match(/^(https?:\/\/[^\/]+)/i) || [])[1] ||
    "https://dash.madou.club";
  if (path.indexOf("/") === 0) path = dashBase + path;
  else if (!/^https?:\/\//i.test(path))
    path = dashBase.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
  var token = (tokenM && tokenM[1]) || "";
  if (token) path += (path.indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
  return { url: path, shareUrl: shareUrl };
}

/** master → 最高画质子流 */
async function pickBestHls(masterUrl, base) {
  try {
    var txt = await fetchHtml(masterUrl, base);
    if (!txt || txt.indexOf("#EXT-X-STREAM-INF") === -1) return masterUrl;
    var lines = txt.split(/\r?\n/);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < lines.length; i++) {
      if (!/#EXT-X-STREAM-INF/i.test(lines[i])) continue;
      var res = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      var bw = lines[i].match(/BANDWIDTH=(\d+)/i);
      var h = res ? parseInt(res[1], 10) : 0;
      var score = res ? h : bw ? parseInt(bw[1], 10) / 1000 : 0;
      var j = i + 1;
      while (
        j < lines.length &&
        (!lines[j].replace(/\s/g, "") || lines[j].charAt(0) === "#")
      )
        j++;
      var vurl = j < lines.length ? t(lines[j]) : "";
      if (!vurl) continue;
      try {
        // relative → absolute
        if (!/^https?:\/\//i.test(vurl)) {
          var basePath = masterUrl.replace(/\/[^\/]*$/, "/");
          vurl = vurl.indexOf("/") === 0
            ? masterUrl.match(/^https?:\/\/[^\/]+/)[0] + vurl
            : basePath + vurl;
        }
      } catch (e) {}
      if (score > bestScore) {
        bestScore = score;
        best = vurl;
      }
    }
    return best || masterUrl;
  } catch (e) {
    return masterUrl;
  }
}

function normalizeLink(link) {
  if (link && typeof link === "object") {
    return t(link.link || link.id || link.url || "");
  }
  return t(link);
}

async function loadDetailFwd(link) {
  var pageUrl = normalizeLink(link);
  if (!pageUrl) return null;
  var base = baseOf({});
  if (!/^https?:\/\//i.test(pageUrl)) {
    pageUrl = absUrl(base, pageUrl.indexOf("/") === 0 ? pageUrl : "/" + pageUrl);
  }
  var html = await fetchHtml(pageUrl, base);

  var title = "";
  var tm = html.match(/<h1[^>]*class="[^"]*article-title[^"]*"[^>]*>([^<]+)/i);
  if (tm) title = decodeHtml(tm[1]);
  if (!title) {
    tm = html.match(/<h1[^>]*>([^<]{2,200})<\/h1>/i);
    if (tm) title = decodeHtml(tm[1]);
  }
  if (!title) {
    tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) title = decodeHtml(tm[1].replace(/\s*[-|_].*$/, ""));
  }

  var cover = pickCover(html, base);
  // 详情页优先 covers/ 下的图
  var cm = html.match(
    /(?:data-src|src)=["'](https?:\/\/[^"']*\/covers\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i
  );
  if (cm) cover = absUrl(base, cm[1].replace(/-\d+x\d+(\.(?:jpg|jpeg|png|webp))/i, "$1"));

  var share = extractShareUrl(html);
  var play = share ? await resolvePlayFromShare(share, base) : null;
  var videoUrl = "";
  if (play && play.url) {
    videoUrl = await pickBestHls(play.url, base);
  }

  return {
    id: pageUrl,
    type: "url",
    title: title || pageUrl,
    description: "",
    coverUrl: cover,
    posterPath: cover,
    backdropPath: cover,
    videoUrl: videoUrl,
    mediaType: "movie",
    link: pageUrl,
    customHeaders: {
      "User-Agent": UA,
      Referer: "https://madou.club/",
      Origin: "https://dash.madou.club"
    }
  };
}

async function loadResource(params) {
  params = params || {};
  var pageUrl = t(params.link || params.id || "");
  if (!pageUrl) return [];
  var base = baseOf(params);
  if (!/^https?:\/\//i.test(pageUrl)) {
    pageUrl = absUrl(base, pageUrl);
  }
  var html = await fetchHtml(pageUrl, base);
  var share = extractShareUrl(html);
  if (!share) return [];
  var play = await resolvePlayFromShare(share, base);
  if (!play || !play.url) return [];
  var best = await pickBestHls(play.url, base);
  var headers = {
    "User-Agent": UA,
    Referer: "https://madou.club/",
    Origin: "https://dash.madou.club"
  };
  var list = [
    {
      name: "最高画质",
      description: "HLS",
      url: best,
      customHeaders: headers
    }
  ];
  if (best !== play.url) {
    list.push({
      name: "原画(Master)",
      description: "HLS Master",
      url: play.url,
      customHeaders: headers
    });
  }
  return list;
}
// ================= CapyPlayer 适配层 =================
// Capy 不走 Forward 的 loadResource 懒解析：详情里把全集播放地址预先解好，
// 并把封面/视频字段按 Capy 规范（posterUrl/backdropUrl/videoUrl/episodes）补齐。
function __capyCoverOf(obj) {
  var cover =
    obj.posterPath || obj.coverUrl || obj.backdropPath || obj.detailPoster ||
    obj.posterUrl || obj.backdropUrl || obj.pic || obj.cover || "";
  if (cover) {
    obj.coverUrl = cover;
    obj.posterPath = cover;
    obj.backdropPath = cover;
    obj.posterUrl = cover;
    obj.backdropUrl = cover;
    obj.detailPoster = cover;
    obj.pic = cover;
    obj.cover = cover;
    obj.image = cover;
  }
  return cover;
}

async function __capyResolveOne(ep) {
  if (ep.videoUrl) return ep.videoUrl;
  if (!ep.link || typeof loadResource !== "function") return "";
  try {
    var r = await loadResource({ link: ep.link });
    if (r && r.length && r[0] && r[0].url) {
      if (r[0].customHeaders) {
        ep.customHeaders = r[0].customHeaders;
        ep.headers = r[0].customHeaders;
      }
      return r[0].url;
    }
  } catch (e) {}
  return "";
}

async function loadDetail(link) {
  var detail = null;
  try {
    detail = await loadDetailFwd(link);
  } catch (e) {
    detail = null;
  }
  if (!detail) {
    return {
      id: "madou:err",
      type: "detail",
      title: "加载失败",
      description: "详情请求失败，请稍后重试",
      mediaType: "tv",
      videoUrl: "",
      url: "",
      playUrl: "",
      playerType: "none",
      episodes: [],
      episodeItems: [],
      seasons: []
    };
  }

  var cover = __capyCoverOf(detail);
  var rawEps = detail.episodeItems || detail.childItems || [];
  var eps = [];
  for (var i = 0; i < rawEps.length; i++) {
    var raw = rawEps[i] || {};
    var ep = {
      id: raw.id || raw.link || "ep" + (i + 1),
      title: raw.title || raw.name || "第" + (i + 1) + "集",
      episodeNumber: raw.episodeNumber || i + 1,
      seasonNumber: raw.seasonNumber || 1,
      link: raw.link || "",
      videoUrl: raw.videoUrl || "",
      url: raw.videoUrl || "",
      playUrl: raw.videoUrl || "",
      posterUrl: cover,
      backdropUrl: cover,
      playerType: "system"
    };
    if (raw.customHeaders) {
      ep.customHeaders = raw.customHeaders;
      ep.headers = raw.customHeaders;
    }
    eps.push(ep);
  }

  // 分批并行解析剩余集数（单集失败不影响整表）
  var MAX = 150;
  var BATCH = 6;
  var todoIdx = [];
  for (var ti = 0; ti < eps.length && ti < MAX; ti++) {
    if (!eps[ti].videoUrl) todoIdx.push(ti);
  }
  for (var b = 0; b < todoIdx.length; b += BATCH) {
    await Promise.all(
      todoIdx.slice(b, b + BATCH).map(async function (idx) {
        var u = await __capyResolveOne(eps[idx]);
        if (u) {
          eps[idx].videoUrl = u;
          eps[idx].url = u;
          eps[idx].playUrl = u;
        }
      })
    );
  }

  var firstUrl = detail.videoUrl || "";
  if (!firstUrl) {
    for (var fi = 0; fi < eps.length; fi++) {
      if (eps[fi].videoUrl) {
        firstUrl = eps[fi].videoUrl;
        break;
      }
    }
  }

  detail.type = "detail";
  detail.episodes = eps;
  detail.episodeItems = eps;
  detail.childItems = eps;
  detail.seasons = eps.length
    ? [{ title: "第1季", name: "第1季", seasonNumber: 1, episodes: eps }]
    : [];
  detail.videoUrl = firstUrl;
  detail.url = firstUrl;
  detail.playUrl = firstUrl;
  detail.playerType = firstUrl ? "system" : "none";
  return detail;
}
