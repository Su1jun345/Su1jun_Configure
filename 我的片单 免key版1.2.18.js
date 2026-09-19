/*
 * CapyPlayer Widget - 继续追剧
 * v1.2.18
 *
 * - 开始观看 / 继续观看按实际 watchedCount 归类
 * - 修复恢复未观看后仍被 watched 条目占用的问题
 * - 保留稳定 TMDB zh-CN 标题 / 海报
 * - 保留 Trakt 优先下一集判断
 * - 保留预告 / 倒计时 / 完结提示
 */

WidgetMetadata = {
    id: "trakt_continue_username",
    title: "Trakt 最近电视剧 免Key版",
    author: "Blue",
    description: "同步 Trakt 观看记录与追更片单，自动区分继续观看和开始观看。",
    version: "1.2.18",
    requiredVersion: "0.0.1",
    globalParams: [
        { name: "traktUser", title: "Trakt 用户名", type: "input", value: "" }
    ],
    modules: [
        {
            title: "继续观看",
            functionName: "loadContinueWatching",
            type: "list",
            cacheDuration: 300,
            params: [
                { name: "page", title: "页码", type: "page" },
                {
                    name: "pageSize",
                    title: "每页数量",
                    type: "enumeration",
                    value: "15",
                    enumOptions: [
                        { title: "10", value: "10" },
                        { title: "15", value: "15" },
                        { title: "20", value: "20" }
                    ]
                }
            ]
        },
        {
            title: "开始观看",
            functionName: "loadStartWatching",
            type: "list",
            cacheDuration: 300,
            params: [
                { name: "page", title: "页码", type: "page" },
                {
                    name: "pageSize",
                    title: "每页数量",
                    type: "enumeration",
                    value: "15",
                    enumOptions: [
                        { title: "10", value: "10" },
                        { title: "15", value: "15" },
                        { title: "20", value: "20" }
                    ]
                }
            ]
        }
    ]
};

const INTERNAL_CLIENT_ID =
    "95b59922670c84040db3632c7aac6f33704f6ffe5cbf3113a056e37cb45cb482";

const TRAKT_BASE = "https://api.trakt.tv";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const MAX_WATCHED_FETCH = 100;
const MAX_WATCHLIST_FETCH = 100;
const MAX_DEEP_CHECK = 20;
const MAX_CONCURRENCY = 5;
const EXTRA_REQUEST_TIMEOUT = 4000;

const tmdbShowCache = new Map();
const tmdbSeasonCache = new Map();
const traktRatingCache = new Map();
const traktSeasonCache = new Map();
const traktNextEpisodeCache = new Map();

/* ==================== 继续观看 ==================== */

async function loadContinueWatching(params = {}) {
    const user = getUser(params);
    const { page, pageSize } = getPaging(params);

    if (!user) {
        return textItem("err-no-user", "请在设置中填写 Trakt 用户名");
    }

    try {
        const watched = await fetchWatchedShows(user);

        if (!watched.length) {
            return textItem(
                "empty",
                "没有读取到观看记录",
                "请检查 Trakt 用户名以及账号隐私设置"
            );
        }

        watched.sort(
            (a, b) =>
                safeTime(b?.last_watched_at) -
                safeTime(a?.last_watched_at)
        );

        const candidates = watched
            .map(item => ({
                item,
                stats: getWatchStats(item)
            }))
            .filter(({ stats }) => stats.count > 0)
            .slice(0, MAX_DEEP_CHECK);

        const checked = await mapWithConcurrency(
            candidates,
            MAX_CONCURRENCY,
            async ({ item, stats }) => {
                try {
                    return await buildContinueItem(item, stats);
                } catch (e) {
                    return null;
                }
            }
        );

        return await finalizePage(
            checked.filter(Boolean),
            page,
            pageSize,
            "continue"
        );

    } catch (e) {
        return loadError(e);
    }
}

/* ==================== 开始观看 ==================== */

async function loadStartWatching(params = {}) {
    const user = getUser(params);
    const { page, pageSize } = getPaging(params);

    if (!user) {
        return textItem("err-no-user", "请在设置中填写 Trakt 用户名");
    }

    try {
        const [watchlist, watched] = await Promise.all([
            fetchWatchlistShows(user),
            fetchWatchedShows(user)
        ]);

        if (!watchlist.length) {
            return page === 1
                ? textItem(
                    "empty-start",
                    "暂无开始观看的剧集",
                    "Trakt 追更片单中暂无可开始观看的剧集"
                )
                : [];
        }

        /*
         * v1.2.18：
         * 不再只判断剧是否存在 watched/shows。
         *
         * 必须实际计算 plays > 0 的集数。
         * count > 0 才算真正看过。
         */
        const watchedCountMap = new Map();

        for (const item of watched) {
            const key = getShowKey(item?.show);

            if (!key) continue;

            watchedCountMap.set(
                key,
                getWatchStats(item).count
            );
        }

        watchlist.sort(
            (a, b) =>
                safeTime(b?.listed_at) -
                safeTime(a?.listed_at)
        );

        const candidates = watchlist
            .filter(item => {
                const show = item?.show || {};
                const key = getShowKey(show);

                if (!key) {
                    return false;
                }

                /*
                 * 只有实际已看集数 > 0，
                 * 才从“开始观看”排除。
                 *
                 * watched/shows 即使仍残留该剧，
                 * 只要 count === 0，
                 * 仍允许回到开始观看。
                 */
                const watchedCount =
                    Number(
                        watchedCountMap.get(key) || 0
                    );

                if (watchedCount > 0) {
                    return false;
                }

                const aired =
                    Number(
                        show?.aired_episodes || 0
                    );

                return (
                    aired !== 0 ||
                    show?.aired_episodes == null
                );
            })
            .slice(0, MAX_DEEP_CHECK);

        const checked = await mapWithConcurrency(
            candidates,
            MAX_CONCURRENCY,
            async item => {
                try {
                    return await buildStartItem(item);
                } catch (e) {
                    return null;
                }
            }
        );

        return await finalizePage(
            checked.filter(Boolean),
            page,
            pageSize,
            "start"
        );

    } catch (e) {
        return loadError(e);
    }
}

