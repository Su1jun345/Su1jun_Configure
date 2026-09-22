// 普通影视站插件模板
// 基于用户提供的黄果短剧.js结构整理
// 注意：以下 SITE 与榜单路径需要替换成你有权访问的普通影视站点实际路径。

const SITE = "https://example.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const FALLBACK_COVER = SITE + "/favicon.ico";
const MAX_EPISODES = 300;

const RANKING_URLS = {
  daily: SITE + "/ranking/daily/",
  weekly: SITE + "/ranking/weekly/",
  monthly: SITE + "/ranking/monthly/"
};

var WidgetMetadata = {
  id: "normal_tv_ranking",
  title: "影视榜单",
  description: "普通影视内容榜单，支持日榜、周榜、月榜",
  author: "...",
  version: "1.0.0",
  requiredVersion: "0.0.7",
  detailCacheDuration: 300,
  site: SITE,
  icon: FALLBACK_COVER,

  modules: [
    {
      title: "排行榜",
      description: "浏览日榜、周榜、月榜",
      requiresWebView: true,
      functionName: "loadRanking",
      cacheDuration: 900,
      params: [
        {
          name: "ranking",
          title: "榜单",
          type: "enumeration",
          description: "选择榜单",
          value: "daily",
          enumOptions: [
            { title: "日榜", value: "daily" },
            { title: "周榜", value: "weekly" },
            { title: "月榜", value: "monthly" }
          ]
        },
        {
          name: "page",
          title: "页码",
          type: "page",
          description: "页码",
          value: "1"
        }
      ]
    }
  ],

  search: {
    title: "搜索",
    functionName: "searchVideos",
    params: [
      {
        name: "keyword",
        title: "搜索关键词",
        type: "input",
        description: "输入剧名或关键词",
        value: ""
      },
      {
        name: "page",
        title: "页码",
        type: "page",
        description: "页码",
        value: "1"
      }
    ]
  }
};

