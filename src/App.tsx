import { useState, useEffect, useCallback } from 'react';
import type { Platform, FilterOptions, Influencer, HistoryEntry, HistoryCategory } from './types';
import {
  searchInfluencers, applyFilters, formatNumber, loadHistory, addToHistory,
  clearHistory, getInfluencerFromHistory, getPlatformColor, getPlatformLabel,
  updateHistoryCategory, removeFromHistory, COUNTRIES, OTHER_COUNTRY, getCountryLabel
} from './utils';
import {
  getApiKey, setApiKey, removeApiKey
} from './api';
import './App.css';

const PLATFORMS: { id: Platform; label: string; icon: string; color: string; hint: string }[] = [
  { id: 'youtube', label: 'YouTube', icon: '▶', color: '#FF0000', hint: '支持关键词搜索，如 "AI video", "Midjourney tutorial"' },
  { id: 'instagram', label: 'Instagram', icon: '◈', color: '#E1306C', hint: '搜索 AI 相关达人，如 "ai art", "ai tools"' },
  { id: 'x', label: 'X (Twitter)', icon: '✕', color: '#1DA1F2', hint: '搜索 AI 相关达人，如 "ai video", "comfyui"' },
];

const QUICK_TAGS = ['ai video', 'ai art', 'ai tools', 'midjourney', 'stable diffusion', 'kling', 'runway', 'sora', 'chatgpt', 'comfyui'];

const DEFAULT_FILTERS: FilterOptions = {
  minFollowers: 0,
  maxFollowers: 0,
  minPostFreq: 0,
  minAvgViews: 0,
  countries: [],
};

type HistoryTab = 'all' | 'unclassified' | 'contacted' | 'not_suitable';

