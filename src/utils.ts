import type { Influencer, Platform, FilterOptions, HistoryEntry, HistoryCategory } from './types';
import { mockInfluencers } from './mockData';

const HISTORY_KEY = 'influencer_history';

// ========================
// 国家/地区列表
// ========================

export interface CountryOption {
  code: string;     // ISO 3166-1 alpha-2
  label: string;    // 显示名称
  flag: string;     // 国旗 emoji
}

export const COUNTRIES: CountryOption[] = [
  { code: 'US', label: '美国', flag: '🇺🇸' },
  { code: 'CA', label: '加拿大', flag: '🇨🇦' },
  { code: 'AU', label: '澳大利亚', flag: '🇦🇺' },
  { code: 'MX', label: '墨西哥', flag: '🇲🇽' },
  { code: 'BR', label: '巴西', flag: '🇧🇷' },
  { code: 'NZ', label: '新西兰', flag: '🇳🇿' },
  { code: 'JP', label: '日本', flag: '🇯🇵' },
  { code: 'KR', label: '韩国', flag: '🇰🇷' },
  { code: 'HK', label: '香港', flag: '🇭🇰' },
  { code: 'TW', label: '台湾', flag: '🇹🇼' },
  { code: 'DE', label: '德国', flag: '🇩🇪' },
  { code: 'FR', label: '法国', flag: '🇫🇷' },
  { code: 'IT', label: '意大利', flag: '🇮🇹' },
  { code: 'GB', label: '英国', flag: '🇬🇧' },
  { code: 'IE', label: '爱尔兰', flag: '🇮🇪' },
  { code: 'ES', label: '西班牙', flag: '🇪🇸' },
  { code: 'PT', label: '葡萄牙', flag: '🇵🇹' },
  { code: 'CH', label: '瑞士', flag: '🇨🇭' },
  { code: 'SE', label: '瑞典', flag: '🇸🇪' },
  { code: 'IL', label: '以色列', flag: '🇮🇱' },
  { code: 'DK', label: '丹麦', flag: '🇩🇰' },
  { code: 'LU', label: '卢森堡', flag: '🇱🇺' },
  { code: 'NO', label: '挪威', flag: '🇳🇴' },
  { code: 'IS', label: '冰岛', flag: '🇮🇸' },
  { code: 'FI', label: '芬兰', flag: '🇫🇮' },
  { code: 'NL', label: '荷兰', flag: '🇳🇱' },
  { code: 'PL', label: '波兰', flag: '🇵🇱' },
];

export const OTHER_COUNTRY: CountryOption = { code: 'OTHER', label: '其他国家', flag: '🌍' };

export function getCountryLabel(code: string): string {
  const c = COUNTRIES.find((c) => c.code === code);
  return c ? `${c.flag} ${c.label}` : code;
}

// ========================
// 本地 Mock 搜索
// ========================

// 本地 Mock 搜索（仅在没有 API Key 时作为 fallback）
export function searchInfluencers(
  keyword: string,
  platform: Platform,
  filters: FilterOptions,
  history: HistoryEntry[]
): Influencer[] {
  const kw = keyword.toLowerCase().trim();
  const historyIds = new Set(history.map((h) => h.influencerId));

  return mockInfluencers.filter((inf) => {
    if (inf.platform !== platform) return false;
    if (historyIds.has(inf.id)) return false;

    if (kw) {
      const haystack = [
        inf.username,
        inf.displayName,
        inf.bio,
        inf.email,
        ...inf.tags,
        ...inf.otherContacts,
      ].join(' ').toLowerCase();
      const words = kw.split(/\s+/).filter(Boolean);
      const matched = words.some((w) => haystack.includes(w));
      if (!matched) return false;
    }

    if (filters.minFollowers > 0 && inf.followers < filters.minFollowers) return false;
    if (filters.maxFollowers > 0 && inf.followers > filters.maxFollowers) return false;
    if (filters.minPostFreq > 0 && inf.postFreq < filters.minPostFreq) return false;
    if (filters.minAvgViews > 0 && inf.avgViews < filters.minAvgViews) return false;
    // 国家过滤（mock 数据无国家信息，仅在选择了特定国家时过滤）
    if (filters.countries && filters.countries.length > 0 && !filters.countries.includes('OTHER')) {
      if (inf.country && !filters.countries.includes(inf.country)) return false;
    }

    return true;
  });
}

