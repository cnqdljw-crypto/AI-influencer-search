// YouTube Data API v3 服务层（Google 官方免费 API）
// 文档: https://developers.google.com/youtube/v3/docs
// 免费额度: 每天 10,000 配额单位（≈100 次搜索 + 9000 次详情查询）
// 无需付费，配额每 24 小时重置

const YT_API_BASE = '/api/yt-proxy';
const STORAGE_KEY = 'yt_api_key';

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
export async function searchYouTubeChannels(query: string, maxResults = 12, regionCode?: string): Promise<YTSearchItem[]> {
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
      part: 'snippet,statistics,brandingSettings',
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

/**
 * 检查频道近一个月是否有长视频（时长 ≥ 60 秒，排除 shorts）
 * 同时返回频道最后活跃日期
 * 流程: search.list(视频, publishedAfter) → video.list(时长) → 判断
 */
async function checkChannelRecentActivity(channelId: string): Promise<{
  hasLongVideo: boolean;
  lastActiveDate: string | undefined;
  recentAvgViews: number;
}> {
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const publishedAfter = oneMonthAgo.toISOString();

    // 搜索该频道近一个月的视频
    const searchData = await ytApiGet<YTSearchResponse>('/v3/search', {
      part: 'snippet',
      channelId,
      type: 'video',
      maxResults: '10',
      order: 'date',
      publishedAfter,
    });

    const videos = searchData.items
      .filter(item => item.id.kind === 'youtube#video')
      .map(item => ({
        videoId: item.id.videoId!,
        publishedAt: item.snippet.publishedAt,
      }))
      .filter(v => v.videoId);

    if (videos.length === 0) {
      // 近一个月没有视频，尝试搜索更早的（最近半年内）获取最后活跃日期
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      try {
        const olderData = await ytApiGet<YTSearchResponse>('/v3/search', {
          part: 'snippet',
          channelId,
          type: 'video',
          maxResults: '1',
          order: 'date',
          publishedAfter: sixMonthsAgo.toISOString(),
        });
        const lastVideo = olderData.items.find(i => i.id.kind === 'youtube#video');
        const lastActiveDate = lastVideo?.snippet?.publishedAt;
        console.log(`[YT] Channel ${channelId}: no videos in last month, lastActive=${lastActiveDate || 'unknown'}`);
        return { hasLongVideo: false, lastActiveDate, recentAvgViews: 0 };
      } catch {
        return { hasLongVideo: false, lastActiveDate: undefined, recentAvgViews: 0 };
      }
    }

    // 获取最新视频的发布时间
    const latestPublishDate = videos[0].publishedAt;

    // 批量获取视频详情（含时长 + 播放量）
    const videoIds = videos.map(v => v.videoId);
    const videoData = await ytApiGet<YTVideoListResponse>('/v3/videos', {
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
    });

    // 检查是否有时长 ≥ 60 秒的视频（非 shorts），同时累计播放量
    let hasLong = false;
    let totalViews = 0;
    for (const video of videoData.items) {
      const durationSec = parseISODuration(video.contentDetails.duration);
      if (durationSec >= 60) {
        hasLong = true;
      }
      totalViews += parseInt(video.statistics?.viewCount || '0', 10);
    }
    const recentAvgViews = Math.round(totalViews / videoData.items.length);

    console.log(`[YT] Channel ${channelId}: ${videos.length} videos in last month, hasLong=${hasLong}, recentAvgViews=${recentAvgViews}, latest=${latestPublishDate}`);
    return { hasLongVideo: hasLong, lastActiveDate: latestPublishDate, recentAvgViews };
  } catch (err) {
    console.warn(`[YT] Failed to check activity for channel ${channelId}`, err);
    return { hasLongVideo: false, lastActiveDate: undefined, recentAvgViews: 0 };
  }
}

/**
 * 为达人列表批量检查近期活跃情况
 * 并行检查，每个频道独立，单个失败不影响其他
 * 返回: 检测后的达人列表 + 总计有长视频的数量
 */
export async function enrichWithLongVideoCheck(influencers: Influencer[]): Promise<Influencer[]> {
  const CONCURRENCY = 5;
  const results: Influencer[] = [];

  for (let i = 0; i < influencers.length; i += CONCURRENCY) {
    const batch = influencers.slice(i, i + CONCURRENCY);
    const enriched = await Promise.all(
      batch.map(async (inf) => {
        if (inf.platform === 'youtube' && inf._isReal) {
          const channelId = inf.id.replace('yt_', '');
          const { hasLongVideo, lastActiveDate, recentAvgViews } = await checkChannelRecentActivity(channelId);
          return { ...inf, hasLongVideoRecent: hasLongVideo, lastActiveDate, avgViews: recentAvgViews || inf.avgViews };
        }
        return inf;
      })
    );
    results.push(...enriched);
  }

  return results;
}

/**
 * YouTube 关键词搜索达人（使用 YouTube Data API v3）
 * 流程: search.list(channel) → channels.list(details)
 * 支持多国家：使用本地化关键词搜索 + regionCode 排序偏好 + 去重合并
 */
export async function searchYouTubeInfluencers(keyword: string, countries?: string[]): Promise<Influencer[]> {
  if (!keyword.trim()) return [];

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
    // 不限地区：用 relevance + date 两种排序各搜一次
    await doSearch(keyword, 15, undefined, 'relevance');
    await doSearch(keyword, 10, undefined, 'date');
  } else {
    // 逐个国家搜索
    for (const code of countryList) {
      const localNames = COUNTRY_SEARCH_NAMES[code] || [code];

      // 策略 1: 用本地化国家名 + 关键词搜索（relevance）
      for (const localName of localNames.slice(0, 2)) {
        await doSearch(`${localName} ${keyword}`, 6, code, 'relevance');
      }

      // 策略 2: 用关键词 + regionCode 排序（date 排序，找近期活跃的）
      await doSearch(keyword, 6, code, 'date');
    }
  }

  // "其他国家"
  if (includeOther) {
    await doSearch(keyword, 10, undefined, 'relevance');
  }

  console.log(`[YT] total ${allSearchResults.length} unique channels found`);
  if (allSearchResults.length === 0) {
    // 如果有错误，抛出第一个错误让用户看到；否则返回空
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
    return [];
  }

  // 第二步：提取频道 ID 并批量获取详情
  const channelIds = allSearchResults.map((item) => item.id.channelId!).filter(Boolean);

  let channels: YTChannelItem[];
  try {
    channels = await getYouTubeChannelsDetails(channelIds);
  } catch (err) {
    console.warn('[YT] Failed to get channel details, using search data only', err);
    channels = [];
  }

  console.log(`[YT] got details for ${channels.length}/${channelIds.length} channels`);

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

  return influencers;
}






