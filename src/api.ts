// YouTube Data API v3 服务层（Google 官方免费 API）
// 文档: https://developers.google.com/youtube/v3/docs
// 免费额度: 每天 10,000 配额单位
// search.list = 100 单位/次, channels.list = 1 单位/次, videos.list = 1 单位/次
// playlistItems.list = 1 单位/次
// 无需付费，配额每 24 小时重置

const YT_API_BASE = '/api/yt-proxy';
const STORAGE_KEY = 'yt_api_key';

// ========================
// 活跃度缓存（localStorage，2小时有效）
// 避免重复检测同一频道，大幅节省配额
// ========================
const ACTIVITY_CACHE_KEY = 'yt_activity_cache';
const ACTIVITY_CACHE_TTL = 2 * 60 * 60 * 1000; // 2小时

interface ActivityCacheEntry {
  channelId: string;
  hasLongVideo: boolean;
  lastActiveDate: string | undefined;
  recentAvgViews: number;
  timestamp: number;
}

function loadActivityCache(): Map<string, ActivityCacheEntry> {
  try {
    const raw = localStorage.getItem(ACTIVITY_CACHE_KEY);
    if (!raw) return new Map();
    const arr: ActivityCacheEntry[] = JSON.parse(raw);
    const now = Date.now();
    const map = new Map<string, ActivityCacheEntry>();
    for (const entry of arr) {
      if (now - entry.timestamp < ACTIVITY_CACHE_TTL) {
        map.set(entry.channelId, entry);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveActivityCache(cache: Map<string, ActivityCacheEntry>): void {
  try {
    const arr = Array.from(cache.values());
    localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage 满了或不可用，忽略
  }
}

export function getApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

export function removeApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ========================
// YouTube Data API v3 类型
// ========================

interface YTSearchResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YTSearchItem[];
}

interface YTSearchItem {
  kind: string;
  etag: string;
  id: {
    kind: string; // 'youtube#channel' | 'youtube#video' | 'youtube#playlist'
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
    };
    channelTitle: string;
    liveBroadcastContent: string;
  };
}

interface YTChannelResponse {
  kind: string;
  etag: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YTChannelItem[];
}

interface YTChannelItem {
  kind: string;
  etag: string;
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    publishedAt: string;
    thumbnails: {
      default: { url: string };
      medium: { url: string };
      high: { url: string };
    };
    country?: string;
  };
  statistics: {
    viewCount: string;
    subscriberCount: string;
    hiddenSubscriberCount: boolean;
    videoCount: string;
  };
  brandingSettings?: {
    channel: {
      keywords?: string;
    };
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
}

// ========================
// YouTube 搜索频道
// ========================

async function ytApiGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('请先设置 YouTube API Key。前往设置页面输入您的 Google API Key。');
  }

  const url = `${YT_API_BASE}${endpoint}?key=${encodeURIComponent(apiKey)}`;
  const paramStr = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = await fetch(paramStr ? `${url}&${paramStr}` : url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let msg = `YouTube API 请求失败 (${res.status})`;
    let detail = '';
    try {
      const err = JSON.parse(body);
      if (err?.error?.message) {
        msg = err.error.message;
        detail = err.error.errors?.[0]?.reason || '';
      }
    } catch {}
    if (res.status === 400) throw new Error(`API Key 无效或参数错误: ${msg}${detail ? ` [${detail}]` : ''}`);
    if (res.status === 403) {
      if (detail === 'forbidden') throw new Error('API Key 权限不足。请确保已在 Google Cloud Console 中启用 "YouTube Data API v3"，并且 API Key 没有设置 HTTP 引用限制。');
      throw new Error('API 配额已用完或权限不足，请 24 小时后重试。');
    }
    if (res.status === 404) throw new Error('未找到相关结果。');
    throw new Error(msg);
  }

  const data = await res.json() as T;
  console.log(`[YT API] ${endpoint}`, data);
  return data;
}

/**
 * 搜索 YouTube 频道
 * 消耗配额: 100 单位/次
 */
