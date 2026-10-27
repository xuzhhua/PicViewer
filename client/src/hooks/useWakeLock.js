import { useEffect, useRef } from 'react';

/**
 * 在 active 为 true 期间保持屏幕常亮（Screen Wake Lock API）。
 *
 * 浏览器在页面切到后台时会自动释放 wake lock，所以回到前台要重新申请，
 * 否则用户切出去再回来看图，屏幕又会按系统设置熄灭。
 * 不支持该 API 的浏览器、以及被系统拒绝的情况（低电量模式等）静默降级。
 *
 * @param {boolean} active 是否保持常亮
 */
export default function useWakeLock(active) {
  const lockRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return undefined;
    if (!('wakeLock' in navigator)) return undefined;

    let disposed = false;

    const release = () => {
      const lock = lockRef.current;
      lockRef.current = null;
      if (!lock) return;
      try {
        lock.release();
      } catch {
        // 锁可能已经被浏览器释放（切后台、锁屏），忽略即可
      }
    };

    const acquire = async () => {
      if (disposed || !activeRef.current || lockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          try { lock.release(); } catch { /* 忽略 */ }
          return;
        }
        lockRef.current = lock;
        // 系统或浏览器主动释放（切后台、电量策略）时清掉引用，下次可见时重新申请
        lock.addEventListener('release', () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
      } catch {
        // NotAllowedError（低电量模式、缺少用户手势等）：静默降级
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [active]);
}
