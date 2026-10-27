import React, { useState, useEffect, useCallback, useRef } from 'react';
import useApi from '../hooks/useApi';
import useWakeLock from '../hooks/useWakeLock';
import { mediaVersion } from '../utils/mediaUrl';
import { copyText } from '../utils/clipboard';
import './Lightbox.css';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;
const SWIPE_THRESHOLD = 60;

// Thumbnail strip virtualisation. .lightbox-thumb is 56px wide with a 4px gap,
// so every item occupies 60px of the strip. We only render the items around the
// active one: a folder with thousands of photos would otherwise mount thousands
// of <img> elements, and the browser would fire off a thumbnail request for each
// one that scrolls into view — which on a network drive is what makes switching
// crawl (the server has to decode every original to build those thumbnails).
const THUMB_ITEM_WIDTH = 60;
const THUMB_RADIUS = 48;  // items kept on each side of the active one
const THUMB_STEP = 24;    // window slides in steps of this many items (avoids re-render churn)
// Upper bound on the "already loaded" path set (keeps the no-spinner shortcut
// useful without growing forever during a long session).
const MAX_READY_PATHS = 800;

// 灯箱不再直接加载原图：一张 3840×2160 的照片 3~8MB，网络盘上还要先从 SMB
// 读一遍。改成请求服务端压好的预览图（长边 = 屏幕最长边 × DPR，通常 1920~2560），
// 体积只有原图的 15%~40%，且服务端会落盘缓存，第二次秒开。
const PREVIEW_EDGE_STEP = 320;
const PREVIEW_EDGE_MIN = 640;
const PREVIEW_EDGE_MAX = 4096;
// 放大超过这个倍数才需要原图的细节（1x 时预览图已经是屏幕像素 1:1）
const DETAIL_ZOOM = 1.25;

function getPreviewEdge() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const longest = Math.max(window.innerWidth || 1280, window.innerHeight || 720);
  const needed = Math.ceil((longest * dpr) / PREVIEW_EDGE_STEP) * PREVIEW_EDGE_STEP;
  return Math.min(PREVIEW_EDGE_MAX, Math.max(PREVIEW_EDGE_MIN, needed));
}