export async function searchYouTubeChannels(query: string, maxResults = 10, regionCode?: string): Promise<YTSearchItem[]> {
  const params: Record<string, string> = {
    part: 'snippet',
    q: query,
    type: 'channel',
    maxResults: String(maxResults),
    order: 'relevance',
  };
  if (regionCode) {
    params.regionCode = regionCode;
  }
  const data = await ytApiGet<YTSearchResponse>('/v3/search', params);

  // 过滤出频道类型的结果
  return data.items.filter((item) => item.id.kind === 'youtube#channel');
}

/**
 * 批量获取频道详情（粉丝数、视频数、总播放量等）
 * 消耗配额: 1 单位/次（最多50个频道）
 * 同时获取 uploadsPlaylistId 用于后续活跃度检测
 */
export async function getYouTubeChannelsDetails(channelIds: string[]): Promise<YTChannelItem[]> {
  if (channelIds.length === 0) return [];

  // YouTube API 一次最多查询 50 个频道
  const batches: string[][] = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    batches.push(channelIds.slice(i, i + 50));
  }

  const allChannels: YTChannelItem[] = [];
  for (const batch of batches) {
    const data = await ytApiGet<YTChannelResponse>('/v3/channels', {
      part: 'snippet,statistics,brandingSettings,contentDetails',
      id: batch.join(','),
    });
    allChannels.push(...data.items);
  }

  return allChannels;
}

// ========================
// 统一搜索接口
// ========================

import type { Influencer } from './types';

// YouTube 视频详情（用于获取时长，判断是否为 shorts）
interface YTVideoItem {
  id: string;
  contentDetails: {
    duration: string; // ISO 8601 duration, e.g. "PT5M30S"
  };
  statistics: {
    viewCount: string;
  };
}

interface YTVideoListResponse {
  items: YTVideoItem[];
}

/**
 * 解析 ISO 8601 duration 为秒数
 * 例如 "PT5M30S" → 330, "PT1H2M3S" → 3723
 */
function parseISODuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const s = parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + s;
}

// ========================
// 国家名本地化映射（用于构造搜索词）
// ========================

const COUNTRY_SEARCH_NAMES: Record<string, string[]> = {
  US: ['USA', 'American', 'United States'],
  CA: ['Canada', 'Canadian'],
  AU: ['Australia', 'Australian'],
  MX: ['Mexico', 'Mexicano', 'México'],
  BR: ['Brazil', 'Brasil', 'Brazilian', 'Brasileiro'],
  NZ: ['New Zealand'],
  JP: ['Japan', '日本'],
  KR: ['Korea', 'South Korea', '한국'],
  HK: ['Hong Kong', '香港'],
  TW: ['Taiwan', '台灣'],
  DE: ['Germany', 'Deutschland', 'German'],
  FR: ['France', 'French', 'Français'],
  IT: ['Italy', 'Italian', 'Italia'],
  GB: ['UK', 'United Kingdom', 'British'],
  IE: ['Ireland', 'Irish'],
  ES: ['Spain', 'España', 'Spanish'],
  PT: ['Portugal', 'Português'],
  CH: ['Switzerland', 'Swiss'],
  SE: ['Sweden', 'Swedish'],
  IL: ['Israel', 'Israeli'],
  DK: ['Denmark', 'Danish'],
  LU: ['Luxembourg'],
  NO: ['Norway', 'Norwegian'],
  IS: ['Iceland'],
  FI: ['Finland', 'Finnish'],
  NL: ['Netherlands', 'Dutch'],
  PL: ['Poland', 'Polish'],
};

// playlistItems.list 的响应类型
interface YTPlaylistItemsResponse {
  items: Array<{
    snippet?: {
      publishedAt: string;
      resourceId?: {
        videoId?: string;
        kind?: string;
      };
    };
  }>;
}