// 对 API 返回的结果应用过滤条件
export function applyFilters(
  influencers: Influencer[],
  filters: FilterOptions,
  _history: HistoryEntry[]
): Influencer[] {
  const now = Date.now();
  return influencers.filter((inf) => {
    // 注意：不因"已在历史中"而隐藏搜索结果，已收藏的达人会显示标记
    if (filters.minFollowers > 0 && inf.followers < filters.minFollowers) return false;
    if (filters.maxFollowers > 0 && inf.followers > filters.maxFollowers) return false;
    if (filters.minPostFreq > 0 && inf.postFreq < filters.minPostFreq) return false;
    if (filters.minAvgViews > 0 && inf.avgViews < filters.minAvgViews) return false;
    // 国家过滤：如果选择了特定国家且达人信息中有国家，则过滤
    if (filters.countries && filters.countries.length > 0 && !filters.countries.includes('OTHER')) {
      // 如果达人有国家信息且不在选中的国家列表中，过滤掉
      if (inf.country && !filters.countries.includes(inf.country)) return false;
    }
    // 长视频过滤：如果要求近一个月有长视频，且达人已被检测过（API 返回了结果）
    if (filters.hasLongVideo) {
      if (inf.hasLongVideoRecent === false) return false;
    }
    // 活跃度过滤：近 N 天内必须有发布视频
    if (filters.activeWithinDays && filters.activeWithinDays > 0) {
      if (inf.lastActiveDate) {
        const lastActiveTime = new Date(inf.lastActiveDate).getTime();
        const diffDays = (now - lastActiveTime) / (24 * 60 * 60 * 1000);
        if (diffDays > filters.activeWithinDays) return false;
      } else {
        // 没有活跃时间信息 → 无法判断，保守过滤掉
        return false;
      }
    }
    return true;
  });
}

// 格式化数字
export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ========================
// 历史记录管理
// ========================

// 本地存储历史记录
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const entries: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    // 数据迁移：为旧记录添加 category 字段
    return entries.map((e) => ({
      ...e,
      category: e.category || 'unclassified',
    }));
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

export function addToHistory(
  prev: HistoryEntry[],
  influencer: Influencer,
  keyword: string
): HistoryEntry[] {
  const filtered = prev.filter((h) => h.influencerId !== influencer.id);
  const entry: HistoryEntry = {
    id: `${influencer.id}_${Date.now()}`,
    influencerId: influencer.id,
    keyword,
    platform: influencer.platform,
    timestamp: Date.now(),
    category: 'unclassified',
    influencerSnapshot: influencer._isReal ? influencer : undefined,
  };
  const next = [entry, ...filtered];
  saveHistory(next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  localStorage.removeItem(HISTORY_KEY);
  return [];
}

// 更新历史记录条目的分类
export function updateHistoryCategory(
  history: HistoryEntry[],
  entryId: string,
  category: HistoryCategory
): HistoryEntry[] {
  const next = history.map((h) =>
    h.id === entryId ? { ...h, category } : h
  );
  saveHistory(next);
  return next;
}

// 从历史记录中移除指定条目
export function removeFromHistory(
  history: HistoryEntry[],
  entryId: string
): HistoryEntry[] {
  const next = history.filter((h) => h.id !== entryId);
  saveHistory(next);
  return next;
}

// 获取达人数据（优先从历史快照获取，其次从 mock 数据获取）
export function getInfluencerById(id: string): Influencer | undefined {
  // 先从 mock 数据查找
  const mockInf = mockInfluencers.find((inf) => inf.id === id);
  if (mockInf) return mockInf;
  return undefined;
}

// 获取达人数据（含历史快照）
export function getInfluencerFromHistory(
  entry: HistoryEntry
): Influencer | undefined {
  // 优先使用快照数据
  if (entry.influencerSnapshot) return entry.influencerSnapshot;
  // 其次从 mock 数据查找
  return getInfluencerById(entry.influencerId);
}

export function getPlatformColor(platform: Platform): string {
  switch (platform) {
    case 'youtube': return '#FF0000';
    case 'instagram': return '#E1306C';
    case 'x': return '#1DA1F2';
  }
}

export function getPlatformLabel(platform: Platform): string {
  switch (platform) {
    case 'youtube': return 'YouTube';
    case 'instagram': return 'Instagram';
    case 'x': return 'X (Twitter)';
  }
}
