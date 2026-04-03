export type Platform = 'youtube' | 'instagram' | 'x';

export type HistoryCategory = 'unclassified' | 'contacted' | 'not_suitable';

export interface FilterOptions {
  minFollowers: number;
  maxFollowers: number;
  minPostFreq: number; // posts per month
  minAvgViews: number;
  countries?: string[]; // ISO 3166-1 alpha-2 country codes (multi-select)
  hasLongVideo?: boolean; // 近一个月是否发过长视频（shorts不算）
  activeWithinDays?: number; // 近 N 天内有发布视频（0 或不设置 = 不过滤活跃度）
}

export interface Influencer {
  id: string;
  platform: Platform;
  username: string;
  displayName: string;
  followers: number;
  avgViews: number;
  postFreq: number; // posts per month
  email: string;
  otherContacts: string[];
  bio: string;
  verified: boolean;
  tags: string[];
  profileUrl: string;
  avatarUrl: string;
  country?: string; // ISO 3166-1 alpha-2 country code
  hasLongVideoRecent?: boolean; // 近一个月是否发过长视频（shorts不算）
  lastActiveDate?: string; // 频道最后一次发布视频的日期 (ISO string)
  _isReal?: boolean; // 标记是否来自真实 API（而不是 mock 数据）
}

export interface HistoryEntry {
  id: string;
  influencerId: string;
  keyword: string;
  platform: Platform;
  timestamp: number;
  category: HistoryCategory; // 'unclassified' | 'contacted' | 'not_suitable'
  // 保存完整的达人数据快照（API 返回的达人不在 mockData 中）
  influencerSnapshot?: Influencer;
}

export interface SearchState {
  keyword: string;
  platform: Platform;
  filters: FilterOptions;
}