/* ==================== 分页 ==================== */

async function finalizePage(items, page, pageSize, mode) {
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(
        start,
        start + pageSize
    );

    if (!pageItems.length) {
        if (page !== 1) return [];

        return mode === "start"
            ? textItem(
                "empty-start",
                "暂无开始观看的剧集",
                "已追更但一集未看的剧会显示在这里"
            )
            : textItem(
                "empty-progress",
                "暂无可继续观看的新集",
                "已追到当前最新集，新集播出后会重新显示"
            );
    }

    const output = await mapWithConcurrency(
        pageItems,
        MAX_CONCURRENCY,
        async data => {
            try {
                return await finalizeMediaItem(data);
            } catch (e) {
                return data?.media || null;
            }
        }
    );

    return output.filter(Boolean);
}

/* ==================== 继续观看卡片 ==================== */

async function buildContinueItem(item, stats) {
    const show = item?.show || {};
    const tmdbId =
        Number(show?.ids?.tmdb || 0) || null;

    const {
        count: watchedCount,
        last
    } = stats;

    if (!last) return null;

    const {
        tmdbShow,
        tmdbFailed
    } = await loadTmdbShow(tmdbId);

    const aired =
        getAiredEpisodeCount(
            show,
            tmdbShow
        );

    const result =
        await inferNextEpisode(
            last,
            tmdbId,
            tmdbShow,
            show,
            aired,
            tmdbFailed
        );

    if (result.status !== "next") {
        return null;
    }

    const season =
        Number(
            result.next.season || 0
        );

    const episode =
        Number(
            result.next.episode || 0
        );

    const meta =
        makeShowMeta(
            show,
            tmdbShow
        );

    const pct =
        aired > 0
            ? Math.min(
                100,
                Math.max(
                    0,
                    watchedCount /
                    aired *
                    100
                )
            )
            : 0;

    const progress =
        aired > 0
            ? `${formatPercent(pct)}%（${watchedCount}/${aired} 集）`
            : `${watchedCount} 集`;

    const media =
        makeMedia({
            show,
            tmdbId,
            tmdbShow,
            title: meta.title,
            year: meta.year,
            season,
            episode,
            lines: [
                `🔶 继续观看 · ${formatSE(season, episode)} · 第${episode}集`,
                `🔷 观看进度 · ${progress}`
            ]
        });

    return {
        media,
        show,
        tmdbShow,
        tmdbId
    };
}

/* ==================== 开始观看卡片 ==================== */

async function buildStartItem(item) {
    const show = item?.show || {};

    const tmdbId =
        Number(
            show?.ids?.tmdb || 0
        ) || null;

    const { tmdbShow } =
        await loadTmdbShow(
            tmdbId
        );

    const playable =
        await findFirstPlayableEpisode(
            show,
            tmdbId,
            tmdbShow
        );

    if (!playable) return null;

    const season =
        playable.season;

    const episode =
        playable.episode;

    const aired =
        getAiredEpisodeCount(
            show,
            tmdbShow
        );

    const meta =
        makeShowMeta(
            show,
            tmdbShow
        );

    const media =
        makeMedia({
            show,
            tmdbId,
            tmdbShow,
            title: meta.title,
            year: meta.year,
            season,
            episode,
            lines: [
                `🟢 开始观看 · ${formatSE(season, episode)} · 第${episode}集`,
                aired > 0
                    ? `🔷 已播集数 · ${aired}集`
                    : "🔷 已有剧集可观看"
            ]
        });

    return {
        media,
        show,
        tmdbShow,
        tmdbId
    };
}

/* ==================== 第一集 ==================== */