function pageNumber(params) {
  const page = parseInt(params && params.page, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function absoluteUrl(value, baseUrl) {
  const url = String(value || "").trim();

  if (!url) return "";

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (/^\/\//.test(url)) {
    return "https:" + url;
  }

  try {
    return new URL(url, baseUrl || SITE + "/").toString();
  } catch (error) {
    return url;
  }
}

function requestHeaders(referer) {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    "Referer": referer || SITE + "/"
  };
}

async function fetchPage(url, params) {
  const requestUrl = String(url || "");
  const headers = requestHeaders(
    (params && params.referer) || SITE + "/"
  );

  if (typeof fetch === "function") {
    try {
      const response = await fetch(requestUrl, {
        method: "GET",
        headers: headers,
        cache: "no-store"
      });

      if (response && response.ok) {
        return {
          ok: true,
          data: await response.text()
        };
      }
    } catch (error) {
      console.warn(
        "fetch 请求失败",
        requestUrl,
        error && error.message
          ? error.message
          : error
      );
    }
  }

  try {
    const response = await Widget.http.get(requestUrl, {
      headers: headers,
      timeout: 30000
    });

    if (
      response &&
      response.ok &&
      response.data !== null &&
      response.data !== undefined
    ) {
      return {
        ok: true,
        data:
          typeof response.data === "string"
            ? response.data
            : String(response.data)
      };
    }
  } catch (error) {
    console.warn(
      "Widget.http 请求失败",
      requestUrl,
      error && error.message
        ? error.message
        : error
    );
  }

  return {
    ok: false,
    data: ""
  };
}
function stripBasicTags(value) {
  return decodeBasicEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeBasicEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * 榜单解析
 *
 * 默认兼容常见结构：
 *   <div class="rank-item" ...>
 *   <a href="/detail/123">
 *   <img src="...">
 *   <h3>片名</h3>
 *
 * 如果目标普通影视站使用不同 HTML 结构，
 * 只需要修改这个函数即可。
 */
function parseRankingCards(html, pageUrl) {
  const source = String(html || "");
  const items = [];
  const seen = {};

  const itemRe =
    /<div\b[^>]*class=["'][^"']*(?:rank-item|ranking-item|item|card)[^"']*["'][^>]*>/gi;

  const starts = [];
  let match;

  while ((match = itemRe.exec(source))) {
    starts.push(match.index);
  }

  function attr(text, name) {
    const re = new RegExp(
      "\\b" +
        name +
        "\\s*=\\s*[\\\"']([^\\\"']*)",
      "i"
    );

    const hit = String(text || "").match(re);

    return hit
      ? decodeBasicEntities(hit[1])
      : "";
  }

  function textByClass(block, className) {
    const re = new RegExp(
      "<[^>]*class=[\\\"'][^\\\"']*" +
        className +
        "[^\\\"']*[\\\"'][^>]*>([\\s\\S]*?)</",
      "i"
    );

    const hit = String(block || "").match(re);

    return hit
      ? stripBasicTags(hit[1])
      : "";
  }

  function image(block) {
    const hit = String(block || "").match(
      /<img\b[^>]*>/i
    );

    if (!hit) {
      return FALLBACK_COVER;
    }

    const tag = hit[0];

    const value =
      attr(tag, "data-src") ||
      attr(tag, "data-original") ||
      attr(tag, "data-lazy-src") ||
      attr(tag, "src");

    return value &&
      !/^blob:|^data:/i.test(value)
      ? absoluteUrl(value, pageUrl)
      : FALLBACK_COVER;
  }

  for (
    let index = 0;
    index < starts.length;
    index++
  ) {
    const block = source.slice(
      starts[index],
      starts[index + 1] || source.length
    );

    const hrefMatch = block.match(
      /href=["']([^"']*(?:\/detail\/|\/video\/)[^"']*)["']/i
    );

    if (!hrefMatch) {
      continue;
    }

    const href = absoluteUrl(
      hrefMatch[1],
      pageUrl
    );

    if (!href || seen[href]) {
      continue;
    }

    const imageTag = block.match(
      /<img\b[^>]*>/i
    );

    const title =
      cleanTitle(
        textByClass(block, "title") ||
        textByClass(block, "name") ||
        attr(
          imageTag
            ? imageTag[0]
            : "",
          "alt"
        ) ||
        attr(block, "title")
      );

    if (!title) {
      continue;
    }

    const ratingText =
      textByClass(block, "score") ||
      textByClass(block, "rating");

    const ratingMatch =
      ratingText.match(
        /([0-9]+(?:\.[0-9]+)?)/i
      );

    const poster = image(block);

    seen[href] = true;

    items.push({
      id: href,

      type: "link",

      mediaType: "tv",

      title: title,

      description:
        textByClass(block, "desc") ||
        textByClass(block, "description") ||
        "",

      rating: ratingMatch
        ? parseFloat(ratingMatch[1])
        : undefined,

      posterPath: poster,

      backdropPath: poster,

      posterUrl: poster,

      backdropUrl: poster,

      link: href,

      detailUrl: href,

      playerType: "none"
    });
  }

  return items;
}
async function loadRanking(params = {}) {
  const ranking = String(
    params.ranking || "daily"
  );

  const url =
    RANKING_URLS[ranking] ||
    RANKING_URLS.daily;

  const page = pageNumber(params);

  const separator =
    url.indexOf("?") >= 0
      ? "&"
      : "?";

  const requestUrl =
    url +
    separator +
    "page=" +
    page;

  const response = await fetchPage(
    requestUrl,
    {
      referer: SITE + "/"
    }
  );

  if (!response || !response.ok) {
    return [];
  }

  return parseRankingCards(
    response.data,
    url
  );
}

async function searchVideos(params = {}) {
  const keyword =
    String(
      params.keyword || ""
    ).trim();

  if (!keyword) {
    return [];
  }

  const page = pageNumber(params);

  // 根据目标站点实际搜索 URL 修改这里
  const url =
    SITE +
    "/search/?keyword=" +
    encodeURIComponent(keyword) +
    "&page=" +
    page;

  const response = await fetchPage(
    url,
    {
      referer: SITE + "/"
    }
  );

  if (!response || !response.ok) {
    return [];
  }

  return parseRankingCards(
    response.data,
    url
  );
}