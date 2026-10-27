# 手机端防熄屏（Screen Wake Lock）设计

日期：2026-10-27
状态：已确认，待实现

## 问题

在手机浏览器 / PWA 里打开大图查看时，系统按灭屏时间（常见 30 秒 ~ 2 分钟）自动锁屏，
看图、翻页、幻灯片播放都会被中断，需要反复解锁。桌面端长时间看大图时屏保/休眠也会打断。

## 目标

打开灯箱（大图查看）期间保持屏幕常亮，关闭灯箱后恢复系统默认行为。视频在灯箱内播放，
因此自然覆盖；不再单独处理视频播放器。

## 方案

使用标准 [Screen Wake Lock API](https://w3c.github.io/screen-wake-lock/)：
`navigator.wakeLock.request('screen')` 申请，`sentinel.release()` 释放。

封装为可复用的 hook：

```
client/src/hooks/useWakeLock.js
useWakeLock(active: boolean): void
```

### 行为

- `active === true` 且 `'wakeLock' in navigator` 时申请 screen 锁
- `active` 变 `false`、组件卸载、或浏览器触发 `release` 事件时释放
- `document.visibilitychange`：页面回到前台且仍 `active` 时重新申请
  （浏览器在切到后台时会自动释放锁，不重新申请的话回来后就不再常亮）
- `NotAllowedError`（低电量模式、无用户手势等）、浏览器完全不支持：静默降级，
  不抛异常、不打扰用户
- 用 ref 保存当前 sentinel：避免重复申请，避免对已释放的锁重复 release

### 集成

`client/src/components/Lightbox.jsx` 调用 `useWakeLock(true)`——灯箱挂载即常亮，
卸载即释放。所有设备生效，不做窄屏/触屏判断。

### 不做的事

- 旧版 iOS（< 16.4）的静音循环视频兜底：耗电且会露出播放图标，明确放弃
- 手动开关按钮、超时自动关闭：灯箱关闭即释放，无需额外状态
- 修改视频播放器：`<video>` 播放时多数移动浏览器本身保持亮屏，wake lock 只做兜底
- 不做界面提示：保持顶栏简洁，静默生效

## 错误与降级

| 情况 | 行为 |
|---|---|
| 浏览器无 `navigator.wakeLock` | 直接返回，不申请 |
| 申请被拒绝（`NotAllowedError` / 低电量模式） | 捕获并忽略 |
| 切后台后 `release` 已触发 | 下次 `visibilitychange` 到前台时重新申请 |
| 组件卸载时锁仍存在 | 释放，避免锁泄漏 |

## 验证

现有测试均为服务端 `node:test`，前端不引入测试框架。用无头 Chrome（CDP）验证：

1. 桩替换 `navigator.wakeLock`，记录 `request` / `release` 调用
2. 打开灯箱 → 断言申请 1 次
3. 模拟 `visibilitychange`（后台 → 前台）→ 断言重新申请
4. 关闭灯箱 → 断言释放
5. 删除 `navigator.wakeLock` 后重复打开/关闭 → 不报错

## 兼容性

- iOS Safari 16.4+、Android Chrome 84+、桌面 Chrome/Edge 84+ 支持
- 不支持时静默跳过，功能退化为原有行为