/**
 * 检查频道近期活跃情况（优化版）
 *
 * 优化策略：
 * 1. 先查 localStorage 缓存（2小时有效），命中则 0 配额消耗
 * 2. 未命中时，用 playlistItems.list 代替 search.list：
 *    - search.list(type=video, channelId) = 100 单位
 *    - playlistItems.list(playlistId) = 1 单位
 *    - channels.list 额外取 contentDetails.relatedPlaylists.uploads = 已有调用，0 额外消耗
 * 3. 最多检查最近 5 个视频，只对非 shorts 视频查时长
 *
 * 流程: playlistItems.list(uploads, recent) → video.list(时长+播放量) → 判断
 */
async function checkChannelRecentActivity(
  channelId: string,
  uploadsPlaylistId: string | undefined,
  cache: Map<string, ActivityCacheEntry>
): Promise<{
  hasLongVideo: boolean;
  lastActiveDate: string | undefined;
  recentAvgViews: number;
}> {
  // 1. 检查缓存
  const cached = cache.get(channelId);
  if (cached) {
    console.log(`[YT] Channel ${channelId}: using cached activity data`);
    return {
      hasLongVideo: cached.hasLongVideo,
      lastActiveDate: cached.lastActiveDate,
      recentAvgViews: cached.recentAvgViews,
    };
  }

  try {
    // 2. 获取频道最近视频
    // 优先使用 uploadsPlaylistId（1单位），回退到 search（100单位）
    let videoIds: string[] = [];
    let latestPublishDate: string | undefined;

    if (uploadsPlaylistId) {
      try {
        const playlistData = await ytApiGet<YTPlaylistItemsResponse>('/v3/playlistItems', {
          part: 'snippet',
          playlistId: uploadsPlaylistId,
          maxResults: '5',
        });
        videoIds = playlistData.items
          .map(item => item.snippet?.resourceId?.videoId)
          .filter(Boolean) as string[];
        latestPublishDate = playlistData.items[0]?.snippet?.publishedAt;
        console.log(`[YT] Channel ${channelId}: got ${videoIds.length} recent videos from playlist (1 quota)`);
      } catch (err) {
        console.warn(`[YT] playlistItems failed for ${channelId}, falling back to search`, err);
      }
    }

    // 回退方案：使用 search.list（100单位）
    if (videoIds.length === 0) {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const searchData = await ytApiGet<YTSearchResponse>('/v3/search', {
        part: 'snippet',
        channelId,
        type: 'video',
        maxResults: '5',
        order: 'date',
        publishedAfter: oneMonthAgo.toISOString(),
      });
      videoIds = searchData.items
        .filter(item => item.id.kind === 'youtube#video')
        .map(item => item.id.videoId!)
        .filter(Boolean);
      latestPublishDate = searchData.items[0]?.snippet?.publishedAt;
      console.log(`[YT] Channel ${channelId}: fallback to search.list (100 quota)`);
    }

    if (videoIds.length === 0) {
      const result = { hasLongVideo: false, lastActiveDate: undefined, recentAvgViews: 0 };
      cache.set(channelId, { channelId, ...result, timestamp: Date.now() });
      return result;
    }

    // 3. 批量获取视频详情（时长 + 播放量），1单位
    const videoData = await ytApiGet<YTVideoListResponse>('/v3/videos', {
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
    });

    let hasLong = false;
    let totalViews = 0;
    for (const video of videoData.items) {
      const durationSec = parseISODuration(video.contentDetails.duration);
      if (durationSec >= 60) hasLong = true;
      totalViews += parseInt(video.statistics?.viewCount || '0', 10);
    }
    const recentAvgViews = videoData.items.length > 0
      ? Math.round(totalViews / videoData.items.length)
      : 0;

    console.log(`[YT] Channel ${channelId}: ${videoIds.length} videos, hasLong=${hasLong}, avgViews=${recentAvgViews}`);

    // 4. 写入缓存
    const result = { hasLongVideo: hasLong, lastActiveDate: latestPublishDate, recentAvgViews };
    cache.set(channelId, { channelId, ...result, timestamp: Date.now() });

    return result;
  } catch (err) {
    console.warn(`[YT] Failed to check activity for channel ${channelId}`, err);
    return { hasLongVideo: false, lastActiveDate: undefined, recentAvgViews: 0 };
  }
}