async function findFirstPlayableEpisode(
    show,
    tmdbId,
    tmdbShow
) {
    const traktSeason =
        await fetchTraktSeasonEpisodes(
            show,
            1
        );

    const traktEp1 =
        traktSeason.find(
            ep =>
                Number(
                    ep?.number || 0
                ) === 1
                &&
                isTraktEpisodeAired(ep)
        );

    if (traktEp1) {
        return {
            season: 1,
            episode: 1
        };
    }

    if (tmdbId) {
        try {
            const season =
                await fetchTmdbSeason(
                    tmdbId,
                    1
                );

            const ep1 =
                Array.isArray(
                    season?.episodes
                )
                    ? season.episodes.find(
                        ep =>
                            Number(
                                ep?.episode_number
                            ) === 1
                            &&
                            hasAired(
                                ep?.air_date
                            )
                    )
                    : null;

            if (ep1) {
                return {
                    season: 1,
                    episode: 1
                };
            }

        } catch (e) {}
    }

    const aired =
        Number(
            show?.aired_episodes ||
            tmdbShow?.number_of_episodes ||
            0
        );

    if (
        aired > 0 &&
        tmdbShow?.first_air_date &&
        hasAired(
            tmdbShow.first_air_date
        )
    ) {
        return {
            season: 1,
            episode: 1
        };
    }

    return null;
}

/* ==================== 标题 ==================== */

function makeShowMeta(
    show,
    tmdbShow
) {
    return {
        title:
            tmdbShow?.name ||
            show?.title ||
            tmdbShow?.original_name ||
            "未知剧集",

        year:
            String(
                show?.year ||
                String(
                    tmdbShow?.first_air_date || ""
                ).slice(
                    0,
                    4
                ) ||
                ""
            )
    };
}

/* ==================== 卡片 ==================== */

function makeMedia({
    show,
    tmdbId,
    tmdbShow,
    title,
    year,
    season,
    episode,
    lines
}) {
    const media = {
        id:
            String(
                tmdbId ||
                show?.ids?.trakt ||
                title
            ),

        type: "tmdb",
        mediaType: "tv",

        /*
         * 主标题保持纯剧名，
         * 避免影响弹幕搜索。
         */
        title,

        year,

        description:
            lines.join("\n"),

        currentSeason:
            season,

        currentEpisode:
            episode,

        currentEpisodeName:
            `第${episode}集`
    };

    const rating =
        normalizeRating(
            tmdbShow?.vote_average
        );

    if (rating > 0) {
        media.rating =
            rating;
    }

    if (tmdbId) {
        media.tmdbId =
            tmdbId;
    }

    if (
        tmdbShow?.poster_path
    ) {
        media.posterPath =
            TMDB_IMG +
            tmdbShow.poster_path;
    }

    return media;
}

/* ==================== Rating / Preview / 完结 ==================== */

async function finalizeMediaItem(data) {
    const {
        media,
        show,
        tmdbShow,
        tmdbId
    } = data || {};

    if (!media) return null;

    const season =
        Number(
            media.currentSeason || 0
        );

    const episode =
        Number(
            media.currentEpisode || 0
        );

    const [
        rating,
        preview,
        seasonData
    ] = await Promise.all([
        withSoftTimeout(
            fetchTraktShowRating(show),
            EXTRA_REQUEST_TIMEOUT
        ),

        withSoftTimeout(
            resolveTraktSeasonPreview(
                show,
                season,
                episode
            ),
            EXTRA_REQUEST_TIMEOUT
        ),

        tmdbId
            ? withSoftTimeout(
                fetchTmdbSeason(
                    tmdbId,
                    season
                ),
                EXTRA_REQUEST_TIMEOUT
            )
            : Promise.resolve(null)
    ]);

    if (
        Number(rating) > 0
    ) {
        media.rating =
            Number(rating);
    }

    const previewText =
        buildPreviewText(
            preview
        );

    if (previewText) {
        media.description +=
            "\n" +
            previewText;

        return media;
    }

    const completionText =
        buildCompletionText({
            tmdbShow,
            seasonData,
            currentSeason:
                season
        });

    if (completionText) {
        media.description +=
            "\n" +
            completionText;
    }

    return media;
}

/* ==================== 完结判断 ==================== */

function buildCompletionText({
    tmdbShow,
    seasonData,
    currentSeason
}) {
    if (!tmdbShow) {
        return "";
    }

    if (
        hasKnownFutureEpisode(
            tmdbShow
        )
    ) {
        return "";
    }

    const status =
        String(
            tmdbShow?.status || ""
        )
            .trim()
            .toLowerCase();

    const ended =
        status === "ended" ||
        status === "canceled" ||
        status === "cancelled";

    const lastAired =
        tmdbShow?.last_episode_to_air;

    const fullEnded =
        ended &&
        tmdbShow?.in_production !== true &&
        !!lastAired &&
        hasAired(
            lastAired?.air_date
        );

    if (fullEnded) {
        const total =
            Number(
                tmdbShow?.number_of_episodes ||
                0
            );

        return total > 0
            ? `🏁 全剧已完结 · 共${total}集`
            : "🏁 全剧已完结";
    }

    if (
        !seasonData ||
        currentSeason <= 0
    ) {
        return "";
    }

    const episodes =
        Array.isArray(
            seasonData?.episodes
        )
            ? seasonData.episodes.filter(
                ep =>
                    Number(
                        ep?.episode_number ||
                        0
                    ) > 0
            )
            : [];

    if (!episodes.length) {
        return "";
    }

    const seasonInfo =
        Array.isArray(
            tmdbShow?.seasons
        )
            ? tmdbShow.seasons.find(
                s =>
                    Number(
                        s?.season_number ||
                        0
                    ) === currentSeason
            )
            : null;

    const declared =
        Number(
            seasonInfo?.episode_count ||
            0
        );

    if (
        declared > 0 &&
        episodes.length < declared
    ) {
        return "";
    }

    const allAired =
        episodes.every(
            ep =>
                !!ep?.air_date &&
                hasAired(
                    ep.air_date
                )
        );

    if (!allAired) {
        return "";
    }

    const count =
        declared ||
        episodes.length;

    return count > 0
        ? `⏸️ 本季已完结 · 共${count}集`
        : "⏸️ 本季已完结";
}