function App() {
  const [platform, setPlatform] = useState<Platform>('youtube');
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState<FilterOptions>(DEFAULT_FILTERS);
  const [results, setResults] = useState<Influencer[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'settings'>('search');
  const [historySubTab, setHistorySubTab] = useState<HistoryTab>('all');
  const [searched, setSearched] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [copyTip, setCopyTip] = useState<string | null>(null);

  // API 相关状态
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useApi] = useState(true); // 默认使用 API

  useEffect(() => {
    setHistory(loadHistory());
    const key = getApiKey();
    setHasApiKey(!!key);
    setApiKeyInput(key);
  }, []);

  const handleSearch = useCallback(async () => {
    setError(null);
    setSearched(true);

    // YouTube 且有 API Key → 调用 YouTube Data API
    const shouldUseApi = useApi && hasApiKey && platform === 'youtube';

    if (shouldUseApi) {
      setLoading(true);
      try {
        console.log('[App] Searching YouTube API for:', keyword, 'countries:', filters.countries);

        // 先执行基础搜索
        const { searchYouTubeInfluencers } = await import('./api');
        const apiResults = await searchYouTubeInfluencers(keyword, filters.countries);
        console.log('[App] YouTube API returned:', apiResults.length, 'influencers');

        // 自动检测所有频道的活跃度 + 长视频情况
        let finalResults = apiResults;
        if (apiResults.length > 0) {
          setError('正在检查每个频道的活跃情况，请稍候...');
          const { enrichWithLongVideoCheck } = await import('./api');
          finalResults = await enrichWithLongVideoCheck(apiResults);
          const activeCount = finalResults.filter(inf => {
            if (!inf.lastActiveDate) return false;
            const diffDays = (Date.now() - new Date(inf.lastActiveDate).getTime()) / (24 * 60 * 60 * 1000);
            return diffDays <= 30;
          }).length;
          console.log(`[App] Activity check done: ${activeCount}/${finalResults.length} active in last 30 days`);
        }

        const filtered = applyFilters(finalResults, filters, history);
        console.log('[App] After filters:', filtered.length, 'influencers');
        setResults(filtered);
        if (apiResults.length > 0 && filtered.length === 0) {
          setError(`YouTube 返回了 ${apiResults.length} 个达人，但被过滤条件全部过滤掉了。请放宽过滤条件后重试。`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '搜索失败，请重试';
        console.error('[App] YouTube search error:', errMsg, err);
        setError(errMsg);
        setResults([]);
      } finally {
        setLoading(false);
      }
    } else {
      // Instagram / X 或没有 API Key → 使用本地 Mock 数据
      const mockResults = searchInfluencers(keyword, platform, filters, history);
      setResults(mockResults);
      if (!hasApiKey && useApi && platform === 'youtube') {
        setError('未设置 YouTube API Key，当前显示的是 AI 达人演示数据。前往「设置」配置 API Key 以搜索真实数据。');
      } else if (platform !== 'youtube') {
        // Instagram/X 只用 Mock 数据，不报错
      }
    }
  }, [keyword, platform, filters, history, hasApiKey, useApi]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) handleSearch();
  };

  const handleAddHistory = (inf: Influencer) => {
    setHistory((prev) => {
      const next = addToHistory(prev, inf, keyword);
      setResults((r) => r.filter((i) => i.id !== inf.id));
      return next;
    });
  };

  const handleClearHistory = () => {
    setHistory(clearHistory());
  };

  const handleCategoryChange = (entryId: string, category: HistoryCategory) => {
    setHistory((prev) => updateHistoryCategory(prev, entryId, category));
  };

  const handleRemoveHistory = (entryId: string) => {
    setHistory((prev) => removeFromHistory(prev, entryId));
  };

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      setApiKey(apiKeyInput.trim());
      setHasApiKey(true);
      setError(null);
    } else {
      removeApiKey();
      setHasApiKey(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyTip(text);
      setTimeout(() => setCopyTip(null), 1500);
    });
  };

  const handleQuickTag = (tag: string) => {
    setKeyword(tag);
  };

  const platformInfo = PLATFORMS.find((p) => p.id === platform)!;

  // 历史记录子分类过滤
  const filteredHistory = historySubTab === 'all'
    ? history
    : history.filter((h) => h.category === historySubTab);

  // 各分类计数
  const historyCounts = {
    all: history.length,
    unclassified: history.filter((h) => h.category === 'unclassified').length,
    contacted: history.filter((h) => h.category === 'contacted').length,
    not_suitable: history.filter((h) => h.category === 'not_suitable').length,
  };

  // 过滤条件激活状态（含国家）
  const hasActiveFilters = filters.minFollowers > 0 || filters.maxFollowers > 0 || filters.minPostFreq > 0 || filters.minAvgViews > 0 || (filters.countries && filters.countries.length > 0) || !!filters.hasLongVideo || !!filters.activeWithinDays;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">AI InfluSearch</span>
            <span className="logo-badge">AI</span>
          </div>
          <nav className="nav-tabs">
            <button
              className={`nav-tab ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              🔍 搜索达人
            </button>
            <button
              className={`nav-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              📋 历史记录
              {history.length > 0 && <span className="badge">{history.length}</span>}
            </button>
            <button
              className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              ⚙️ 设置
              {!hasApiKey && <span className="badge badge-warn">!</span>}
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        {activeTab === 'search' ? (
          <div className="search-page">
            {/* API Status Banner */}
            {platform === 'youtube' && !hasApiKey && useApi && (
              <div className="api-banner api-banner-warn">
                <span>⚠️ YouTube 未配置 API Key，当前使用 AI 达人演示数据。前往「设置」配置免费 YouTube API Key。</span>
              </div>
            )}
            {platform === 'youtube' && hasApiKey && useApi && (
              <div className="api-banner api-banner-ok">
                <span>✅ YouTube API 已连接 · 数据来源: Google YouTube Data API · 每天 100 次免费搜索</span>
              </div>
            )}
            {(platform === 'instagram' || platform === 'x') && (
              <div className="api-banner" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
                <span>📦 {platformInfo.label} 使用本地 AI 达人数据库（{platform === 'instagram' ? '12' : '15'} 条数据）</span>
              </div>
            )}

            {/* Platform Selector */}
            <section className="section">
              <div className="section-label">选择平台</div>
              <div className="platform-list">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    className={`platform-btn ${platform === p.id ? 'active' : ''}`}
                    style={platform === p.id ? { '--p-color': p.color } as React.CSSProperties : {}}
                    onClick={() => { setPlatform(p.id); setResults([]); setSearched(false); setError(null); }}
                  >
                    <span className="platform-icon" style={{ color: p.color }}>{p.icon}</span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
              <div className="platform-hint">{platformInfo.hint}</div>
            </section>

            {/* Search Box */}
            <section className="section">
              <div className="section-label">搜索 AI 达人</div>
              <div className="search-row">
                <div className="search-input-wrap">
                  <span className="search-icon">🔍</span>
                  <input
                    className="search-input"
                    type="text"
                    placeholder={
                      platform === 'youtube'
                        ? '搜索 AI 达人（如 "AI video generation", "Midjourney tutorial"）'
                        : `搜索 AI 达人（如 "ai art", "ai tools"）`
                    }
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={loading}
                  />
                  {keyword && (
                    <button className="clear-btn" onClick={() => setKeyword('')}>✕</button>
                  )}
                </div>
                <button
                  className={`search-btn ${loading ? 'loading' : ''}`}
                  onClick={handleSearch}
                  disabled={loading}
                >
                  {loading ? '搜索中...' : '搜索'}
                </button>
              </div>

              {/* Quick Tags */}
              <div className="quick-tags">
                {QUICK_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={`quick-tag ${keyword === tag ? 'active' : ''}`}
                    onClick={() => handleQuickTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </section>

            {/* Filters */}
            <section className="section">
              <button className="filter-toggle" onClick={() => setShowFilters(!showFilters)}>
                <span>⚙️ 过滤条件</span>
                <span className="toggle-arrow">{showFilters ? '▲' : '▼'}</span>
                {hasActiveFilters && (
                  <span className="filter-dot" />
                )}
              </button>
              {showFilters && (
                <div className="filter-grid">
                  {/* 国家/地区多选 */}
                  <div className="filter-item filter-item-full">
                    <label>优先合作地区（可多选）</label>
                    <div className="country-checkbox-groups">
                      {[
                        { group: '北美', codes: ['US', 'CA', 'MX'] },
                        { group: '南美', codes: ['BR'] },
                        { group: '亚太', codes: ['AU', 'NZ', 'JP', 'KR', 'HK', 'TW'] },
                        { group: '欧洲', codes: ['DE', 'FR', 'IT', 'GB', 'IE', 'ES', 'PT', 'CH', 'SE', 'NO', 'IS', 'FI', 'NL', 'PL', 'LU', 'DK', 'IL'] },
                      ].map(({ group, codes }) => (
                        <div key={group} className="country-group">
                          <div className="country-group-label">{group}</div>
                          <div className="country-checkbox-list">
                            {codes.map((code) => {
                              const c = COUNTRIES.find(co => co.code === code);
                              if (!c) return null;
                              const checked = (filters.countries || []).includes(code);
                              return (
                                <label key={code} className={`country-checkbox ${checked ? 'checked' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const current = filters.countries || [];
                                      const next = e.target.checked
                                        ? [...current, code]
                                        : current.filter(cc => cc !== code);
                                      setFilters({ ...filters, countries: next.length > 0 ? next : [] });
                                    }}
                                  />
                                  <span className="country-checkbox-flag">{c.flag}</span>
                                  <span className="country-checkbox-label">{c.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {/* 其他国家 */}
                      <div className="country-group">
                        <div className="country-group-label">其他</div>
                        <div className="country-checkbox-list">
                          <label className={`country-checkbox ${(filters.countries || []).includes('OTHER') ? 'checked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={(filters.countries || []).includes('OTHER')}
                              onChange={(e) => {
                                const current = filters.countries || [];
                                const next = e.target.checked
                                  ? [...current, 'OTHER']
                                  : current.filter(cc => cc !== 'OTHER');
                                setFilters({ ...filters, countries: next });
                              }}
                            />
                            <span className="country-checkbox-flag">{OTHER_COUNTRY.flag}</span>
                            <span className="country-checkbox-label">{OTHER_COUNTRY.label}</span>
                          </label>
                        </div>
                      </div>
                    </div>
                    {/* 已选国家标签 */}
                    {(filters.countries && filters.countries.length > 0) && (
                      <div className="country-selected-tags">
                        <span className="country-tags-label">已选 {filters.countries.length} 个地区:</span>
                        <div className="country-tags-list">
                          {filters.countries.map((code) => (
                            <span key={code} className="country-selected-tag">
                              {getCountryLabel(code)}
                              <button onClick={() => setFilters({ ...filters, countries: (filters.countries || []).filter(c => c !== code) })}>✕</button>
                            </span>
                          ))}
                          <button className="country-clear-all" onClick={() => setFilters({ ...filters, countries: [] })}>全部清除</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="filter-item">
                    <label>最少粉丝数</label>
                    <input
                      type="number" placeholder="例如 100000"
                      value={filters.minFollowers || ''}
                      onChange={(e) => setFilters({ ...filters, minFollowers: Number(e.target.value) })}
                    />
                  </div>
                  <div className="filter-item">
                    <label>最多粉丝数</label>
                    <input
                      type="number" placeholder="例如 10000000（0=不限）"
                      value={filters.maxFollowers || ''}
                      onChange={(e) => setFilters({ ...filters, maxFollowers: Number(e.target.value) })}
                    />
                  </div>
                  <div className="filter-item">
                    <label>最低发帖频率（次/月）</label>
                    <input
                      type="number" placeholder="例如 4"
                      value={filters.minPostFreq || ''}
                      onChange={(e) => setFilters({ ...filters, minPostFreq: Number(e.target.value) })}
                    />
                  </div>
                  <div className="filter-item">
                    <label>最低近30天均播放量</label>
                    <input
                      type="number" placeholder="例如 500000"
                      value={filters.minAvgViews || ''}
                      onChange={(e) => setFilters({ ...filters, minAvgViews: Number(e.target.value) })}
                    />
                  </div>
                  <div className="filter-item filter-item-full">
                    <label className="filter-toggle-label">
                      <span>近期活跃过滤</span>
                      <span className="filter-hint">（只显示近 N 天内有发过视频的达人）</span>
                    </label>
                    <select
                      value={filters.activeWithinDays ?? 0}
                      onChange={(e) => setFilters({ ...filters, activeWithinDays: Number(e.target.value) || undefined })}
                    >
                      <option value="0">不限（显示所有）</option>
                      <option value="7">近 7 天内活跃</option>
                      <option value="30">近 30 天内活跃</option>
                      <option value="90">近 90 天内活跃</option>
                      <option value="180">近半年内活跃</option>
                    </select>
                  </div>
                  <div className="filter-actions">
                    <button className="reset-btn" onClick={() => setFilters(DEFAULT_FILTERS)}>重置过滤</button>
                  </div>
                </div>
              )}
            </section>

            {/* Error */}
            {error && (
              <div className="error-banner">{error}</div>
            )}

            {/* Loading */}
            {loading && (
              <div className="loading">
                <div className="loading-spinner" />
                <span>正在从 {platformInfo.label} 搜索 AI 达人...</span>
              </div>
            )}

            {/* Results */}
            {searched && !loading && (
              <section className="section">
                <div className="results-header">
                  <div className="section-label">
                    搜索结果
                    <span className="result-count">{results.length} 条</span>
                  </div>
                  {results.length > 0 && (
                    <div className="results-hint">点击账号名可直接访问主页 · 点击「加入记录」可收藏达人</div>
                  )}
                </div>
                {results.length === 0 && !error ? (
                  <div className="empty">
                    <div className="empty-icon">🔭</div>
                    <div>暂无匹配的 AI 达人</div>
                    <div className="empty-sub">
                      试试点击上方的快速标签，或修改搜索关键词
                    </div>
                  </div>
                ) : (
                  <div className="card-list">
                    {results.map((inf) => (
                      <InfluencerCard
                        key={inf.id}
                        influencer={inf}
                        keyword={keyword}
                        copyTip={copyTip}
                        onAddHistory={() => handleAddHistory(inf)}
                        onCopy={copyText}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        ) : activeTab === 'history' ? (
          /* History Tab */
          <div className="history-page">
            <div className="history-header">
              <div className="section-label">
                历史记录
                <span className="result-count">{history.length} 条</span>
              </div>
              {history.length > 0 && (
                <button className="clear-history-btn" onClick={handleClearHistory}>🗑️ 清空记录</button>
              )}
            </div>

            {/* History Sub Tabs */}
            <div className="history-tabs">
              <button
                className={`history-tab ${historySubTab === 'all' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('all')}
              >
                全部 <span className="history-tab-count">{historyCounts.all}</span>
              </button>
              <button
                className={`history-tab ${historySubTab === 'unclassified' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('unclassified')}
              >
                <span className="history-tab-dot dot-yellow" /> 待分类
                <span className="history-tab-count">{historyCounts.unclassified}</span>
              </button>
              <button
                className={`history-tab ${historySubTab === 'contacted' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('contacted')}
              >
                <span className="history-tab-dot dot-green" /> 已沟通
                <span className="history-tab-count">{historyCounts.contacted}</span>
              </button>
              <button
                className={`history-tab ${historySubTab === 'not_suitable' ? 'active' : ''}`}
                onClick={() => setHistorySubTab('not_suitable')}
              >
                <span className="history-tab-dot dot-red" /> 不合适
                <span className="history-tab-count">{historyCounts.not_suitable}</span>
              </button>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📭</div>
                <div>
                  {history.length === 0
                    ? '暂无历史记录'
                    : historySubTab === 'all'
                      ? '暂无历史记录'
                      : '该分类下暂无记录'}
                </div>
                <div className="empty-sub">
                  {history.length === 0
                    ? '搜索 AI 达人并点击「加入记录」后会显示在这里'
                    : '切换到其他分类查看更多记录'}
                </div>
              </div>
            ) : (
              <div className="card-list">
                {filteredHistory.map((h) => {
                  const inf = getInfluencerFromHistory(h);
                  if (!inf) {
                    return (
                      <div key={h.id} className="card card-history-only">
                        <div className="card-top">
                          <div className="card-info">
                            <div className="card-name-row">
                              <span className="card-name" style={{ cursor: 'default' }}>
                                {h.influencerId.replace(/^(yt|ig|tw)_/, '@')}
                              </span>
                              <span className="platform-tag" style={{
                                background: getPlatformColor(h.platform) + '22',
                                color: getPlatformColor(h.platform),
                              }}>
                                {getPlatformLabel(h.platform)}
                              </span>
                            </div>
                            <div className="card-bio">
                              搜索关键词: {h.keyword}
                            </div>
                          </div>
                        </div>
                        <div className="card-footer">
                          <span className="history-time">
                            🕐 加入时间: {new Date(h.timestamp).toLocaleString('zh-CN')}
                          </span>
                          <div className="history-action-btns">
                            <CategoryDropdown
                              currentCategory={h.category}
                              onChange={(cat) => handleCategoryChange(h.id, cat)}
                            />
                            <button
                              className="remove-history-btn"
                              onClick={() => handleRemoveHistory(h.id)}
                              title="移除记录"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <InfluencerCard
                      key={h.id}
                      influencer={inf}
                      keyword={h.keyword ?? ''}
                      copyTip={copyTip}
                      onCopy={copyText}
                      historyTime={h.timestamp}
                      category={h.category}
                      onCategoryChange={(cat) => handleCategoryChange(h.id, cat)}
                      onRemove={() => handleRemoveHistory(h.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Settings Tab */
          <div className="settings-page">
            <div className="section">
              <div className="section-label">YouTube API 配置（免费）</div>
              <div className="settings-card">
                <div className="settings-desc">
                  <h3>YouTube Data API v3</h3>
                  <p>
                    Google 官方免费 API，每天 <strong>10,000 配额单位</strong>（约 100 次频道搜索）。
                    配额每 24 小时自动重置，永久免费，无需信用卡。
                  </p>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link"
                  >
                    🌐 前往 Google Cloud Console 获取 API Key →
                  </a>
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <strong>获取步骤：</strong>
                    <ol style={{ paddingLeft: 16, margin: '4px 0' }}>
                      <li>打开 Google Cloud Console，创建项目</li>
                      <li>启用 "YouTube Data API v3"</li>
                      <li>创建凭据 → API 密钥</li>
                      <li>复制 API Key 粘贴到下方</li>
                    </ol>
                  </div>
                </div>

                <div className="settings-form">
                  <div className="settings-field">
                    <label>YouTube API Key</label>
                    <input
                      type="password"
                      className="settings-input"
                      placeholder="输入你的 YouTube API Key"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                  </div>
                  <div className="settings-actions">
                    <button className="search-btn" onClick={handleSaveApiKey}>
                      {hasApiKey ? '更新 Key' : '保存 Key'}
                    </button>
                    {hasApiKey && (
                      <button className="reset-btn" onClick={() => { removeApiKey(); setHasApiKey(false); setApiKeyInput(''); }}>
                        删除 Key
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-status">
                  {hasApiKey ? (
                    <span className="status-ok">✅ YouTube API Key 已配置</span>
                  ) : (
                    <span className="status-no">❌ 未配置 API Key（YouTube 使用演示数据）</span>
                  )}
                </div>
              </div>
            </div>

            <div className="section">
              <div className="section-label">数据来源说明</div>
              <div className="settings-card info-card">
                <div className="info-item">
                  <span className="info-icon">▶</span>
                  <div>
                    <strong>YouTube</strong>：配置 API Key 后使用 Google YouTube Data API 实时搜索频道（每天 100 次免费）。未配置时使用内置 AI 达人演示数据。
                  </div>
                </div>
                <div className="info-item">
                  <span className="info-icon">◈</span>
                  <div>
                    <strong>Instagram</strong>：使用本地 AI 达人数据库（12 条精选数据），覆盖 AI 工具、AI 艺术、AI 视频等领域。
                  </div>
                </div>
                <div className="info-item">
                  <span className="info-icon">✕</span>
                  <div>
                    <strong>X (Twitter)</strong>：使用本地 AI 达人数据库（15 条精选数据），覆盖 AI 视频、AI 编程、AI 音乐等领域。
                  </div>
                </div>
                <div className="info-item">
                  <span className="info-icon">💡</span>
                  <div>
                    <strong>费用说明</strong>：YouTube API 完全免费（每天 100 次搜索），Instagram/X 使用本地数据无需任何费用。
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {copyTip && (
        <div className="copy-toast">✅ 已复制: {copyTip}</div>
      )}
    </div>
  );
}

/* CategoryDropdown Component */
function CategoryDropdown({
  currentCategory,
  onChange,
}: {
  currentCategory: HistoryCategory;
  onChange: (category: HistoryCategory) => void;
}) {
  const [open, setOpen] = useState(false);

  const categoryConfig: Record<HistoryCategory, { label: string; color: string }> = {
    unclassified: { label: '待分类', color: '#f59e0b' },
    contacted: { label: '已沟通', color: '#22c55e' },
    not_suitable: { label: '不合适', color: '#ef4444' },
  };

  const current = categoryConfig[currentCategory];

  return (
    <div className="category-dropdown" onMouseLeave={() => setOpen(false)}>
      <button
        className="category-btn"
        style={{ '--cat-color': current.color } as React.CSSProperties}
        onClick={() => setOpen(!open)}
      >
        <span className="category-dot" style={{ background: current.color }} />
        {current.label}
        <span className="category-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="category-menu">
          {(Object.keys(categoryConfig) as HistoryCategory[]).map((cat) => {
            const cfg = categoryConfig[cat];
            return (
              <button
                key={cat}
                className={`category-menu-item ${cat === currentCategory ? 'active' : ''}`}
                onClick={() => { onChange(cat); setOpen(false); }}
              >
                <span className="category-dot" style={{ background: cfg.color }} />
                {cfg.label}
                {cat === currentCategory && <span className="category-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* InfluencerCard Component */
interface CardProps {
  influencer: Influencer;
  keyword: string;
  copyTip: string | null;
  onAddHistory?: () => void;
  onCopy: (text: string) => void;
  historyTime?: number;
  category?: HistoryCategory;
  onCategoryChange?: (category: HistoryCategory) => void;
  onRemove?: () => void;
}

/** 格式化最后活跃时间为可读文本 */
function formatLastActive(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

function InfluencerCard({ influencer: inf, copyTip, onAddHistory, onCopy, historyTime, category, onCategoryChange, onRemove }: CardProps) {
  const color = getPlatformColor(inf.platform);

  return (
    <div className="card" style={{ '--card-color': color } as React.CSSProperties}>
      {inf._isReal && <div className="real-badge">API 实时数据</div>}
      <div className="card-top">
        <div className="card-avatar">
          <img src={inf.avatarUrl} alt={inf.displayName} onError={(e) => {
            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(inf.displayName)}&background=6366f1&color=fff`;
          }} />
          {inf.verified && <span className="verified-badge">✓</span>}
        </div>
        <div className="card-info">
          <div className="card-name-row">
            <a
              className="card-name"
              href={inf.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`前往 ${inf.displayName} 的主页`}
            >
              {inf.displayName}
            </a>
            <span className="card-username" style={{ color }}>@{inf.username}</span>
            <span className="platform-tag" style={{ background: color + '22', color }}>
              {getPlatformLabel(inf.platform)}
            </span>
            {inf.country && (
              <span className="country-tag">
                {(() => {
                  const c = COUNTRIES.find(co => co.code === inf.country);
                  return c ? `${c.flag}` : '🌍';
                })()}
              </span>
            )}
          </div>
          <div className="card-bio">{inf.bio}</div>
          {inf.tags.length > 0 && (
            <div className="card-tags">
              {inf.tags.map((tag) => (
                <span key={tag} className="tag">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card-stats">
        <div className="stat">
          <div className="stat-val">{formatNumber(inf.followers)}</div>
          <div className="stat-label">粉丝数</div>
        </div>
        <div className="stat">
          <div className="stat-val">{formatNumber(inf.avgViews)}</div>
          <div className="stat-label">近30天均播放</div>
        </div>
        <div className="stat">
          <div className="stat-val">{inf.postFreq}<span className="stat-unit">/月</span></div>
          <div className="stat-label">发帖频率</div>
        </div>
        {inf.hasLongVideoRecent !== undefined && (
          <div className="stat">
            {inf.hasLongVideoRecent ? (
              <span className="long-video-badge">有长视频</span>
            ) : (
              <span className="no-long-video-badge">仅 Shorts</span>
            )}
            <div className="stat-label">近30天</div>
          </div>
        )}
        {inf.lastActiveDate && (
          <div className="stat">
            <div className="stat-val last-active-date" title={new Date(inf.lastActiveDate).toLocaleString('zh-CN')}>
              {formatLastActive(inf.lastActiveDate)}
            </div>
            <div className="stat-label">最后活跃</div>
          </div>
        )}
      </div>

      <div className="card-contacts">
        {inf.email && (
          <div className="contact-row">
            <span className="contact-icon">✉️</span>
            <span className="contact-text">{inf.email}</span>
            <button
              className={`copy-btn ${copyTip === inf.email ? 'copied' : ''}`}
              onClick={() => onCopy(inf.email)}
            >
              {copyTip === inf.email ? '✓' : '复制'}
            </button>
          </div>
        )}
        {inf.otherContacts.map((c, i) => (
          <div className="contact-row" key={i}>
            <span className="contact-icon">🔗</span>
            <span className="contact-text">{c}</span>
            <button
              className={`copy-btn ${copyTip === c ? 'copied' : ''}`}
              onClick={() => onCopy(c)}
            >
              {copyTip === c ? '✓' : '复制'}
            </button>
          </div>
        ))}
        {!inf.email && inf.otherContacts.length === 0 && (
          <div className="contact-empty">联系方式需要达人主动公开，部分数据可能暂无</div>
        )}
      </div>

      <div className="card-footer">
        <div className="card-footer-left">
          {historyTime ? (
            <span className="history-time">
              🕐 加入时间: {new Date(historyTime).toLocaleString('zh-CN')}
            </span>
          ) : (
            <span />
          )}
          {category && onCategoryChange && (
            <CategoryDropdown currentCategory={category} onChange={onCategoryChange} />
          )}
        </div>
        <div className="card-actions">
          {onRemove && (
            <button
              className="remove-history-btn"
              onClick={onRemove}
              title="移除记录"
            >
              🗑️
            </button>
          )}
          <a
            className="visit-btn"
            href={inf.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            访问主页 ↗
          </a>
          {onAddHistory && (
            <button className="add-history-btn" onClick={onAddHistory}>
              + 加入记录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