/**
 * 为达人列表批量检查近期活跃情况
 * 优化：最多检测 MAX_CHECK 个频道，带 localStorage 缓存（2小时有效）
 * 并行检查，单个失败不影响其他
 */
export async function enrichWithLongVideoCheck(
  influencers: Influencer[],
  uploadsMap?: Map<string, string> // channelId → uploadsPlaylistId
): Promise<Influencer[]> {
  // 最多检测前 MAX_CHECK 个（避免配额浪费）
  const MAX_CHECK = 10;
  const ytInfluencers = influencers.filter(
    inf => inf.platform === 'youtube' && inf._isReal
  );
  const toCheck = ytInfluencers.slice(0, MAX_CHECK);

  if (toCheck.length === 0) return influencers;

  // 加载缓存
  const cache = loadActivityCache();
  const CONCURRENCY = 5;
  const results: Map<string, Influencer> = new Map();

  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY);
    const enriched = await Promise.all(
      batch.map(async (inf) => {
        const channelId = inf.id.replace('yt_', '');
        const uploadsId = uploadsMap?.get(channelId);
        const { hasLongVideo, lastActiveDate, recentAvgViews } = await checkChannelRecentActivity(
          channelId, uploadsId, cache
        );
        return { ...inf, hasLongVideoRecent: hasLongVideo, lastActiveDate, avgViews: recentAvgViews || inf.avgViews };
      })
    );
    for (const inf of enriched) {
      results.set(inf.id, inf);
    }
  }

  // 保存缓存
  saveActivityCache(cache);

  // 构建最终结果：已检测的 + 未检测的（原样返回）
  return influencers.map(inf => {
    if (results.has(inf.id)) return results.get(inf.id)!;
    return inf;
  });
}

/**
 * YouTube 关键词搜索达人（使用 YouTube Data API v3）
 * 流程: search.list(channel) → channels.list(details + contentDetails)
 * 支持多国家：使用本地化关键词搜索 + regionCode 排序偏好 + 去重合并
 *
 * 优化：减少默认搜索结果数量，获取 uploadsPlaylistId 用于活跃度检测
 */