function hasKnownFutureEpisode(
    tmdbShow
) {
    const next =
        tmdbShow?.next_episode_to_air;

    if (
        next?.air_date &&
        !hasAired(
            next.air_date
        )
    ) {
        return true;
    }

    const today =
        getDisplayDate(
            new Date()
        );

    return (
        Array.isArray(
            tmdbShow?.seasons
        )
        &&
        tmdbShow.seasons.some(
            season => {
                const no =
                    Number(
                        season?.season_number ||
                        0
                    );

                if (no <= 0) {
                    return false;
                }

                const day =
                    season?.air_date
                        ? getDisplayDate(
                            season.air_date
                        )
                        : "";

                return (
                    !!day &&
                    day > today
                );
            }
        )
    );
}

/* ==================== Trakt Preview ==================== */

async function resolveTraktSeasonPreview(
    show,
    currentSeason,
    currentEpisode
) {
    const episodes =
        await fetchTraktSeasonEpisodes(
            show,
            currentSeason
        );

    const preview =
        findNearestFutureBatch(
            episodes,
            currentSeason,
            currentEpisode
        );

    if (preview) {
        return preview;
    }

    const next =
        await fetchTraktNextEpisodePreview(
            show
        );

    if (!next) {
        return null;
    }

    const nextSeason =
        Number(
            next.season || 0
        );

    const nextEpisode =
        Number(
            next.number || 0
        );

    if (
        nextSeason <= 0 ||
        nextEpisode <= 0
    ) {
        return null;
    }

    const fallback = {
        season:
            nextSeason,

        episodes:
            [nextEpisode],

        firstAired:
            next.first_aired ||
            null,

        displayDay:
            getDisplayDate(
                next.first_aired
            )
    };

    if (
        nextSeason ===
        currentSeason
    ) {
        return fallback;
    }

    const nextEpisodes =
        await fetchTraktSeasonEpisodes(
            show,
            nextSeason
        );

    return (
        findNearestFutureBatch(
            nextEpisodes,
            nextSeason,
            0
        )
        ||
        fallback
    );
}

function findNearestFutureBatch(
    episodes,
    season,
    afterEpisode
) {
    if (
        !Array.isArray(
            episodes
        )
        ||
        !episodes.length
    ) {
        return null;
    }

    const today =
        getDisplayDate(
            new Date()
        );

    const future =
        episodes
            .map(ep => {
                const firstAired =
                    ep?.first_aired ||
                    ep?.effective_release_date ||
                    null;

                return {
                    season:
                        Number(
                            ep?.season ||
                            season ||
                            0
                        ),

                    episode:
                        Number(
                            ep?.number ||
                            0
                        ),

                    firstAired,

                    displayDay:
                        getDisplayDate(
                            firstAired
                        )
                };
            })
            .filter(ep =>
                ep.season > 0 &&
                ep.episode > 0 &&
                ep.displayDay &&
                !(
                    ep.season ===
                        season
                    &&
                    ep.episode <=
                        afterEpisode
                )
                &&
                ep.displayDay >=
                    today
            );

    if (!future.length) {
        return null;
    }

    future.sort(
        (a, b) =>
            (
                a.displayDay <
                b.displayDay
                    ? -1
                    : a.displayDay >
                      b.displayDay
                        ? 1
                        : 0
            )
            ||
            a.season -
                b.season
            ||
            a.episode -
                b.episode
    );

    const first =
        future[0];

    const numbers =
        uniqueNumbers(
            future
                .filter(ep =>
                    ep.displayDay ===
                        first.displayDay
                    &&
                    ep.season ===
                        first.season
                )
                .map(
                    ep =>
                        ep.episode
                )
        );

    if (!numbers.length) {
        return null;
    }

    return {
        season:
            first.season,

        episodes:
            numbers,

        firstAired:
            first.firstAired,

        displayDay:
            first.displayDay
    };
}

function buildPreviewText(
    preview
) {
    if (!preview) {
        return "";
    }

    const range =
        formatSeasonEpisodeRange(
            Number(
                preview.season ||
                0
            ),
            preview.episodes ||
            []
        );

    if (!range) {
        return "";
    }

    const day =
        preview.displayDay ||
        getDisplayDate(
            preview.firstAired
        );

    if (!day) {
        return `📆 ${range}`;
    }

    const remaining =
        getRemainingText(
            day
        );

    if (
        remaining ===
        "今天播出"
    ) {
        return (
            `📆 ${range}` +
            ` · ${day.slice(5)}` +
            ` · 今天播出`
        );
    }

    return (
        `📆 ${range}` +
        ` · ${day.slice(5)} 播出` +
        (
            remaining
                ? ` · ${remaining}`
                : ""
        )
    );
}

