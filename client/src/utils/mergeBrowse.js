/**
 * 自动刷新用的「就地合并」逻辑。
 *
 * 轮询到的新一次 /api/browse 结果不能直接塞回 state：
 * - 整体替换会让列表闪一下「加载中」、丢掉滚动位置和已选状态；
 * - 直接换对象引用会让所有缩略图组件重挂载，网络盘上等于重新拉一遍图。
 *
 * 所以这里做三件事：
 * 1. 只有「同一个目录、都不是搜索结果」时才合并，否则交给调用方整体替换；
 * 2. 未变化的条目沿用原来的对象引用（React key 稳定 → DOM 不重建）；
 * 3. 完全没变化时返回 null，调用方连 setState 都不用做。
 */

function itemSignature(item) {
  if (!item) return '';
  return `${item.name || ''}|${item.size ?? ''}|${item.modified ?? ''}|${item.type || ''}`;
}

function samePathList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.path !== b[i]?.path) return false;
  }
  return true;
}

/**
 * 合并一组媒体条目。未变化的条目保留原引用，返回的数组在无变化时就是
 * 原数组本身（调用方可用 === 判断）。
 */
export function mergeMediaItems(prevItems, nextItems) {
  const prevList = Array.isArray(prevItems) ? prevItems : null;
  if (!Array.isArray(nextItems)) return prevList || [];
  if (!prevList) return nextItems;

  const prevByPath = new Map(prevList.map(item => [item?.path, item]));
  let changed = prevList.length !== nextItems.length;
  const merged = nextItems.map((item, i) => {
    const old = prevByPath.get(item?.path);
    // 复用旧对象（保持引用稳定），但文件真的变了就换成新数据
    if (old && itemSignature(old) === itemSignature(item)) {
      if (prevList[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return item;
  });
  return changed ? merged : prevList;
}

function addedPaths(prevItems, nextItems) {
  const before = new Set((prevItems || []).map(i => i?.path));
  return (nextItems || []).map(i => i?.path).filter(p => p && !before.has(p));
}

function removedPaths(prevItems, nextItems) {
  const after = new Set((nextItems || []).map(i => i?.path));
  return (prevItems || []).map(i => i?.path).filter(p => p && !after.has(p));
}

/**
 * @returns {{data: object, added: string[], removed: string[]}|null}
 *   null 表示「无需更新」（内容完全没变，或这次结果已经过期不属于当前视图）。
 */
export function mergeBrowseData(prev, next) {
  if (!next || typeof next !== 'object') return null;
  if (!prev) return { data: next, added: [], removed: [] };

  // 搜索结果、跨目录、递归/普通模式切换 —— 都不能就地合并
  if (prev.isSearch || next.isSearch) return null;
  if ((prev.path || '') !== (next.path || '')) return null;
  if (!!prev.recursive !== !!next.recursive) return null;

  const images = mergeMediaItems(prev.images, next.images);
  const videos = mergeMediaItems(prev.videos, next.videos);
  const foldersChanged = !samePathList(prev.folders, next.folders);
  const total = typeof next.total === 'number' ? next.total : prev.total;

  const changed =
    images !== prev.images ||
    videos !== prev.videos ||
    foldersChanged ||
    total !== prev.total;
  if (!changed) return null;

  const added = [...addedPaths(prev.images, images), ...addedPaths(prev.videos, videos)];
  const removed = [...removedPaths(prev.images, images), ...removedPaths(prev.videos, videos)];

  return {
    data: {
      ...next,
      // 未变化时沿用旧数组，避免连带重渲染
      folders: foldersChanged ? next.folders : prev.folders,
      images,
      videos,
      total
    },
    added,
    removed
  };
}