export default function Lightbox({ images, currentIndex, onClose, onNavigate, favorites, onAddFavorite, onRemoveFavorite, onDeleteRequest, keyboardDisabled }) {
  const { getImageUrl, getThumbnailUrl, getPreviewUrl, getAiMetaUrl } = useApi();
  const [loaded, setLoaded] = useState(false);
  // 预览图加载失败时退回原图（旧格式/极端情况下的兜底）
  const [useOriginal, setUseOriginal] = useState(false);
  // 放大后叠加的原图加载完成（没完成就一直显示预览图，不闪白）
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [slideInterval, setSlideInterval] = useState(4000);
  const [showInfo, setShowInfo] = useState(false);
  // 详情面板分页：'info' | 'ai'（AI 分页只在检测到生成元数据时出现）
  const [infoTab, setInfoTab] = useState('info');
  const [aiMeta, setAiMeta] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const copyTimerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [slideDir, setSlideDir] = useState(0); // -1=prev, 1=next
  const [uiVisible, setUiVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const slideshowRef = useRef(null);
  // path -> HTMLImageElement we keep alive so the decoded bitmap survives until
  // the user actually needs it (a bare `new Image()` can be collected and then
  // the switch has to decode the original again — painfully slow over SMB).
  const preloadedImages = useRef(new Map());
  // paths whose image has finished loading in this session: switching to one of
  // these can skip the loading spinner entirely.
  const readyPaths = useRef(new Set());
  const thumbsRef = useRef(null);
  const videoRef = useRef(null);
  const uiTimerRef = useRef(null);
  const contentRef = useRef(null);
  // 详情面板是否打开（给定时器/键盘回调同步读取，避免闭包拿到旧值）
  const showInfoRef = useRef(false);

  // 灯箱打开期间保持屏幕常亮，退出灯箱自动恢复系统设置
  useWakeLock(true);

  // Refs to keep latest values for synchronous access in event handlers
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current.x = panX; }, [panX]);
  useEffect(() => { panRef.current.y = panY; }, [panY]);

  // Auto-hide UI after 3s of inactivity
  const resetUiTimer = useCallback(() => {
    setUiVisible(true);
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    uiTimerRef.current = setTimeout(() => {
      // 详情面板打开时保持顶栏可见。否则手机上顶栏一淡出，用户就找不到
      // 任何关闭入口了（面板本身也盖住了按钮区域）。
      if (!showInfoRef.current) setUiVisible(false);
    }, 3000);
  }, []);
  useEffect(() => {
    resetUiTimer();
    return () => { if (uiTimerRef.current) clearTimeout(uiTimerRef.current); };
  }, [currentIndex]); // eslint-disable-line

  // 打开/关闭详情面板时刷新顶栏计时器：打开就亮起并暂停自动隐藏，关闭后重新计时
  useEffect(() => {
    showInfoRef.current = showInfo;
    resetUiTimer();
  }, [showInfo, resetUiTimer]);

  // Thumbnail strip auto-scroll
  useEffect(() => {
    if (thumbsRef.current) {
      const active = thumbsRef.current.querySelector('.lightbox-thumb.active');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex]);

  // Touch/pinch tracking
  const touchRef = useRef({
    startX: 0, startY: 0,
    pinchDist: 0, pinchZoom: 1,
    panStartX: 0, panStartY: 0,
    isPinching: false,
    isPanning: false,
    moved: false
  });

  // Mouse drag tracking
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, panStartX: 0, panStartY: 0 });

  const item = images[currentIndex];
  if (!item) { onClose(); return null; }
  const isVideo = item.type === 'video';
  // 内容版本：同名文件被替换后 URL 随之变化，浏览器/服务端都不会再吐旧图
  const version = mediaVersion(item);

  // 主图用「按屏幕算出来的预览图」，放大到超过 1.25x 才在它上面叠一张原图。
  const previewEdge = isVideo ? 0 : getPreviewEdge();
  const wantDetail = !isVideo && !useOriginal && zoom >= DETAIL_ZOOM;
  const mainSrc = isVideo || useOriginal
    ? getImageUrl(item.path, version)
    : getPreviewUrl(item.path, previewEdge, version);

  // Set video loading state when item changes
  useEffect(() => {
    if (isVideo) setVideoLoading(true);
  }, [item?.path, isVideo]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  useEffect(() => {
    setImageError(false);
    setSlideDir(0);
    setUseOriginal(false);
    setDetailLoaded(false);
  }, [item?.path]);

  // 详情面板打开时拉取 AI 生成元数据（提示词/采样器/种子）；切图或关面板时丢弃
  useEffect(() => {
    if (!showInfo || !item || isVideo) {
      setAiMeta(null);
      setAiLoading(false);
      return undefined;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiMeta(null);
    fetch(getAiMetaUrl(item.path))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setAiMeta(data && data.hasAI ? data : null);
      })
      .catch(() => { if (!cancelled) setAiMeta(null); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [showInfo, item?.path, isVideo, getAiMetaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切图后回到「信息」页，避免停在没有内容的 AI 页
  useEffect(() => { setInfoTab('info'); }, [item?.path]);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const handleCopy = useCallback(async (text, key) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedKey(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedKey(''), 1600);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1); setPanX(0); setPanY(0); setRotation(0);
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 };
  }, []);
  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  // Double-click toggle 1x ↔ 2x
  const handleDoubleClick = useCallback((e) => {
    if (isVideo) return;
    e.stopPropagation();
    if (zoomRef.current > 1) {
      resetView();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZoom(2); setPanX(-cx); setPanY(-cy);
      zoomRef.current = 2;
      panRef.current = { x: -cx, y: -cy };
    }
  }, [isVideo, resetView]);

  // Download current media
  const handleDownload = useCallback(() => {
    if (isVideo) {
      const a = document.createElement('a');
      a.href = getImageUrl(item.path, version);
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // For images, use fetch to force download
      fetch(getImageUrl(item.path, version))
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = item.name;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }).catch(() => {});
    }
  }, [item, version, getImageUrl, isVideo]);

  // Browser fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // 缩略图条只渲染当前项附近的一段（虚拟化），返回该段的边界
  const thumbWindow = getThumbWindow(currentIndex, images.length);

  /**
   * 跳到第 index 张。dir 是滑动动画方向（1=下一张，-1=上一张）。
   *
   * 关键点：只有当目标图还没准备好时才显示加载动画。已经预加载好的相邻图
   * 直接显示 —— 之前的实现无条件 setLoaded(false)，于是每切一张都会先闪一下
   * spinner，哪怕图片就在浏览器缓存里。
   */
  const goTo = useCallback((index, dir) => {
    const target = images[index];
    const ready = !!target && target.type === 'image' && readyPaths.current.has(target.path);
    resetView();
    setImageError(false);
    setVideoLoading(!!target && target.type === 'video');
    setLoaded(ready);
    setSlideDir(dir ?? (index > currentIndex ? 1 : -1));
    setTimeout(() => setSlideDir(0), 300);
    onNavigate(index);
  }, [images, currentIndex, onNavigate, resetView]);

  const goNext = useCallback(() => {
    goTo((currentIndex + 1) % images.length, 1);
  }, [goTo, currentIndex, images.length]);

  const goPrev = useCallback(() => {
    goTo((currentIndex - 1 + images.length) % images.length, -1);
  }, [goTo, currentIndex, images.length]);

  // Slideshow with variable speed
  useEffect(() => {
    if (slideshow && !isVideo) {
      slideshowRef.current = setInterval(goNext, slideInterval);
      return () => clearInterval(slideshowRef.current);
    }
    return () => {};
  }, [slideshow, goNext, isVideo, slideInterval]);

  // Preload the neighbouring previews (±2) and keep the decoded bitmaps alive.
  // Entries that leave the window are released so memory stays bounded.
  useEffect(() => {
    if (isVideo) return;
    const keep = new Set();
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const idx = (currentIndex + i + images.length) % images.length;
      const target = images[idx];
      if (!target || target.type !== 'image') continue;
      keep.add(target.path);
      if (preloadedImages.current.has(target.path) || readyPaths.current.has(target.path)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (preloadedImages.current.get(target.path) === img) readyPaths.current.add(target.path);
        pruneReadyPaths(readyPaths.current);
      };
      img.onerror = () => { preloadedImages.current.delete(target.path); };
      preloadedImages.current.set(target.path, img);
      img.src = getPreviewUrl(target.path, previewEdge, mediaVersion(target));
    }
    for (const [p, img] of preloadedImages.current) {
      if (keep.has(p)) continue;
      img.onload = null;
      img.onerror = null;
      img.src = '';
      preloadedImages.current.delete(p);
    }
  }, [currentIndex, images, getPreviewUrl, isVideo, previewEdge]);

  // Release the preload references when the lightbox closes
  useEffect(() => () => {
    for (const img of preloadedImages.current.values()) img.src = '';
    preloadedImages.current.clear();
  }, []);

  // Keyboard
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (keyboardDisabled) return;
      switch (e.key) {
        case 'Escape':
          // 面板开着时先关面板，再按一次才关灯箱
          if (showInfoRef.current) setShowInfo(false);
          else onClose();
          break;
        case 'Delete':
          e.preventDefault();
          onDeleteRequest?.(item);
          break;
        case 'f':
          if (!e.ctrlKey && !e.metaKey) { toggleFullscreen(); }
          break;
        case 'ArrowLeft':
          if (isVideo && videoRef.current) { videoRef.current.currentTime -= 5; }
          else goPrev();
          break;
        case 'ArrowRight':
          if (isVideo && videoRef.current) { videoRef.current.currentTime += 5; }
          else goNext();
          break;
        case ' ':
          if (isVideo && videoRef.current) {
            e.preventDefault();
            videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
          } else if (!isVideo) {
            e.preventDefault(); setSlideshow(s => !s);
          }
          break;
        case '+': case '=':
          if (!isVideo) setZoom(z => clampZoom(z + 0.5));
          break;
        case '-':
          if (!isVideo) setZoom(z => clampZoom(z - 0.5));
          break;
        case '0':
          if (!isVideo) resetView();
          break;
        case 'r':
          if (!isVideo) setRotation(r => (r + 90) % 360);
          break;
        case 'l':
          if (!isVideo) setRotation(r => (r - 90 + 360) % 360);
          break;
        case 'i':
          setShowInfo(s => !s);
          break;
        case '1': setSlideInterval(1000); break;
        case '2': setSlideInterval(3000); break;
        case '3': setSlideInterval(5000); break;
        case '4': setSlideInterval(10000); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev, isVideo, resetView, toggleFullscreen, onDeleteRequest, keyboardDisabled, item]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    if (isVideo) return;
    // Only zoom when scrolling over the image itself, not nav buttons or empty space
    if (!e.target.closest('.lightbox-image-container')) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;

    const oldZoom = zoomRef.current;
    const newZoom = clampZoom(oldZoom + delta);
    if (newZoom === oldZoom) return;
    const ratio = newZoom / oldZoom;

    const newPanX = panRef.current.x * ratio + cx * (1 - ratio);
    const newPanY = panRef.current.y * ratio + cy * (1 - ratio);

    zoomRef.current = newZoom;
    panRef.current = { x: newPanX, y: newPanY };
    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, [isVideo]);

  // Touch handlers
  const handleTouchStart = useCallback((e) => {
    if (isVideo) return;
    const touches = e.touches;
    touchRef.current.moved = false;

    if (touches.length === 2) {
      // Pinch start — record center and distance
      const cx = (touches[0].clientX + touches[1].clientX) / 2;
      const cy = (touches[0].clientY + touches[1].clientY) / 2;
      touchRef.current.pinchCenter = { x: cx, y: cy };
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      touchRef.current.pinchDist = Math.hypot(dx, dy);
      touchRef.current.pinchZoom = zoomRef.current;
      touchRef.current.isPinching = true;
      touchRef.current.isPanning = false;
    } else if (touches.length === 1) {
      touchRef.current.startX = touches[0].clientX;
      touchRef.current.startY = touches[0].clientY;
      touchRef.current.panStartX = panRef.current.x;
      touchRef.current.panStartY = panRef.current.y;
      touchRef.current.isPinching = false;
      touchRef.current.isPanning = zoomRef.current > 1;
    }
  }, [isVideo]);

  const handleTouchMove = useCallback((e) => {
    if (isVideo) return;
    const touches = e.touches;
    touchRef.current.moved = true;

    if (touches.length === 2 && touchRef.current.isPinching) {
      e.preventDefault();
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      const newDist = Math.hypot(dx, dy);
      // New pinch center
      const cx = (touches[0].clientX + touches[1].clientX) / 2;
      const cy = (touches[0].clientY + touches[1].clientY) / 2;
      if (touchRef.current.pinchDist > 0) {
        const scale = newDist / touchRef.current.pinchDist;
        const newZoom = clampZoom(touchRef.current.pinchZoom * scale);
        const ratio = newZoom / (zoomRef.current || 1);
        // Adjust pan around pinch center
        const rect = e.currentTarget.getBoundingClientRect();
        const relX = cx - rect.left - rect.width / 2;
        const relY = cy - rect.top - rect.height / 2;
        const newPanX = panRef.current.x * ratio + relX * (1 - ratio);
        const newPanY = panRef.current.y * ratio + relY * (1 - ratio);
        zoomRef.current = newZoom;
        panRef.current = { x: newPanX, y: newPanY };
        setZoom(newZoom);
        setPanX(newPanX);
        setPanY(newPanY);
      }
      touchRef.current.pinchCenter = { x: cx, y: cy };
    } else if (touches.length === 1 && touchRef.current.isPanning && zoomRef.current > 1) {
      const dx = touches[0].clientX - touchRef.current.startX;
      const dy = touches[0].clientY - touchRef.current.startY;
      const newPanX = touchRef.current.panStartX + dx;
      const newPanY = touchRef.current.panStartY + dy;
      panRef.current = { x: newPanX, y: newPanY };
      setPanX(newPanX);
      setPanY(newPanY);
    }
  }, [isVideo]);

  const handleTouchEnd = useCallback((e) => {
    if (isVideo) return;
    if (touchRef.current.isPinching) {
      touchRef.current.isPinching = false;
      if (zoomRef.current > 1) {
        touchRef.current.panStartX = panRef.current.x;
        touchRef.current.panStartY = panRef.current.y;
      }
      return;
    }

    // Swipe to navigate (only when not zoomed and not panning)
    if (!touchRef.current.moved || zoomRef.current > 1) return;
    const dx = (e.changedTouches[0]?.clientX || 0) - touchRef.current.startX;
    const dy = (e.changedTouches[0]?.clientY || 0) - touchRef.current.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx > 0) goPrev(); else goNext();
    }
  }, [goNext, goPrev, isVideo]);

  // Mouse drag pan
  const handleMouseDown = useCallback((e) => {
    if (isVideo || e.button !== 0 || zoomRef.current <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      panStartX: panRef.current.x, panStartY: panRef.current.y
    };
  }, [isVideo]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const newPanX = dragRef.current.panStartX + e.clientX - dragRef.current.startX;
      const newPanY = dragRef.current.panStartY + e.clientY - dragRef.current.startY;
      panRef.current = { x: newPanX, y: newPanY };
      setPanX(newPanX);
      setPanY(newPanY);
    };
    const handleUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  // Attach wheel/touchmove with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [handleWheel, handleTouchMove]);

  return (
    <div className="lightbox-overlay" onClick={() => { if (zoomRef.current <= 1 && !isVideo) onClose(); }}
      onMouseMove={resetUiTimer} onTouchStart={resetUiTimer}>
      {/* Top bar */}
      <div className={`lightbox-topbar${uiVisible ? '' : ' hidden'}`} onClick={e => e.stopPropagation()}>
        <div className="lightbox-info">
          <span className="lightbox-type">{isVideo ? <img src="/icons/video-camera.svg" alt="" width="16" height="16" className="lb-icon" /> : <img src="/icons/picture.svg" alt="" width="16" height="16" className="lb-icon" />}</span>
          <span className="lightbox-filename">{item.name}</span>
          <span className="lightbox-counter">{currentIndex + 1} / {images.length}</span>
          {zoom !== 1 && <span className="lightbox-zoom-label">{Math.round(zoom * 100)}%</span>}
        </div>
        <div className="lightbox-actions">
          {!isVideo && (
            <button className={`lb-btn ${slideshow ? 'active' : ''}`}
              onClick={() => setSlideshow(s => !s)} title="幻灯片 (空格)">
              <img src={slideshow ? '/icons/pause.svg' : '/icons/play.svg'} alt="" width="16" height="16" />
            </button>
          )}
          {slideshow && !isVideo && (
            <select className="lb-speed-select" value={slideInterval}
              onChange={e => setSlideInterval(parseInt(e.target.value))} title="幻灯片间隔">
              <option value="1000">1s</option>
              <option value="3000">3s</option>
              <option value="5000">5s</option>
              <option value="10000">10s</option>
            </select>
          )}
          {!isVideo && (
            <>
              <button className="lb-btn" onClick={() => setRotation(r => (r - 90 + 360) % 360)} title="左旋 (L)"><img src="/icons/go-back.svg" alt="" width="16" height="16" /></button>
              <button className="lb-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="右旋 (R)"><img src="/icons/go-back.svg" alt="" width="16" height="16" style={{transform:'scaleX(-1)'}} /></button>
            </>
          )}
          {!isVideo && (
            <button className="lb-btn" onClick={resetView} title="重置 (0)"><img src="/icons/refresh.svg" alt="" width="16" height="16" /></button>
          )}
          <button className="lb-btn" onClick={handleDownload} title="下载">
            <img src="/icons/download.svg" alt="" width="16" height="16" />
          </button>
          <button className="lb-btn danger" onClick={() => onDeleteRequest?.(item)} title="删除 (Delete)">
            <img src="/icons/trash.svg" alt="" width="16" height="16" />
          </button>
          <button className="lb-btn" onClick={async () => {
            const fav = favorites?.find(f => f.path === item.path);
            fav ? onRemoveFavorite?.(fav.id) : onAddFavorite?.(item);
          }} title={favorites?.find(f => f.path === item.path) ? '取消收藏' : '添加收藏'}>
            <img src="/icons/star.svg" alt="" width="16" height="16" style={{opacity: favorites?.find(f => f.path === item.path) ? 1 : 0.3}} />
          </button>
          <button className="lb-btn" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'}>
            <img src={isFullscreen ? '/icons/fullscreen-exit.svg' : '/icons/fullscreen.svg'} alt="" width="16" height="16" />
          </button>
          <button className={`lb-btn${showInfo ? ' active' : ''}`} onClick={() => setShowInfo(i => !i)} title="详细信息 (I)"><img src="/icons/info.svg" alt="" width="16" height="16" /></button>
          <button className="lb-btn" onClick={onClose} title="关闭 (Esc)"><img src="/icons/close.svg" alt="" width="16" height="16" /></button>
        </div>
      </div>

      {/* Content */}
      <div className="lightbox-content" ref={contentRef} onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {images.length > 1 && (
          <button className="lightbox-nav lightbox-prev" onClick={goPrev} aria-label="上一张">
            <img src="/icons/chevron-left.svg" alt="" width="20" height="20" />
          </button>
        )}

        <div className="lightbox-media-wrap">
          {isVideo ? (
            <div className="lightbox-video-container">
              {videoLoading && (
                <div className="lightbox-video-loading">
                  <div className="spinner" />
                  <span className="lightbox-video-loading-text">正在处理视频...</span>
                </div>
              )}
              <video key={item.path} ref={videoRef}
                className={`lightbox-video ${!videoLoading ? 'loaded' : ''}`}
                src={getImageUrl(item.path, version)} controls autoPlay playsInline
                onLoadedData={() => { setLoaded(true); setVideoLoading(false); }}
                onError={() => setVideoLoading(false)} />
            </div>
          ) : (
            <div
              className={`lightbox-image-container${slideDir === -1 ? ' slide-left' : slideDir === 1 ? ' slide-right' : ''}`}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClick}
              style={{
                cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
                transform: `translate(${panX}px, ${panY}px) scale(${zoom}) rotate(${rotation}deg)`,
                transition: touchRef.current.isPinching ? 'none' : undefined
              }}
            >
              {!loaded && !imageError && <div className="lightbox-loading"><div className="spinner" /></div>}
              {imageError ? (
                <div className="lightbox-error">
                  <span className="lightbox-error-icon">⚠️</span>
                  <span>图片加载失败</span>
                  <button className="lb-btn" onClick={() => { setImageError(false); setLoaded(false); setUseOriginal(false); }} style={{marginTop:8}}>重试</button>
                </div>
              ) : (
                <div className="lightbox-image-stack">
                  <img
                    src={mainSrc} alt={item.name}
                    className={`lightbox-image ${loaded ? 'loaded' : ''}`}
                    onLoad={() => {
                      // 记住这张已经加载过：下次切回来不用再闪加载动画
                      readyPaths.current.add(item.path);
                      pruneReadyPaths(readyPaths.current);
                      setLoaded(true);
                    }}
                    onError={() => {
                      // 预览图失败先退回原图；原图也失败才算真的坏图
                      if (!useOriginal && !isVideo) { setUseOriginal(true); return; }
                      setImageError(true);
                      setLoaded(true);
                    }}
                    draggable={false}
                    decoding="async"
                  />
                  {/* 放大看细节时才叠上原图；没加载完就一直显示预览图，不闪白 */}
                  {wantDetail && (
                    <img
                      src={getImageUrl(item.path, version)} alt="" aria-hidden="true"
                      className={`lightbox-image lightbox-image-detail ${detailLoaded ? 'loaded' : ''}`}
                      onLoad={() => setDetailLoaded(true)}
                      draggable={false}
                      decoding="async"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {images.length > 1 && (
          <button className="lightbox-nav lightbox-next" onClick={goNext} aria-label="下一张">
            <img src="/icons/chevron-right.svg" alt="" width="20" height="20" />
          </button>
        )}
      </div>

      {/* Thumbnails — virtualised: only the window around the active item is
          rendered, the rest is collapsed into two spacers that keep the scroll
          width (and therefore the scroll position) identical. */}
      <div className={`lightbox-thumbs${uiVisible ? '' : ' hidden'}`} ref={thumbsRef} onClick={e => e.stopPropagation()}>
        {thumbWindow.leading > 0 && (
          <div className="lightbox-thumb-spacer" style={{ width: thumbWindow.leading }} aria-hidden="true" />
        )}
        {images.slice(thumbWindow.start, thumbWindow.end).map((img, offset) => {
          const i = thumbWindow.start + offset;
          return (
            <div key={img.path}
              className={`lightbox-thumb ${i === currentIndex ? 'active' : ''}`}
              onClick={() => goTo(i, i > currentIndex ? 1 : -1)}>
              {img.type === 'video'
                ? <div className="thumb-video-wrap">
                    <img src={getThumbnailUrl(img.path, 128, 'cover', false, mediaVersion(img))} alt="" loading="lazy" decoding="async" />
                    <span className="thumb-play-badge"><img src="/icons/play.svg" alt="" width="10" height="10" /></span>
                  </div>
                : <img src={getThumbnailUrl(img.path, 128, 'cover', false, mediaVersion(img))} alt="" loading="lazy" decoding="async" />}
            </div>
          );
        })}
        {thumbWindow.trailing > 0 && (
          <div className="lightbox-thumb-spacer" style={{ width: thumbWindow.trailing }} aria-hidden="true" />
        )}
      </div>

      <div className={`lightbox-hints${uiVisible ? '' : ' hidden'}`}>
        <span>← → 切换</span>
        {!isVideo && <span>滚动缩放</span>}
        {!isVideo && <span>双击 1x/2x</span>}
        {!isVideo && <span>拖拽平移</span>}
        {isVideo && <span>← → 快退/快进 5s</span>}
        {isVideo && <span>空格 播放/暂停</span>}
        <span>F 全屏</span>
        <span>Esc 关闭</span>
        <span>ℹ 信息</span>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="lightbox-info-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="媒体信息">
          <div className="info-panel-header">
            <h4><img src="/icons/note.svg" alt="" width="16" height="16" />{infoTab === 'ai' ? 'AI 生成信息' : '媒体信息'}</h4>
            <button className="lb-btn info-panel-close" onClick={() => setShowInfo(false)}
              title="关闭详细信息 (Esc)" aria-label="关闭详细信息">
              <img src="/icons/close.svg" alt="" width="16" height="16" />
            </button>
          </div>
          <div className="info-tabs" role="tablist" aria-label="详情分页">
            <button type="button" role="tab" aria-selected={infoTab === 'info'}
              className={`info-tab${infoTab === 'info' ? ' active' : ''}`}
              onClick={() => setInfoTab('info')}>信息</button>
            {aiMeta && (
              <button type="button" role="tab" aria-selected={infoTab === 'ai'}
                className={`info-tab${infoTab === 'ai' ? ' active' : ''}`}
                onClick={() => setInfoTab('ai')}>AI 生成</button>
            )}
            {aiLoading && <span className="info-tab-loading">读取 AI 信息…</span>}
          </div>
          <div className="info-panel-body">
            {infoTab === 'ai' && aiMeta ? (
              <AiMetaView meta={aiMeta} copiedKey={copiedKey} onCopy={handleCopy} />
            ) : (
            <div className="info-grid">
              <span className="info-label">文件名</span>
              <span className="info-value">{item.name}</span>

              <span className="info-label">类型</span>
              <span className="info-value">{isVideo ? '视频' : '图片'}</span>

              {item.format && <>
                <span className="info-label">格式</span>
                <span className="info-value">{item.format.toUpperCase()}</span>
              </>}

              {item.width && item.height && <>
                <span className="info-label">尺寸</span>
                <span className="info-value">{item.width} × {item.height}</span>
              </>}

              <span className="info-label">文件大小</span>
              <span className="info-value">{formatFileSize(item.size)}</span>

              <span className="info-label">修改日期</span>
              <span className="info-value">{formatDate(item.modified)}</span>

              {isVideo && item.duration && <>
                <span className="info-label">时长</span>
                <span className="info-value">{formatDuration(item.duration)}</span>
              </>}

              {isVideo && item.videoCodec && <>
                <span className="info-label">编码</span>
                <span className="info-value">{item.videoCodec}</span>
              </>}

              {isVideo && item.bitrate > 0 && <>
                <span className="info-label">码率</span>
                <span className="info-value">{Math.round(item.bitrate / 1000)} kbps</span>
              </>}

              {!isVideo && item.colorSpace && <>
                <span className="info-label">色彩空间</span>
                <span className="info-value">{item.colorSpace}</span>
              </>}

              {!isVideo && item.channels != null && <>
                <span className="info-label">通道</span>
                <span className="info-value">{item.channels} {item.hasAlpha ? '(含透明)' : ''}</span>
              </>}

              {item.folder && item.folder !== '.' && <>
                <span className="info-label">所在目录</span>
                <span className="info-value">{item.folder}</span>
              </>}

              <span className="info-label">完整路径</span>
              <span className="info-value info-path">{item.path}</span>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 复制按钮：文字会短暂变成「已复制」。
 * 手机上走 HTTP 局域网访问时 navigator.clipboard 不可用，copyText 内部会兜底。
 */
function CopyButton({ text, copyKey, copiedKey, onCopy, className = 'ai-copy' }) {
  const copied = copiedKey === copyKey;
  return (
    <button type="button" className={`${className}${copied ? ' copied' : ''}`}
      onClick={() => onCopy(text, copyKey)} aria-label={copied ? '已复制' : '复制'}>
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function AiTextBlock({ label, text, copyKey, copiedKey, onCopy }) {
  if (!text) return null;
  return (
    <div className="ai-block">
      <div className="ai-block-head">
        <span className="ai-block-label">{label}</span>
        <CopyButton text={text} copyKey={copyKey} copiedKey={copiedKey} onCopy={onCopy} />
      </div>
      <div className="ai-text">{text}</div>
    </div>
  );
}

/** 汇总成一份可直接粘贴的文本（A1111 风格的提示词块 + 参数行） */
function buildAiCopyText(meta) {
  const parts = [];
  if (meta.positive) parts.push(meta.positive);
  if (meta.negative) parts.push(`Negative prompt: ${meta.negative}`);
  if (meta.params && meta.params.length) {
    parts.push(meta.params.map((p) => `${p.label}: ${p.value}`).join(', '));
  }
  return parts.join('\n\n');
}

function AiMetaView({ meta, copiedKey, onCopy }) {
  const hasPrompt = !!(meta.positive || meta.negative);
  return (
    <div className="ai-meta">
      <div className="ai-head">
        <span className="ai-badge">{meta.tool || 'AI'}</span>
        <span className="ai-head-note">从图片元数据中读取</span>
      </div>

      {!hasPrompt && <div className="ai-empty">这张图片没有记录提示词，但保留了其他生成参数。</div>}

      <AiTextBlock label="正向提示词" text={meta.positive} copyKey="positive"
        copiedKey={copiedKey} onCopy={onCopy} />
      <AiTextBlock label="反向提示词" text={meta.negative} copyKey="negative"
        copiedKey={copiedKey} onCopy={onCopy} />

      {meta.params && meta.params.length > 0 && (
        <div className="ai-section">
          <div className="ai-section-title">生成参数</div>
          <div className="info-grid ai-param-grid">
            {meta.params.map((p, i) => (
              <React.Fragment key={`${p.label}-${i}`}>
                <span className="info-label">{p.label}</span>
                <span className="info-value">{p.value}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {meta.texts && meta.texts.length > 0 && (
        <div className="ai-section">
          <div className="ai-section-title">其他文本</div>
          {meta.texts.map((t, i) => (
            <AiTextBlock key={`text-${i}`} label={t.label || '文本'} text={t.text}
              copyKey={`text-${i}`} copiedKey={copiedKey} onCopy={onCopy} />
          ))}
        </div>
      )}

      {meta.raw && meta.raw.length > 0 && (
        <details className="ai-raw">
          <summary>原始元数据（{meta.raw.length}）</summary>
          {meta.raw.map((r, i) => (
            <div className="ai-raw-item" key={`${r.key}-${i}`}>
              <div className="ai-block-head">
                <span className="ai-block-label">{r.key}</span>
                <CopyButton text={r.text} copyKey={`raw-${i}`} copiedKey={copiedKey} onCopy={onCopy} />
              </div>
              <pre className="ai-raw-text">{r.text}</pre>
            </div>
          ))}
        </details>
      )}

      {hasPrompt && (
        <button type="button" className={`ai-copy-all${copiedKey === 'all' ? ' copied' : ''}`}
          onClick={() => onCopy(buildAiCopyText(meta), 'all')}>
          {copiedKey === 'all' ? '已复制全部' : '复制全部'}
        </button>
      )}
    </div>
  );
}

/**
 * 缩略图条虚拟化：算出要渲染的那一段（并保证 currentIndex 一定在段内）。
 * 窗口按 THUMB_STEP 对齐，避免每切一张就整体重排。
 */
function getThumbWindow(currentIndex, total) {
  const span = 2 * THUMB_RADIUS + THUMB_STEP;
  const maxStart = Math.max(0, total - span);
  const start = Math.max(0, Math.min(
    Math.floor((currentIndex - THUMB_RADIUS) / THUMB_STEP) * THUMB_STEP,
    maxStart
  ));
  return {
    start,
    end: Math.min(total, start + span),
    leading: start > 0 ? start * THUMB_ITEM_WIDTH - 4 : 0,
    trailing: total > start + span ? (total - (start + span)) * THUMB_ITEM_WIDTH - 4 : 0
  };
}

/** 已加载路径集合：只保留最近 MAX_READY_PATHS 个（Set 保持插入顺序） */
function pruneReadyPaths(set) {
  while (set.size > MAX_READY_PATHS) {
    const oldest = set.values().next();
    if (oldest.done) break;
    set.delete(oldest.value);
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN');
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