function formatSeasonEpisodeRange(
    season,
    episodes
) {
    const list =
        uniqueNumbers(
            episodes
        );

    if (
        season <= 0 ||
        !list.length
    ) {
        return "";
    }

    const prefix =
        `S${pad2(season)}`;

    if (
        list.length === 1
    ) {
        return (
            `${prefix}` +
            `E${pad2(list[0])}`
        );
    }

    const continuous =
        list.every(
            (n, i) =>
                i === 0 ||
                n ===
                    list[i - 1] +
                    1
        );

    return continuous
        ? (
            `${prefix}E${pad2(list[0])}` +
            `-E${pad2(list[list.length - 1])}`
        )
        : (
            prefix +
            list
                .map(
                    n =>
                        `E${pad2(n)}`
                )
                .join(",")
        );
}

/* ==================== 日期 ==================== */

function getDisplayDate(
    value
) {
    if (!value) {
        return "";
    }

    if (
        typeof value ===
        "string"
    ) {
        const match =
            value
                .trim()
                .match(
                    /^(\d{4}-\d{2}-\d{2})$/
                );

        if (match) {
            return match[1];
        }
    }

    const date =
        value instanceof Date
            ? value
            : new Date(
                value
            );

    if (
        isNaN(
            date.getTime()
        )
    ) {
        return "";
    }

    try {
        const parts =
            new Intl.DateTimeFormat(
                "en-CA",
                {
                    timeZone:
                        "Asia/Shanghai",
                    year:
                        "numeric",
                    month:
                        "2-digit",
                    day:
                        "2-digit"
                }
            ).formatToParts(
                date
            );

        const map = {};

        for (
            const part
            of parts
        ) {
            map[
                part.type
            ] = part.value;
        }

        if (
            map.year &&
            map.month &&
            map.day
        ) {
            return (
                `${map.year}-` +
                `${map.month}-` +
                `${map.day}`
            );
        }

    } catch (e) {}

    const shifted =
        new Date(
            date.getTime() +
            8 *
            3600000
        );

    return (
        `${shifted.getUTCFullYear()}-` +
        `${pad2(shifted.getUTCMonth() + 1)}-` +
        `${pad2(shifted.getUTCDate())}`
    );
}

function getRemainingText(
    targetDay
) {
    const today =
        getDisplayDate(
            new Date()
        );

    const target =
        dayNumber(
            targetDay
        );

    const current =
        dayNumber(
            today
        );

    if (
        !Number.isFinite(
            target
        )
        ||
        !Number.isFinite(
            current
        )
    ) {
        return "";
    }

    const diff =
        target -
        current;

    if (diff === 0) {
        return "今天播出";
    }

    if (diff > 0) {
        return `还有${diff}天`;
    }

    return "";
}

function dayNumber(
    day
) {
    const match =
        /^(\d{4})-(\d{2})-(\d{2})$/
            .exec(
                day || ""
            );

    if (!match) {
        return NaN;
    }

    return (
        Date.UTC(
            Number(
                match[1]
            ),
            Number(
                match[2]
            ) - 1,
            Number(
                match[3]
            )
        )
        /
        86400000
    );
}

/* ==================== Trakt ==================== */

async function fetchWatchedShows(
    user
) {
    const data =
        await traktRequest(
            `/users/${encodeURIComponent(user)}/watched/shows` +
            `?extended=progress&page=1&limit=${MAX_WATCHED_FETCH}`,
            true
        );

    return Array.isArray(
        data
    )
        ? data
        : [];
}

async function fetchWatchlistShows(
    user
) {
    const data =
        await traktRequest(
            `/users/${encodeURIComponent(user)}/watchlist/shows` +
            `?extended=full&page=1&limit=${MAX_WATCHLIST_FETCH}`,
            true
        );

    return Array.isArray(
        data
    )
        ? data
        : [];
}

async function fetchTraktShowRating(
    show
) {
    const id =
        getTraktShowId(
            show
        );

    if (!id) {
        return 0;
    }

    const key =
        String(
            id
        );

    if (
        traktRatingCache.has(
            key
        )
    ) {
        return await traktRatingCache.get(
            key
        );
    }

    const promise =
        traktRequest(
            `/shows/${encodeURIComponent(id)}/ratings`
        );

    traktRatingCache.set(
        key,
        promise
    );

    try {
        const data =
            await promise;

        const rating =
            normalizeRating(
                data?.rating
            );

        traktRatingCache.set(
            key,
            rating
        );

        return rating;

    } catch (e) {
        traktRatingCache.delete(
            key
        );

        return 0;
    }
}

async function fetchTraktSeasonEpisodes(
    show,
    season
) {
    const id =
        getTraktShowId(
            show
        );

    if (
        !id ||
        season <= 0
    ) {
        return [];
    }

    const key =
        `${id}:${season}`;

    if (
        traktSeasonCache.has(
            key
        )
    ) {
        return await traktSeasonCache.get(
            key
        );
    }

    const promise =
        traktRequest(
            `/shows/${encodeURIComponent(id)}` +
            `/seasons/${season}?extended=full`
        );

    traktSeasonCache.set(
        key,
        promise
    );

    try {
        const data =
            await promise;

        const episodes =
            Array.isArray(
                data
            )
                ? data
                : Array.isArray(
                    data?.episodes
                )
                    ? data.episodes
                    : [];

        traktSeasonCache.set(
            key,
            episodes
        );

        return episodes;

    } catch (e) {
        traktSeasonCache.delete(
            key
        );

        return [];
    }
}