export async function searchYouTubeInfluencers(keyword: string, countries?: string[]): Promise<{
  influencers: Influencer[];
  uploadsMap: Map<string, string>; // channelId → uploadsPlaylistId
}> {
  if (!keyword.trim()) return { influencers: [], uploadsMap: new Map() };

  const countryList = countries && countries.length > 0 ? countries.filter(c => c !== 'OTHER') : [];
  const includeOther = countries?.includes('OTHER') ?? false;

  const seenChannelIds = new Set<string>();
  const allSearchResults: YTSearchItem[] = [];
  const errors: string[] = [];

  /**
   * 执行一次搜索并收集去重结果
   */
  const doSearch = async (query: string, maxResults: number, regionCode?: string, order: 'relevance' | 'date' = 'relevance') => {
    try {
      // searchYouTubeChannels 固定用 relevance，这里手动调用 ytApiGet
      const params: Record<string, string> = {
        part: 'snippet',
        q: query,
        type: 'channel',
        maxResults: String(maxResults),
        order,
      };
      if (regionCode) params.regionCode = regionCode;
      const data = await ytApiGet<YTSearchResponse>('/v3/search', params);
      const items = data.items.filter((item) => item.id.kind === 'youtube#channel');

      let added = 0;
      for (const item of items) {
        const chId = item.id.channelId!;
        if (!seenChannelIds.has(chId)) {
          seenChannelIds.add(chId);
          allSearchResults.push(item);
          added++;
        }
      }
      console.log(`[YT] search "${query}" (${order}, region=${regionCode || 'none'}): ${items.length} results, ${added} new`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[YT] search failed for "${query}":`, msg);
      errors.push(msg);
    }
  };

  if (countryList.length === 0) {
    // 不限地区：减少搜索量，relevance + date 各搜一次（原 15+10 → 10+5）
    await doSearch(keyword, 10, undefined, 'relevance');
    await doSearch(keyword, 5, undefined, 'date');
  } else {
    // 逐个国家搜索（减少每个国家的搜索量）
    for (const code of countryList) {
      const localNames = COUNTRY_SEARCH_NAMES[code] || [code];

      // 策略 1: 用本地化国家名 + 关键词搜索（relevance），只用第一个本地名（原 2个 → 1个）
      await doSearch(`${localNames[0]} ${keyword}`, 5, code, 'relevance');

      // 策略 2: 用关键词 + regionCode 排序（date 排序，找近期活跃的）
      await doSearch(keyword, 5, code, 'date');
    }
  }

  // "其他国家"
  if (includeOther) {
    await doSearch(keyword, 5, undefined, 'relevance');
  }

  console.log(`[YT] total ${allSearchResults.length} unique channels found`);
  if (allSearchResults.length === 0) {
    // 如果有错误，抛出第一个错误让用户看到；否则返回空
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
    return { influencers: [], uploadsMap: new Map() };
  }

  // 第二步：提取频道 ID 并批量获取详情（含 contentDetails 获取 uploadsPlaylistId）
  const channelIds = allSearchResults.map((item) => item.id.channelId!).filter(Boolean);

  let channels: YTChannelItem[] = [];
  try {
    channels = await getYouTubeChannelsDetails(channelIds);
  } catch (err) {
    console.warn('[YT] Failed to get channel details, using search data only', err);
  }

  console.log(`[YT] got details for ${channels.length}/${channelIds.length} channels`);

  // 构建 uploadsPlaylistId 映射（用于活跃度检测优化）
  const uploadsMap = new Map<string, string>();
  for (const ch of channels) {
    const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;
    if (uploadsId) {
      uploadsMap.set(ch.id, uploadsId);
    }
  }

  // 第三步：合并搜索结果和频道详情
  const channelMap = new Map(channels.map((ch) => [ch.id, ch]));

  const influencers: Influencer[] = allSearchResults.map((item) => {
    const channel = channelMap.get(item.id.channelId!);
    const subscriberCount = channel ? parseInt(channel.statistics.subscriberCount, 10) || 0 : 0;
    const videoCount = channel ? parseInt(channel.statistics.videoCount, 10) || 0 : 0;
    const viewCount = channel ? parseInt(channel.statistics.viewCount, 10) || 0 : 0;

    // 估算月均发帖量（按频道存在时间计算）
    const createdAt = channel ? new Date(channel.snippet.publishedAt) : new Date();
    const monthsActive = Math.max(1, (Date.now() - createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000));
    const postFreq = Math.min(100, Math.max(1, Math.round(videoCount / monthsActive)));

    // 估算平均播放量
    const avgViews = videoCount > 0 ? Math.round(viewCount / videoCount) : 0;

    // 提取关键词 tags
    const keywords = channel?.brandingSettings?.channel?.keywords || '';
    const tags = keywords
      .split(/[,，]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);

    const customUrl = channel?.snippet?.customUrl?.replace('@', '') || '';
    const username = customUrl || item.snippet.channelTitle.replace(/\s+/g, '');

    const thumbnail = item.snippet.thumbnails.high?.url
      || item.snippet.thumbnails.medium?.url
      || item.snippet.thumbnails.default?.url;

    // 频道的注册国家（来自 YouTube API channel.snippet.country）
    const channelCountry = channel?.snippet?.country || undefined;

    return {
      id: `yt_${item.id.channelId}`,
      platform: 'youtube' as const,
      username,
      displayName: channel?.snippet?.title || item.snippet.title,
      followers: subscriberCount,
      avgViews,
      postFreq,
      email: '',
      otherContacts: [],
      bio: channel?.snippet?.description?.slice(0, 200) || item.snippet.description?.slice(0, 200) || '',
      verified: subscriberCount > 100000,
      tags,
      profileUrl: customUrl
        ? `https://www.youtube.com/@${customUrl}`
        : `https://www.youtube.com/channel/${item.id.channelId}`,
      avatarUrl: thumbnail || '',
      country: channelCountry,
      _isReal: true,
    };
  });

  return { influencers, uploadsMap };
}
