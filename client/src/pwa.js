/**
 * PWA Service Worker 注册 + 更新检测。
 *
 * 对手机端尤其重要：iOS「添加到主屏幕」之后没有地址栏，用户既不能强制刷新，
 * 也没有「再刷一次」这种操作，唯一能清掉站点数据的入口就是删掉图标重新添加。
 *
 * 这里做三件事：
 *   1. 应用切回前台 / 定时调用 registration.update()，主动去问服务器有没有新版本
 *   2. 检测到新版本 → 通过 subscribe() 通知 UI 弹出提示条
 *   3. 用户确认后等新 SW 真正接管再 reload，保证一次就切到新版
 */

const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000; // 前台检查的最小间隔
const UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000; // 定时轮询间隔
const APPLY_UPDATE_TIMEOUT_MS = 3000; // 等待新 SW 接管的兜底时间

const listeners = new Set();

let state = { available: false };
let registration = null;
let hadController = false; // 注册那一刻页面是否已经被某个 SW 控制
let controllerIsCurrent = false; // 新版本 SW 是否已经接管本页面
let dismissed = false; // 本次会话用户点了「稍后」
let lastCheckAt = 0;
let started = false;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return state;
}

function markUpdateAvailable() {
  // 首次安装时 clients.claim() 也会触发 controllerchange，那不是「更新」，别误报
  if (!hadController || dismissed || state.available) return;
  setState({ available: true });
}

/** 主动检查更新。force=true 用于用户手动的场景（忽略节流）。 */
export async function checkForUpdate({ force = false } = {}) {
  if (!registration) return;
  if (!force && Date.now() - lastCheckAt < UPDATE_CHECK_THROTTLE_MS) return;
  lastCheckAt = Date.now();
  try {
    await registration.update();
  } catch (err) {
    console.warn('[PWA] 检查更新失败:', err);
  }
}

/** 用户确认更新：等新 SW 真正接管后刷新页面，避免刷完还是旧版。 */
export function applyUpdate() {
  setState({ available: false });

  if (!registration) {
    window.location.reload();
    return;
  }

  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  // 新 SW 已经接管 → 直接刷新，无需等待
  if (controllerIsCurrent) {
    reload();
    return;
  }

  // 否则等它接管的那一刻再刷新，避免刷完还是旧版
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });

  // waiting 中的 worker 需要被推一把才会接管
  if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });

  // 兜底：按钮不能点了没反应
  setTimeout(reload, APPLY_UPDATE_TIMEOUT_MS);
}

/** 用户选择「稍后」：本次会话内不再提示。 */
export function dismissUpdate() {
  dismissed = true;
  setState({ available: false });
}

export function registerServiceWorker() {
  if (started) return;
  started = true;

  if (!('serviceWorker' in navigator)) return;
  // 开发环境不注册：public/sw.js 还是带占位符的模板，注册会得到一个不可用的 SW，
  // 而且它的缓存会干扰 vite 的 HMR。
  if (!import.meta.env.PROD) return;

  hadController = !!navigator.serviceWorker.controller;

  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (err) {
      console.warn('[PWA] Service Worker 注册失败:', err);
      return;
    }

    // 上次打开时就已经下载好、还没接管的新版本
    if (registration.waiting) markUpdateAvailable();

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' || installing.state === 'activated') {
          markUpdateAvailable();
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 不管是不是更新，从这一刻起控制器就是新版本了
      controllerIsCurrent = true;
      if (hadController) markUpdateAvailable();
      else hadController = true;
    });

    // 手机端的关键：切回前台就检查一次 —— 这就是「不用删图标重加」的原因
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });

    setInterval(() => {
      if (document.visibilityState === 'visible') checkForUpdate();
    }, UPDATE_POLL_INTERVAL_MS);
  });
}
