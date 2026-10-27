import { useState, useCallback, useEffect, useRef } from 'react';
import { mergeBrowseData } from '../utils/mergeBrowse';

function encodePath(filePath) {
  if (!filePath) return '';
  // Use base64url encoding for safe URL transmission
  const utf8Bytes = new TextEncoder().encode(filePath);
  const binary = String.fromCharCode(...utf8Bytes);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 读取一个「应该是数组」的 JSON 响应。
 *
 * 离线时 Service Worker 会给 /api/* 返回 503 + { error: 'offline' }，
 * 如果不校验就 setState，数组会被换成对象，下游的 .map/.find 直接抛
 * TypeError 把整棵 React 树炸掉（而不是优雅降级）。
 */
async function readArrayResponse(res, label) {
  if (!res.ok) {
    throw new Error(res.status === 503 ? '离线：无法连接服务器' : `${label}失败（HTTP ${res.status}）`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${label}：服务器返回了非预期的数据格式`);
  return data;
}

export default function useApi() {
  const [folders, setFolders] = useState([]);
  const [browseData, setBrowseData] = useState(null);
  const [ignoredFolders, setIgnoredFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 自动刷新需要读到「当前」视图，但轮询的 interval 不应该因为列表变了就重建
  const browseDataRef = useRef(null);
  useEffect(() => { browseDataRef.current = browseData; }, [browseData]);
  const refreshingRef = useRef(false);

  // Fetch configured root folders
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch('/api/folders');
      setFolders(await readArrayResponse(res, '加载文件夹列表'));
      setError(null);
    } catch (e) {
      // 失败时保持原有数组，只把原因告知用户（不要用错误对象覆盖掉数组）
      console.error('Failed to fetch folders:', e);
      setError(e.message);
    }
  }, []);

  // Browse a directory
  const browse = useCallback(async (folderPath, details = false) => {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodePath(folderPath);
      const params = new URLSearchParams();
      if (encoded) params.set('path', encoded);
      if (details) params.set('details', '1');
      const qs = params.toString();
      const url = qs ? `/api/browse?${qs}` : '/api/browse';
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '浏览失败');
      }
      const data = await res.json();
      setBrowseData(data);
    } catch (e) {
      setError(e.message);
      setBrowseData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse all subdirectories recursively
  const browseRecursive = useCallback(async (folderPath) => {
    setLoading(true);
    setError(null);
    try {
      const encoded = encodePath(folderPath);
      const url = `/api/browse/recursive?path=${encoded}&details=1&fast=1`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '递归浏览失败');
      }
      const data = await res.json();
      setBrowseData(data);
    } catch (e) {
      setError(e.message);
      setBrowseData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 静默增量刷新当前目录（自动轮询用）。
   *
   * 和 browse() 的区别：不置 loading（不闪「加载中…」）、失败不弹错误（网络
   * 抖一下不该打断浏览）、不整体替换数据，只把新增/删除的条目合进当前列表。
   * 返回 true 表示列表确实变了。
   */
  const refreshBrowse = useCallback(async () => {
    const prev = browseDataRef.current;
    if (!prev || prev.isSearch || prev.recursive) return false;
    if (refreshingRef.current) return false;
    refreshingRef.current = true;
    try {
      const encoded = encodePath(prev.path || '');
      const params = new URLSearchParams();
      if (encoded) params.set('path', encoded);
      // 故意不带 details=1：带上的话服务端会对每个文件跑一次 sharp 读元数据
      // （网络盘上等于把整目录重读一遍），而轮询只需要知道「有没有新文件」。
      // 已经存在的条目会沿用旧对象，元数据不会丢；新出现的条目暂时没有
      // width/height/format，下次手动刷新（F5）时补齐。
      const res = await fetch(`/api/browse?${params.toString()}`);
      if (!res.ok) return false;
      const next = await res.json();

      // 请求期间用户切了目录（或手动刷新过）→ 这次结果已经过期，丢掉
      if (browseDataRef.current !== prev) return false;

      const merged = mergeBrowseData(prev, next);
      if (!merged) return false;
      setBrowseData(merged.data);
      return true;
    } catch (e) {
      // 静默：轮询失败不打扰用户（目录权限变化等仍会在手动刷新时暴露）
      console.warn('自动刷新失败:', e.message);
      return false;
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  // Add a new root folder
  const addFolder = useCallback(async (folderPath) => {
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '添加失败');
      }
      await fetchFolders();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [fetchFolders]);

  // Remove a root folder
  const removeFolder = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '删除失败');
      }
      await fetchFolders();
      setBrowseData(null);
    } catch (e) {
      setError(e.message);
    }
  }, [fetchFolders]);

  // Reorder root folders
  const reorderFolders = useCallback(async (ids) => {
    try {
      const res = await fetch('/api/folders/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error('Reorder failed');
      await fetchFolders();
    } catch (e) {
      console.error('Reorder failed:', e);
    }
  }, [fetchFolders]);

  // Get thumbnail URL (refresh=1 forces the server to regenerate the cached thumbnail)
  // version 是内容版本（见 utils/mediaUrl.js）：同名文件被替换后 URL 会变，
  // 浏览器那层 HTTP 缓存才不会继续吐出上一张图。
  const getThumbnailUrl = useCallback((filePath, size = 256, fit = 'cover', refresh = false, version = '') => {
    const encoded = encodePath(filePath);
    let url = `/api/image/thumbnail?path=${encoded}&size=${size}&fit=${fit}`;
    if (refresh) url += '&refresh=1';
    if (version) url += `&v=${encodeURIComponent(version)}`;
    return url;
  }, []);

  // Get original image URL
  const getImageUrl = useCallback((filePath, version = '') => {
    const encoded = encodePath(filePath);
    return `/api/image/view?path=${encoded}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  }, []);

  // Get lightbox preview URL (长边压缩版，服务端落盘缓存；比原图小一个数量级)
  const getPreviewUrl = useCallback((filePath, maxEdge = 1920, version = '') => {
    const encoded = encodePath(filePath);
    return `/api/image/preview?path=${encoded}&w=${maxEdge}${version ? `&v=${encodeURIComponent(version)}` : ''}`;
  }, []);

  // AI 生成信息（提示词/采样器/种子；无 AI 元数据时服务端返回 { hasAI: false }）
  const getAiMetaUrl = useCallback((filePath) => {
    return `/api/ai-meta?path=${encodePath(filePath)}`;
  }, []);

  // Open native folder picker
  const pickFolder = useCallback(async () => {
    try {
      const res = await fetch('/api/folders/pick', { method: 'POST' });
      const data = await res.json();
      if (data.path) {
        const success = await addFolder(data.path);
        if (!success) return null;
        return data.path;
      }
      return null;
    } catch (e) {
      console.error('pickFolder error:', e);
      setError(e.message || '文件夹选择失败');
      return null;
    }
  }, [addFolder]);

  const fetchIgnored = useCallback(async () => {
    try {
      const res = await fetch('/api/ignored');
      setIgnoredFolders(await readArrayResponse(res, '加载忽略列表'));
    } catch (e) {
      console.error('Failed to fetch ignored folders:', e);
      setError(e.message);
    }
  }, []);

  const addIgnored = useCallback(async (folderPath) => {
    try {
      const res = await fetch('/api/ignored', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '添加忽略失败');
      }
      await fetchIgnored();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [fetchIgnored]);

  const removeIgnored = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/ignored/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '移除忽略失败');
      }
      await fetchIgnored();
    } catch (e) {
      setError(e.message);
    }
  }, [fetchIgnored]);

  // Move files to the system recycle bin (recoverable delete).
  // Pass { permanent: true } to irreversibly delete paths the caller returns in
  // `needsPermanent` (network/mapped locations have no Recycle Bin).
  const deleteFiles = useCallback(async (paths, { permanent = false } = {}) => {
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, permanent })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '删除失败');
      }
      // { deleted: [paths], failed: [{ path, message }], needsPermanent: [paths] }
      return await res.json();
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, []);

  // Locally drop successfully deleted items from the current view (no server round-trip)
  const removeFromView = useCallback((deletedPaths) => {
    if (!deletedPaths || deletedPaths.length === 0) return;
    const gone = new Set(deletedPaths);
    setBrowseData(prev => {
      if (!prev) return prev;
      const removedCount =
        (prev.images || []).filter(i => gone.has(i.path)).length +
        (prev.videos || []).filter(v => gone.has(v.path)).length;
      if (removedCount === 0) return prev;
      const next = {
        ...prev,
        images: (prev.images || []).filter(i => !gone.has(i.path)),
        videos: (prev.videos || []).filter(v => !gone.has(v.path))
      };
      if (typeof prev.total === 'number') next.total = Math.max(0, prev.total - removedCount);
      return next;
    });
  }, []);

  // Open native folder picker for ignored folders
  const pickIgnoredFolder = useCallback(async () => {
    try {
      const res = await fetch('/api/folders/pick', { method: 'POST' });
      const data = await res.json();
      if (data.path) {
        const success = await addIgnored(data.path);
        if (!success) return null;
        return data.path;
      }
      return null;
    } catch (e) {
      console.error('pickIgnoredFolder error:', e);
      setError(e.message || '文件夹选择失败');
      return null;
    }
  }, [addIgnored]);

  // Search across all configured folders
  const search = useCallback(async (query) => {
    if (!query || query.trim().length < 1) {
      setBrowseData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = `/api/search?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '搜索失败');
      }
      const data = await res.json();
      // Format search results like browse data for reuse in ImageGrid
      setBrowseData({
        path: '',
        name: `搜索: "${data.query}"`,
        folders: [],
        images: data.images || [],
        videos: data.videos || [],
        isSearch: true,
        total: data.total,
        truncated: data.truncated
      });
    } catch (e) {
      setError(e.message);
      setBrowseData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    fetchFolders();
    fetchIgnored();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    folders,
    browseData,
    ignoredFolders,
    loading,
    error,
    setError,
    pickFolder,
    fetchFolders,
    browse,
    browseRecursive,
    refreshBrowse,
    addFolder,
    removeFolder,
    reorderFolders,
    fetchIgnored,
    addIgnored,
    removeIgnored,
    pickIgnoredFolder,
    search,
    deleteFiles,
    removeFromView,
    getThumbnailUrl,
    getImageUrl,
    getPreviewUrl,
    getAiMetaUrl
  };
}