async function fetchTraktNextEpisodePreview(
    show
) {
    const id =
        getTraktShowId(
            show
        );

    if (!id) {
        return null;
    }

    const key =
        String(
            id
        );

    if (
        traktNextEpisodeCache.has(
            key
        )
    ) {
        return await traktNextEpisodeCache.get(
            key
        );
    }

    const promise =
        traktRequest(
            `/shows/${encodeURIComponent(id)}` +
            `/next_episode?extended=full`
        );

    traktNextEpisodeCache.set(
        key,
        promise
    );

    try {
        const data =
            await promise;

        const season =
            Number(
                data?.season ||
                0
            );

        const number =
            Number(
                data?.number ||
                0
            );

        const result =
            season > 0 &&
            number > 0
                ? {
                    season,
                    number,
                    first_aired:
                        data?.first_aired ||
                        data?.effective_release_date ||
                        null
                }
                : null;

        traktNextEpisodeCache.set(
            key,
            result
        );

        return result;

    } catch (e) {
        traktNextEpisodeCache.delete(
            key
        );

        return null;
    }
}

function getTraktShowId(
    show
) {
    return (
        show?.ids?.slug ||
        show?.ids?.trakt ||
        ""
    );
}

function getShowKey(
    show
) {
    if (
        show?.ids?.trakt
    ) {
        return (
            `trakt:` +
            show.ids.trakt
        );
    }

    if (
        show?.ids?.tmdb
    ) {
        return (
            `tmdb:` +
            show.ids.tmdb
        );
    }

    if (
        show?.ids?.imdb
    ) {
        return (
            `imdb:` +
            show.ids.imdb
        );
    }

    if (
        show?.ids?.slug
    ) {
        return (
            `slug:` +
            show.ids.slug
        );
    }

    return "";
}

async function traktRequest(
    path,
    strict = false
) {
    const res =
        await Widget.http.get(
            TRAKT_BASE +
            path,
            {
                headers:
                    getTraktHeaders()
            }
        );

    if (!res) {
        if (strict) {
            throw new Error(
                "Trakt 返回为空"
            );
        }

        return null;
    }

    if (
        res.ok === false
    ) {
        if (strict) {
            throw new Error(
                "Trakt HTTP " +
                String(
                    res.status ||
                    "unknown"
                )
            );
        }

        return null;
    }

    let data =
        Array.isArray(
            res
        )
            ? res
            : res?.data !== undefined
                ? res.data
                : res;

    if (
        typeof data ===
        "string"
    ) {
        if (
            !data.trim()
        ) {
            return null;
        }

        try {
            data =
                JSON.parse(
                    data
                );

        } catch (e) {
            if (strict) {
                throw e;
            }

            return null;
        }
    }

    return data;
}

function getTraktHeaders() {
    return {
        "Content-Type":
            "application/json",

        "trakt-api-version":
            "2",

        "trakt-api-key":
            INTERNAL_CLIENT_ID
    };
}

/* ==================== 下一集：Trakt 优先 ==================== */

function nextResult(
    season,
    episode
) {
    return {
        status:
            "next",

        next: {
            season,
            episode
        }
    };
}

