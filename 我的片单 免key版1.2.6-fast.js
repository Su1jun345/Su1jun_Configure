/*
 * CapyPlayer Widget - 继续追剧 Fast
 * v1.2.6-fast
 *
 * 目标：
 * - 解决 loadContinueWatching 超过 30 秒超时
 * - 减少 TMDB / Trakt Rating 请求数量
 *
 * 保留：
 * - Trakt 观看记录
 * - 下一集判断
 * - 追平隐藏
 * - 新集重新出现
 * - Trakt aired_episodes 兜底
 * - Trakt 评分优先 -> TMDB 兜底
 * - 🔶 / 🔷
 * - 固定“第X集”
 */

WidgetMetadata = {
    id: "trakt_continue_username",
    title: "Trakt 最近电视剧 免Key版",
    author: "Blue",
    description:
        "同步 Trakt 观看记录，自动展示下一集，追平即隐藏，新集播出后自动出现。",
    version: "1.2.6-fast",
    requiredVersion: "0.0.1",

    globalParams: [
        {
            name: "Su1jun345",
            title: "Su1jun345",
            type: "input",
            value: ""
        }
    ],

    modules: [
        {
            title: "我的片单",
            functionName: "loadContinueWatching",
            type: "list",
            cacheDuration: 300,

            params: [
                {
                    name: "page",
                    title: "页码",
                    type: "page"
                },
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

const TRAKT_BASE =
    "https://api.trakt.tv";

const TMDB_IMG =
    "https://image.tmdb.org/t/p/w500";

/*
 * Fast 参数
 */
const MAX_WATCHED_FETCH =
    100;

const MAX_DEEP_CHECK =
    20;

const MAX_CONCURRENCY =
    5;


const tmdbShowCache =
    new Map();

const tmdbSeasonCache =
    new Map();

const traktRatingCache =
    new Map();


/*
 * ============================================================
 * 主入口
 * ============================================================
 */

async function loadContinueWatching(
    params = {}
) {

    const traktUser =
        String(
            params.traktUser || ""
        ).trim();


    const page =
        Math.max(
            1,
            parseInt(
                params.page || 1,
                10
            ) || 1
        );


    const pageSize =
        Math.max(
            1,
            parseInt(
                params.pageSize || 15,
                10
            ) || 15
        );


    if (!traktUser) {

        return [
            {
                id: "err-no-user",
                type: "text",
                title: "请在设置中填写 Trakt 用户名"
            }
        ];

    }


    try {

        /*
         * 只取最近 100 条
         */
        const watched =
            await fetchWatchedShows(
                traktUser
            );


        if (!watched.length) {

            return [
                {
                    id: "empty",
                    type: "text",
                    title: "没有读取到观看记录",
                    description:
                        "请检查 Trakt 用户名以及账号隐私设置"
                }
            ];

        }


        /*
         * 最近观看优先
         */
        watched.sort(
            (a, b) =>
                safeTime(
                    b?.last_watched_at
                )
                -
                safeTime(
                    a?.last_watched_at
                )
        );


        /*
         * 快速粗过滤
         */
        const roughCandidates =
            watched.filter(
                item => {

                    const watchedCount =
                        countWatchedEpisodes(
                            item
                        );


                    if (
                        watchedCount <= 0
                    ) {
                        return false;
                    }


                    const aired =
                        Number(
                            item?.show?.aired_episodes ||
                            0
                        );


                    if (
                        aired <= 0
                    ) {
                        return true;
                    }


                    return (
                        watchedCount <
                        aired
                    );

                }
            );


        /*
         * 只深查最近 20 部
         */
        const candidates =
            roughCandidates.slice(
                0,
                MAX_DEEP_CHECK
            );


        /*
         * 深查时先不查评分
         */
        const checked =
            await mapWithConcurrency(

                candidates,

                MAX_CONCURRENCY,

                async item => {

                    try {

                        return await buildMediaItemBase(
                            item
                        );

                    } catch (e) {

                        console.warn(
                            "构建条目失败:",
                            e?.message ||
                            String(e)
                        );

                        return null;

                    }

                }

            );


        const available =
            checked.filter(
                Boolean
            );


        /*
         * 先分页
         */
        const start =
            (page - 1) *
            pageSize;


        const pageItems =
            available.slice(
                start,
                start + pageSize
            );


        if (!pageItems.length) {

            return page === 1

                ? [
                    {
                        id: "empty-progress",
                        type: "text",
                        title: "暂无可继续观看的新集",
                        description:
                            "已追到当前最新集，新集播出后会重新显示"
                    }
                ]

                : [];

        }


        /*
         * 只给最终要显示的卡片查评分
         */
        const output =
            await mapWithConcurrency(

                pageItems,

                MAX_CONCURRENCY,

                async data => {

                    try {

                        return await finalizeMediaItem(
                            data
                        );

                    } catch (e) {

                        return data.media;

                    }

                }

            );


        return output.filter(
            Boolean
        );


    } catch (e) {

        console.error(
            "加载失败:",
            e?.message ||
            String(e)
        );


        return [
            {
                id: "err-load",
                type: "text",
                title: "读取 Trakt 失败",
                description:
                    (
                        e?.message ||
                        String(e)
                    )
                    +
                    "\n请稍后重试"
            }
        ];

    }

}


/*
 * ============================================================
 * Trakt watched
 * 只拉一页
 * ============================================================
 */

async function fetchWatchedShows(
    user
) {

    const url =
        `${TRAKT_BASE}/users/`
        +
        `${encodeURIComponent(user)}`
        +
        `/watched/shows`
        +
        `?extended=progress`
        +
        `&page=1`
        +
        `&limit=${MAX_WATCHED_FETCH}`;


    const res =
        await Widget.http.get(

            url,

            {
                headers: {

                    "Content-Type":
                        "application/json",

                    "trakt-api-version":
                        "2",

                    "trakt-api-key":
                        INTERNAL_CLIENT_ID

                }
            }

        );


    if (!res) {

        throw new Error(
            "Trakt 返回为空"
        );

    }


    if (
        res.ok === false
    ) {

        throw new Error(
            "Trakt HTTP "
            +
            String(
                res.status ||
                "unknown"
            )
        );

    }


    const raw =
        Array.isArray(res)
            ? res
            : res.data;


    return (
        Array.isArray(raw)
            ? raw
            : []
    );

}


/*
 * ============================================================
 * 第一阶段：
 * 只构建基础卡片，不查 Trakt Rating
 * ============================================================
 */

async function buildMediaItemBase(
    item
) {

    const show =
        item?.show || {};


    const tmdbId =
        Number(
            show?.ids?.tmdb || 0
        ) || null;


    const last =
        getLastWatchedEpisode(
            item
        );


    if (!last) {
        return null;
    }


    const watchedCount =
        countWatchedEpisodes(
            item
        );


    let tmdbShow =
        null;

    let tmdbFailed =
        false;


    if (tmdbId) {

        try {

            tmdbShow =
                await fetchTmdbShow(
                    tmdbId
                );

        } catch (e) {

            tmdbFailed =
                true;

        }

    }


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


    if (
        result.status ===
        "none"
    ) {

        return null;

    }


    if (
        result.status ===
        "lookup_failed"
    ) {

        return null;

    }


    const next =
        result.next;


    const title =
        tmdbShow?.name ||
        tmdbShow?.original_name ||
        show.title ||
        "未知剧集";


    const year =
        String(
            show.year
            ||
            String(
                tmdbShow?.first_air_date ||
                ""
            ).slice(
                0,
                4
            )
            ||
            ""
        );


    const targetSeason =
        Number(
            next.season || 0
        );


    const targetEpisode =
        Number(
            next.episode || 0
        );


    const se =
        `S${pad2(targetSeason)}`
        +
        `E${pad2(targetEpisode)}`;


    const episodeTitle =
        `第${targetEpisode}集`;


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


    const progressText =
        aired > 0
            ? `${formatPercent(pct)}%`
                +
                `（${watchedCount}/${aired} 集）`
            : `${watchedCount} 集`;


    const lastWatchedDate =
        formatDate(
            item?.last_watched_at
        );


    const lines = [

        `🔶 继续观看 · ${se} · ${episodeTitle}`,

        `🔷 观看进度 · ${progressText}`

    ];


    if (
        lastWatchedDate
    ) {

        lines.push(
            `上次观看 · ${lastWatchedDate}`
        );

    }


    const media = {

        id:
            String(
                tmdbId ||
                show?.ids?.trakt ||
                title
            ),

        type:
            "tmdb",

        mediaType:
            "tv",

        title:
            `${title} · ${se}`,

        year:
            year,

        description:
            lines.join(
                "\n"
            ),

        currentSeason:
            targetSeason,

        currentEpisode:
            targetEpisode,

        currentEpisodeName:
            episodeTitle

    };


    /*
     * 先用 TMDB 评分
     * 不额外发 Trakt Rating 请求
     */
    const tmdbRating =
        normalizeRating(
            tmdbShow?.vote_average
        );


    if (
        tmdbRating > 0
    ) {

        media.rating =
            tmdbRating;

    }


    if (
        tmdbId
    ) {

        media.tmdbId =
            tmdbId;

    }


    if (
        tmdbShow?.poster_path
    ) {

        media.posterPath =
            TMDB_IMG
            +
            tmdbShow.poster_path;

    }


    return {

        media:
            media,

        show:
            show,

        tmdbRating:
            tmdbRating

    };

}


/*
 * ============================================================
 * 第二阶段：
 * 只给最终显示的卡片补 Trakt Rating
 * ============================================================
 */

async function finalizeMediaItem(
    data
) {

    const media =
        data?.media;


    if (!media) {
        return null;
    }


    const show =
        data?.show || {};


    /*
     * Trakt 优先
     */
    const traktRating =
        await fetchTraktShowRating(
            show
        );


    if (
        traktRating > 0
    ) {

        media.rating =
            traktRating;

    }


    return media;

}


/*
 * ============================================================
 * 下一集判断
 * ============================================================
 */

async function inferNextEpisode(
    last,
    tmdbId,
    tmdbShow,
    show,
    aired,
    showLookupFailed = false
) {

    if (!last) {

        return {
            status:
                "none"
        };

    }


    const traktAired =
        Number(
            aired ||
            show?.aired_episodes ||
            0
        );


    if (!tmdbId) {

        if (
            last.season === 1 &&
            traktAired >
            last.episode
        ) {

            return {
                status:
                    "next",

                next: {
                    season:
                        last.season,

                    episode:
                        last.episode + 1
                }
            };

        }


        return {
            status:
                "lookup_failed"
        };

    }


    if (
        showLookupFailed
    ) {

        if (
            last.season === 1 &&
            traktAired >
            last.episode
        ) {

            return {
                status:
                    "next",

                next: {
                    season:
                        last.season,

                    episode:
                        last.episode + 1
                }
            };

        }


        return {
            status:
                "lookup_failed"
        };

    }


    let seasonData;


    try {

        seasonData =
            await fetchTmdbSeason(
                tmdbId,
                last.season
            );

    } catch (e) {

        if (
            last.season === 1 &&
            traktAired >
            last.episode
        ) {

            return {
                status:
                    "next",

                next: {
                    season:
                        last.season,

                    episode:
                        last.episode + 1
                }
            };

        }


        return {
            status:
                "lookup_failed"
        };

    }


    const episodes =
        Array.isArray(
            seasonData?.episodes
        )
            ? seasonData.episodes
            : [];


    const nextEpisode =
        episodes.find(
            ep =>
                Number(
                    ep?.episode_number
                )
                ===
                last.episode + 1

                &&

                hasAired(
                    ep?.air_date
                )
        );


    if (
        nextEpisode
    ) {

        return {

            status:
                "next",

            next: {

                season:
                    last.season,

                episode:
                    Number(
                        nextEpisode
                            .episode_number
                    )

            }

        };

    }


    const lastEpisodeToAir =
        tmdbShow
            ?.last_episode_to_air;


    if (
        lastEpisodeToAir

        &&

        Number(
            lastEpisodeToAir
                .season_number
        )
        ===
        last.season

        &&

        Number(
            lastEpisodeToAir
                .episode_number
        )
        >=
        last.episode + 1
    ) {

        return {

            status:
                "next",

            next: {

                season:
                    last.season,

                episode:
                    last.episode + 1

            }

        };

    }


    if (
        last.season === 1 &&
        traktAired >
        last.episode
    ) {

        return {

            status:
                "next",

            next: {

                season:
                    last.season,

                episode:
                    last.episode + 1

            }

        };

    }


    const nextSeasonNo =
        last.season + 1;


    const hasNextSeason =
        Array.isArray(
            tmdbShow?.seasons
        )

        &&

        tmdbShow.seasons.some(
            season =>
                Number(
                    season?.season_number
                )
                ===
                nextSeasonNo

                &&

                Number(
                    season?.episode_count || 0
                )
                > 0
        );


    if (
        !hasNextSeason
    ) {

        return {
            status:
                "none"
        };

    }


    let nextSeason;


    try {

        nextSeason =
            await fetchTmdbSeason(
                tmdbId,
                nextSeasonNo
            );

    } catch (e) {

        return {
            status:
                "lookup_failed"
        };

    }


    const episode1 =
        Array.isArray(
            nextSeason?.episodes
        )

            ? nextSeason.episodes.find(
                ep =>
                    Number(
                        ep?.episode_number
                    )
                    === 1

                    &&

                    hasAired(
                        ep?.air_date
                    )
            )

            : null;


    if (
        !episode1
    ) {

        return {
            status:
                "none"
        };

    }


    return {

        status:
            "next",

        next: {

            season:
                nextSeasonNo,

            episode:
                1

        }

    };

}


/*
 * ============================================================
 * Trakt Rating
 * ============================================================
 */

async function fetchTraktShowRating(
    show
) {

    const lookupId =
        show?.ids?.slug ||
        show?.ids?.trakt;


    if (!lookupId) {
        return 0;
    }


    const key =
        String(
            lookupId
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
        fetchTraktShowRatingInternal(
            lookupId
        );


    traktRatingCache.set(
        key,
        promise
    );


    try {

        const rating =
            await promise;


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


async function fetchTraktShowRatingInternal(
    lookupId
) {

    const url =
        `${TRAKT_BASE}/shows/`
        +
        `${encodeURIComponent(lookupId)}`
        +
        `/ratings`;


    const res =
        await Widget.http.get(

            url,

            {
                headers: {

                    "Content-Type":
                        "application/json",

                    "trakt-api-version":
                        "2",

                    "trakt-api-key":
                        INTERNAL_CLIENT_ID

                }
            }

        );


    if (
        !res ||
        res.ok === false
    ) {

        return 0;

    }


    let data =
        (
            res?.data !== undefined
        )
            ? res.data
            : res;


    if (
        typeof data ===
        "string"
    ) {

        try {

            data =
                JSON.parse(
                    data
                );

        } catch (e) {

            return 0;

        }

    }


    return normalizeRating(
        data?.rating
    );

}


/*
 * ============================================================
 * TMDB
 * ============================================================
 */

async function fetchTmdbShow(
    tmdbId
) {

    const key =
        String(
            tmdbId
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

            `/tv/${tmdbId}`,

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

        const data =
            await promise;


        tmdbShowCache.set(
            key,
            data || null
        );


        return (
            data ||
            null
        );

    } catch (e) {

        tmdbShowCache.delete(
            key
        );

        throw e;

    }

}


async function fetchTmdbSeason(
    tmdbId,
    seasonNo
) {

    const key =
        `${tmdbId}:${seasonNo}`;


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

            `/tv/${tmdbId}/season/${seasonNo}`,

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

        const data =
            await promise;


        tmdbSeasonCache.set(
            key,
            data || null
        );


        return (
            data ||
            null
        );

    } catch (e) {

        tmdbSeasonCache.delete(
            key
        );

        throw e;

    }

}


/*
 * ============================================================
 * 已观看
 * ============================================================
 */

function countWatchedEpisodes(
    item
) {

    let count =
        0;


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

        if (
            Number(
                season?.number || 0
            )
            === 0
        ) {

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
                    ep?.plays || 0
                )
                > 0
            ) {

                count++;

            }

        }

    }


    return count;

}


function getLastWatchedEpisode(
    item
) {

    const seasons =
        Array.isArray(
            item?.seasons
        )
            ? item.seasons
            : [];


    let best =
        null;


    for (
        const season
        of seasons
    ) {

        const seasonNo =
            Number(
                season?.number || 0
            );


        if (
            seasonNo <= 0
        ) {

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
                    ep?.plays || 0
                )
                <= 0
            ) {

                continue;

            }


            const episodeNo =
                Number(
                    ep?.number || 0
                );


            if (
                episodeNo <= 0
            ) {

                continue;

            }


            if (
                !best

                ||

                seasonNo >
                best.season

                ||

                (
                    seasonNo ===
                    best.season

                    &&

                    episodeNo >
                    best.episode
                )
            ) {

                best = {

                    season:
                        seasonNo,

                    episode:
                        episodeNo

                };

            }

        }

    }


    return best;

}


/*
 * ============================================================
 * 辅助
 * ============================================================
 */

function getAiredEpisodeCount(
    show,
    tmdbShow
) {

    const traktAired =
        Number(
            show?.aired_episodes || 0
        );


    if (
        traktAired > 0
    ) {

        return traktAired;

    }


    return Number(
        tmdbShow?.number_of_episodes ||
        0
    );

}


function hasAired(
    dateStr
) {

    if (!dateStr) {
        return false;
    }


    const date =
        new Date(
            String(dateStr)
            +
            "T00:00:00Z"
        );


    if (
        isNaN(
            date.getTime()
        )
    ) {

        return false;

    }


    return (
        date.getTime()
        <=
        Date.now()
    );

}


async function mapWithConcurrency(
    items,
    concurrency,
    worker
) {

    const list =
        Array.isArray(items)
            ? items
            : [];


    if (!list.length) {
        return [];
    }


    const results =
        new Array(
            list.length
        );


    let cursor =
        0;


    const runnerCount =
        Math.min(
            Math.max(
                1,
                concurrency || 1
            ),
            list.length
        );


    const runners =
        new Array(
            runnerCount
        )
            .fill(0)
            .map(
                async () => {

                    while (true) {

                        const index =
                            cursor++;


                        if (
                            index >=
                            list.length
                        ) {

                            return;

                        }


                        try {

                            results[index] =
                                await worker(
                                    list[index],
                                    index
                                );

                        } catch (e) {

                            results[index] =
                                null;

                        }

                    }

                }
            );


    await Promise.all(
        runners
    );


    return results;

}


function normalizeRating(
    value
) {

    const n =
        Number(
            value || 0
        );


    if (
        !Number.isFinite(n)
        ||
        n <= 0
    ) {

        return 0;

    }


    return (
        Math.round(
            n * 10
        )
        /
        10
    );

}


function safeTime(
    value
) {

    const t =
        new Date(
            value || 0
        ).getTime();


    return (
        isNaN(t)
            ? 0
            : t
    );

}


function formatDate(
    value
) {

    if (!value) {
        return "";
    }


    const match =
        String(value).match(
            /^(\d{4}-\d{2}-\d{2})/
        );


    return (
        match
            ? match[1]
            : ""
    );

}


function pad2(
    value
) {

    const n =
        Number(
            value || 0
        );


    return (
        n < 10
            ? "0" + n
            : String(n)
    );

}


function formatPercent(
    value
) {

    const n =
        Number(
            value || 0
        );


    const one =
        Math.round(
            n * 10
        )
        /
        10;


    return (
        Number.isInteger(one)
            ? String(one)
            : one.toFixed(1)
    );

}
