/*
 * CapyPlayer Widget - Trakt 继续观看（OAuth 终极版）
 *
 * 融合了：
 * 1. 真实的 /sync/playback 接口：100% 还原官方继续观看，包含电影和剧集真实暂停进度。
 * 2. TMDB 并发与缓存：加载速度极快，防封锁。
 * 3. 彻底修复点击跳转：补齐 Action 路由，点击剧集卡片直接进选集，不再只停留在主页。
 */

WidgetMetadata = {
    id: "trakt_continue_ultimate",
    title: "Trakt 恢复播放 (终极版)",
    author: "MakkaPakka & Optimized",
    description: "必须通过 OAuth 登录，获取与官方 100% 同步的真实影视暂停进度。",
    version: "3.0.0",
    requiredVersion: "0.0.1",

    globalParams: [
        { name: "oauthClientId", title: "OAuth Client ID", type: "input", value: "" },
        { name: "oauthClientSecret", title: "OAuth Client Secret", type: "input", value: "" },
        { name: "oauthRedirectUri", title: "OAuth Redirect URI", type: "input", value: "urn:ietf:wg:oauth:2.0:oob" }
    ],

    modules: [
        {
            title: "继续观看",
            functionName: "loadContinueWatchingOAuth",
            type: "list",
            cacheDuration: 0, // 强制每次打开实时请求
            params: [
                { name: "page", title: "页码", type: "page" }
            ]
        },
        {
            title: "Trakt OAuth 登录",
            functionName: "manageTraktOAuth",
            type: "list",
            cacheDuration: 0,
            params: [
                {
                    name: "oauthAction",
                    title: "OAuth 操作",
                    type: "enumeration",
                    value: "status",
                    enumOptions: [
                        { title: "🔐 查看登录状态", value: "status" },
                        { title: "1️⃣ 生成设备登录码", value: "start" },
                        { title: "2️⃣ 检查授权并完成登录", value: "complete" },
                        { title: "🚪 退出登录", value: "logout" }
                    ]
                }
            ]
        }
    ]
};

const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_AUTH_BASE = "https://auth.trakt.tv";
const STORAGE_TOKEN_KEY = "trakt_oauth_token_v3";
const STORAGE_DEVICE_KEY = "trakt_oauth_device_v3";

const tmdbCache = new Map();
const TMDB_CONCURRENCY = 5;

// ==========================================
// 核心：真实继续观看逻辑 (需 OAuth)
// ==========================================
async function loadContinueWatchingOAuth(params = {}) {
    const { oauthClientId, oauthClientSecret, oauthRedirectUri = "urn:ietf:wg:oauth:2.0:oob", page = 1 } = params;
    const currentPage = Math.max(1, Number(page) || 1);
    const pageSize = 15;

    if (!oauthClientId || !oauthClientSecret) {
        return [{ id: "setup", type: "text", title: "需要 OAuth 设置", description: "请先在组件设置中填写 OAuth Client ID 和 Secret" }];
    }

    try {
        const accessToken = await ensureOAuthToken(oauthClientId, oauthClientSecret, oauthRedirectUri);

        // 获取真实的暂停进度 (只有 OAuth 才能拿到)
        const [movies, episodes] = await Promise.all([
            fetchPlayback("movies", accessToken, oauthClientId),
            fetchPlayback("episodes", accessToken, oauthClientId)
        ]);

        // 混合电影与剧集，并按暂停时间排序 (最新看过的在最前面)
        const items = [...movies, ...episodes]
            .filter(item => {
                const p = Number(item?.progress);
                return Number.isFinite(p) && p > 0 && p < 100; // 过滤掉进度异常的
            })
            .sort((a, b) => new Date(b.paused_at || 0) - new Date(a.paused_at || 0));

        if (!items.length) {
            return currentPage === 1 ? [{ id: "empty", type: "text", title: "暂无暂停的影视", description: "如果播放器没有同步进度到 Trakt，这里不会显示。" }] : [];
        }

        const start = (currentPage - 1) * pageSize;
        const pageItems = items.slice(start, start + pageSize);

        // 沿用你的优秀并发请求控制
        const result = await mapWithConcurrency(pageItems, TMDB_CONCURRENCY, async (item, index) => {
            return await buildPlaybackItem(item, index);
        });

        return result.filter(Boolean);
    } catch (e) {
        const msg = String(e?.message || e || "未知错误");
        return [{ id: "err", type: "text", title: "加载失败", description: msg.includes("未登录") ? "请先进入「Trakt OAuth 登录」完成授权" : msg }];
    }
}