async function inferNextEpisode(
    last,
    tmdbId,
    tmdbShow,
    show,
    aired,
    tmdbFailed = false
) {
    if (!last) {
        return {
            status:
                "none"
        };
    }

    /*
     * 1. Trakt 当前季优先
     */
    try {
        const traktSeason =
            await fetchTraktSeasonEpisodes(
                show,
                last.season
            );

        const traktNext =
            traktSeason.find(
                ep =>
                    Number(
                        ep?.number ||
                        0
                    ) ===
                        last.episode +
                        1
                    &&
                    isTraktEpisodeAired(
                        ep
                    )
            );

        if (traktNext) {
            return nextResult(
                last.season,
                last.episode +
                1
            );
        }

    } catch (e) {}

    /*
     * 2. Trakt 下一季
     */
    try {
        const nextSeasonNo =
            last.season +
            1;

        const traktNextSeason =
            await fetchTraktSeasonEpisodes(
                show,
                nextSeasonNo
            );

        const ep1 =
            traktNextSeason.find(
                ep =>
                    Number(
                        ep?.number ||
                        0
                    ) === 1
                    &&
                    isTraktEpisodeAired(
                        ep
                    )
            );

        if (ep1) {
            return nextResult(
                nextSeasonNo,
                1
            );
        }

    } catch (e) {}

    /*
     * 3. TMDB / aired_episodes 兜底
     */
    const traktAired =
        Number(
            aired ||
            show?.aired_episodes ||
            0
        );

    const canFallback =
        last.season === 1 &&
        traktAired >
        last.episode;

    const fallback =
        () =>
            canFallback
                ? nextResult(
                    last.season,
                    last.episode +
                    1
                )
                : {
                    status:
                        "lookup_failed"
                };

    if (
        !tmdbId ||
        tmdbFailed
    ) {
        return fallback();
    }

    let seasonData;

    try {
        seasonData =
            await fetchTmdbSeason(
                tmdbId,
                last.season
            );

    } catch (e) {
        return fallback();
    }

    const episodes =
        Array.isArray(
            seasonData?.episodes
        )
            ? seasonData.episodes
            : [];

    const next =
        episodes.find(
            ep =>
                Number(
                    ep?.episode_number
                ) ===
                    last.episode +
                    1
                &&
                hasAired(
                    ep?.air_date
                )
        );

    if (next) {
        return nextResult(
            last.season,
            Number(
                next.episode_number
            )
        );
    }

    const latest =
        tmdbShow?.last_episode_to_air;

    if (
        latest &&
        Number(
            latest.season_number
        ) ===
            last.season
        &&
        Number(
            latest.episode_number
        ) >=
            last.episode +
            1
    ) {
        return nextResult(
            last.season,
            last.episode +
            1
        );
    }

    if (
        canFallback
    ) {
        return fallback();
    }

    const nextSeasonNo =
        last.season +
        1;

    const hasNextSeason =
        Array.isArray(
            tmdbShow?.seasons
        )
        &&
        tmdbShow.seasons.some(
            s =>
                Number(
                    s?.season_number ||
                    0
                ) ===
                    nextSeasonNo
                &&
                Number(
                    s?.episode_count ||
                    0
                ) > 0
        );

    if (
        !hasNextSeason
    ) {
        return {
            status:
                "none"
        };
    }

    try {
        const nextSeason =
            await fetchTmdbSeason(
                tmdbId,
                nextSeasonNo
            );

        const episode1 =
            Array.isArray(
                nextSeason?.episodes
            )
                ? nextSeason.episodes.find(
                    ep =>
                        Number(
                            ep?.episode_number
                        ) === 1
                        &&
                        hasAired(
                            ep?.air_date
                        )
                )
                : null;

        return episode1
            ? nextResult(
                nextSeasonNo,
                1
            )
            : {
                status:
                    "none"
            };

    } catch (e) {
        return {
            status:
                "lookup_failed"
        };
    }
}

/* ==================== TMDB ==================== */

async function loadTmdbShow(
    tmdbId
) {
    if (!tmdbId) {
        return {
            tmdbShow:
                null,

            tmdbFailed:
                false
        };
    }

    try {
        return {
            tmdbShow:
                await fetchTmdbShow(
                    tmdbId
                ),

            tmdbFailed:
                false
        };

    } catch (e) {
        return {
            tmdbShow:
                null,

            tmdbFailed:
                true
        };
    }
}

async function fetchTmdbShow(
    id
) {
    const key =
        String(
            id
        );

    if (
        tmdbShowCache.has(
            key
        )
    ) {
        return await tmdbShowCache.get(
            key
        );
    }

    const promise =
        Widget.tmdb.get(
            `/tv/${id}`,
            {
                params: {
                    language:
                        "zh-CN"
                }
            }
        );

    tmdbShowCache.set(
        key,
        promise
    );

    try {
        const response =
            await promise;

        const data =
            unpackResponse(
                response
            );

        if (
            !data ||
            typeof data !==
                "object"
        ) {
            throw new Error(
                "TMDB 详情返回为空"
            );
        }

        tmdbShowCache.set(
            key,
            data
        );

        return data;

    } catch (e) {
        tmdbShowCache.delete(
            key
        );

        throw e;
    }
}

async function fetchTmdbSeason(
    id,
    season
) {
    const key =
        `${id}:${season}`;

    if (
        tmdbSeasonCache.has(
            key
        )
    ) {
        return await tmdbSeasonCache.get(
            key
        );
    }

    const promise =
        Widget.tmdb.get(
            `/tv/${id}/season/${season}`,
            {
                params: {
                    language:
                        "zh-CN"
                }
            }
        );

    tmdbSeasonCache.set(
        key,
        promise
    );

    try {
        const response =
            await promise;

        const data =
            unpackResponse(
                response
            );

        if (
            !data ||
            typeof data !==
                "object"
        ) {
            throw new Error(
                "TMDB 季详情返回为空"
            );
        }

        tmdbSeasonCache.set(
            key,
            data
        );

        return data;

    } catch (e) {
        tmdbSeasonCache.delete(
            key
        );

        throw e;
    }
}

function unpackResponse(
    response
) {
    if (
        response == null
    ) {
        return null;
    }

    let data =
        response?.data !==
        undefined
            ? response.data
            : response;

    if (
        typeof data ===
        "string"
    ) {
        if (
            !data.trim()
        ) {
            return null;
        }

        try {
            data =
                JSON.parse(
                    data
                );

        } catch (e) {
            return null;
        }
    }

    return (
        data ||
        null
    );
}

/* ==================== Watched ==================== */