async function fetchPlayback(kind, accessToken, clientId) {
    const all = [];
    const limit = 40;
    const maxPages = 2; // 继续观看通常就十几条，查2页足够了

    for (let p = 1; p <= maxPages; p++) {
        const url = `${TRAKT_API_BASE}/sync/playback/${kind}?extended=full&page=${p}&limit=${limit}&_t=${Date.now()}`;
        const res = await Widget.http.get(url, {
            headers: {
                "Content-Type": "application/json",
                "trakt-api-version": "2",
                "trakt-api-key": clientId,
                "Authorization": `Bearer ${accessToken}`,
                "Cache-Control": "no-cache"
            }
        });
        const rows = Array.isArray(res?.data) ? res.data : [];
        if (!rows.length) break;
        all.push(...rows);
        if (rows.length < limit) break;
    }
    return all;
}

// 构建卡片UI
async function buildPlaybackItem(item, index) {
    const progress = normalizeProgress(item?.progress);
    const pausedAt = formatDateTime(item?.paused_at);

    // === 处理电影 ===
    if (item?.movie) {
        const tmdbId = item.movie?.ids?.tmdb;
        let d = null;
        if (tmdbId) d = await fetchTmdbCache(`/movie/${tmdbId}`);

        return {
            id: `movie.${tmdbId || item.id}`,
            tmdbId: tmdbId,
            type: "tmdb",
            mediaType: "movie",
            title: d?.title || item.movie.title,
            genreTitle: "电影 · 恢复播放",
            subTitle: `已播放 ${progress}% · 暂停于 ${pausedAt}`,
            releaseDate: d?.release_date || "",
            durationText: `▶ ${progress}%`,
            description: `暂停时间：${pausedAt}\n${d?.overview || "暂无简介"}`,
            posterPath: d?.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : "",
            action: tmdbId ? { type: "route", route: "detail", args: { id: tmdbId, type: "movie" } } : undefined
        };
    }

    // === 处理剧集 ===
    if (item?.episode) {
        const show = item.show;
        const ep = item.episode;
        const tmdbId = show?.ids?.tmdb;
        const season = Number(ep?.season || 0);
        const episode = Number(ep?.number || 0);
        const se = `S${pad2(season)}E${pad2(episode)}`;

        let d = null;
        if (tmdbId) d = await fetchTmdbCache(`/tv/${tmdbId}`);

        const episodeTitle = ep.title || `第 ${episode} 集`;

        return {
            id: `tv.${tmdbId || item.id}`,
            tmdbId: tmdbId,
            type: "tmdb",
            mediaType: "tv",
            season: season,
            episode: episode,
            title: d?.name || show.title,
            genreTitle: "剧集 · 恢复播放",
            subTitle: `${se} ${episodeTitle} · 播放至 ${progress}%`,
            releaseDate: d?.first_air_date || "",
            durationText: `▶ ${progress}%`,
            description: `目标集数：${se}\n暂停时间：${pausedAt}\n${d?.overview || "暂无简介"}`,
            posterPath: d?.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : "",
            
            // 彻底解决不跳转集数的问题：强行传 action 路由
            action: tmdbId ? {
                type: "route",
                route: "detail",
                args: { id: tmdbId, type: "tv", season: season, episode: episode }
            } : undefined
        };
    }
    return null;
}

// ==========================================
// 工具与并发控制 (复用你的优秀逻辑)
// ==========================================
async function mapWithConcurrency(items, concurrency, worker) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const results = new Array(list.length);
    let cursor = 0;
    const runnerCount = Math.min(concurrency || 1, list.length);

    const runners = new Array(runnerCount).fill(0).map(async () => {
        while (true) {
            const index = cursor++;
            if (index >= list.length) return;
            try { results[index] = await worker(list[index], index); } catch (e) { results[index] = null; }
        }
    });
    await Promise.all(runners);
    return results;
}

async function fetchTmdbCache(path) {
    if (tmdbCache.has(path)) return tmdbCache.get(path);
    try {
        const promise = Widget.tmdb.get(path, { params: { language: "zh-CN" } });
        tmdbCache.set(path, promise);
        const data = await promise;
        return data || null;
    } catch (e) { return null; }
}

function normalizeProgress(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n.toFixed(0)) : String(n.toFixed(1));
}

function pad2(n) { return Number(n) < 10 ? "0" + n : String(n); }
function formatDateTime(val) {
    if (!val) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth()+1}-${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ==========================================
// OAuth 认证流 (完全沿用，不可省略)
// ==========================================
async function manageTraktOAuth(params = {}) {
    const { oauthAction = "status", oauthClientId, oauthClientSecret, oauthRedirectUri = "urn:ietf:wg:oauth:2.0:oob" } = params;
    if (!Widget.storage) return [{ id: "err", type: "text", title: "当前版本不支持存储" }];
    
    if (oauthAction === "logout") {
        Widget.storage.remove(STORAGE_TOKEN_KEY); Widget.storage.remove(STORAGE_DEVICE_KEY);
        return [{ id: "out", type: "text", title: "已退出登录" }];
    }
    if (!oauthClientId || !oauthClientSecret) return [{ id: "miss", type: "text", title: "请先填写 Client ID 和 Secret" }];

    if (oauthAction === "start") {
        try {
            const res = await Widget.http.post(`${TRAKT_API_BASE}/oauth/device/code`, { client_id: oauthClientId }, { headers: { "Content-Type": "application/json" }});
            Widget.storage.set(STORAGE_DEVICE_KEY, JSON.stringify(res.data));
            return [{ id: "code", type: "text", title: `登录码：${res.data.user_code}`, description: `1. 打开: ${res.data.verification_url}\n2. 输入登录码授权\n3. 返回组件点击"检查授权"` }];
        } catch(e) { return [{ id: "err", type: "text", title: "获取登录码失败" }]; }
    }

    if (oauthAction === "complete") {
        const device = JSON.parse(Widget.storage.get(STORAGE_DEVICE_KEY) || "{}");
        if (!device.device_code) return [{ id: "err", type: "text", title: "请先生成登录码" }];
        try {
            const res = await Widget.http.post(`${TRAKT_API_BASE}/oauth/device/token`, { code: device.device_code, client_id: oauthClientId, client_secret: oauthClientSecret }, { headers: { "Content-Type": "application/json" }});
            Widget.storage.set(STORAGE_TOKEN_KEY, JSON.stringify({...res.data, created_at: Math.floor(Date.now() / 1000)}));
            Widget.storage.remove(STORAGE_DEVICE_KEY);
            return [{ id: "ok", type: "text", title: "登录成功！", description: "现在可以打开「继续观看」了" }];
        } catch(e) { return [{ id: "wait", type: "text", title: "等待授权中...", description: "请确保在网页上已点击同意" }]; }
    }
    
    const token = JSON.parse(Widget.storage.get(STORAGE_TOKEN_KEY) || "{}");
    if(token.access_token) return [{ id: "ok", type: "text", title: "Trakt 已登录" }];
    return [{ id: "no", type: "text", title: "未登录，请开始生成登录码" }];
}

async function ensureOAuthToken(clientId, clientSecret, redirectUri) {
    let token = JSON.parse(Widget.storage.get(STORAGE_TOKEN_KEY) || "{}");
    if (!token.access_token) throw new Error("未登录");
    const now = Math.floor(Date.now() / 1000);
    if (token.refresh_token && now >= (token.created_at + token.expires_in - 86400)) {
        const res = await Widget.http.post(`${TRAKT_AUTH_BASE}/oauth/token`, { refresh_token: token.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", redirect_uri: redirectUri }, { headers: { "Content-Type": "application/json" }});
        token = {...res.data, created_at: now};
        Widget.storage.set(STORAGE_TOKEN_KEY, JSON.stringify(token));
    }
    return token.access_token;
}