function getWatchStats(
    item
) {
    let count = 0;
    let last = null;

    const seasons =
        Array.isArray(
            item?.seasons
        )
            ? item.seasons
            : [];

    for (
        const season
        of seasons
    ) {
        const s =
            Number(
                season?.number ||
                0
            );

        if (s <= 0) {
            continue;
        }

        const episodes =
            Array.isArray(
                season?.episodes
            )
                ? season.episodes
                : [];

        for (
            const ep
            of episodes
        ) {
            if (
                Number(
                    ep?.plays ||
                    0
                ) <= 0
            ) {
                continue;
            }

            count++;

            const e =
                Number(
                    ep?.number ||
                    0
                );

            if (e <= 0) {
                continue;
            }

            if (
                !last ||
                s >
                    last.season
                ||
                (
                    s ===
                        last.season
                    &&
                    e >
                        last.episode
                )
            ) {
                last = {
                    season:
                        s,

                    episode:
                        e
                };
            }
        }
    }

    return {
        count,
        last
    };
}

function getAiredEpisodeCount(
    show,
    tmdbShow
) {
    const aired =
        Number(
            show?.aired_episodes ||
            0
        );

    return aired > 0
        ? aired
        : Number(
            tmdbShow?.number_of_episodes ||
            0
        );
}

/* ==================== Helpers ==================== */

function getUser(
    params
) {
    return String(
        params?.traktUser ||
        ""
    ).trim();
}

function getPaging(
    params
) {
    return {
        page:
            Math.max(
                1,
                parseInt(
                    params?.page ||
                    1,
                    10
                ) || 1
            ),

        pageSize:
            Math.max(
                1,
                parseInt(
                    params?.pageSize ||
                    15,
                    10
                ) || 15
            )
    };
}

function isTraktEpisodeAired(
    ep
) {
    const value =
        ep?.first_aired ||
        ep?.effective_release_date;

    if (!value) {
        return false;
    }

    if (
        typeof value ===
            "string"
        &&
        value.includes(
            "T"
        )
    ) {
        const time =
            new Date(
                value
            ).getTime();

        return (
            !isNaN(
                time
            )
            &&
            time <=
                Date.now()
        );
    }

    return hasAired(
        value
    );
}

function hasAired(
    value
) {
    if (!value) {
        return false;
    }

    const day =
        getDisplayDate(
            String(
                value
            ).slice(
                0,
                10
            )
        );

    const today =
        getDisplayDate(
            new Date()
        );

    return (
        !!day &&
        !!today &&
        day <= today
    );
}

async function mapWithConcurrency(
    items,
    concurrency,
    worker
) {
    const list =
        Array.isArray(
            items
        )
            ? items
            : [];

    if (!list.length) {
        return [];
    }

    const results =
        new Array(
            list.length
        );

    let cursor = 0;

    const count =
        Math.min(
            Math.max(
                1,
                concurrency ||
                1
            ),
            list.length
        );

    await Promise.all(
        Array.from(
            {
                length:
                    count
            },
            async () => {
                while (
                    cursor <
                    list.length
                ) {
                    const index =
                        cursor++;

                    try {
                        results[
                            index
                        ] =
                            await worker(
                                list[
                                    index
                                ],
                                index
                            );

                    } catch (e) {
                        results[
                            index
                        ] =
                            null;
                    }
                }
            }
        )
    );

    return results;
}

async function withSoftTimeout(
    promise,
    ms
) {
    let timer;

    try {
        return await Promise.race([
            promise,

            new Promise(
                resolve => {
                    timer =
                        setTimeout(
                            () =>
                                resolve(
                                    null
                                ),
                            ms
                        );
                }
            )
        ]);

    } catch (e) {
        return null;

    } finally {
        if (
            timer !==
            undefined
        ) {
            clearTimeout(
                timer
            );
        }
    }
}

function uniqueNumbers(
    values
) {
    return [
        ...new Set(
            (values || [])
                .map(
                    v =>
                        Number(
                            v ||
                            0
                        )
                )
                .filter(
                    n =>
                        n > 0
                )
        )
    ].sort(
        (a, b) =>
            a - b
    );
}

function normalizeRating(
    value
) {
    const n =
        Number(
            value ||
            0
        );

    return (
        Number.isFinite(
            n
        )
        &&
        n > 0
    )
        ? Math.round(
            n *
            10
        ) / 10
        : 0;
}

function safeTime(
    value
) {
    const time =
        new Date(
            value ||
            0
        ).getTime();

    return isNaN(
        time
    )
        ? 0
        : time;
}

function pad2(
    value
) {
    const n =
        Number(
            value ||
            0
        );

    return n < 10
        ? "0" +
            n
        : String(
            n
        );
}

function formatSE(
    season,
    episode
) {
    return (
        `S${pad2(season)}` +
        `E${pad2(episode)}`
    );
}

function formatPercent(
    value
) {
    const n =
        Math.round(
            Number(
                value ||
                0
            ) *
            10
        ) / 10;

    return Number.isInteger(
        n
    )
        ? String(
            n
        )
        : n.toFixed(
            1
        );
}

function textItem(
    id,
    title,
    description = ""
) {
    const item = {
        id,
        type:
            "text",
        title
    };

    if (description) {
        item.description =
            description;
    }

    return [
        item
    ];
}

function loadError(
    e
) {
    console.error(
        "加载失败:",
        e?.message ||
        String(e)
    );

    return textItem(
        "err-load",
        "读取 Trakt 失败",
        `${e?.message || String(e)}\n请稍后重试`
    );
}