// vite-plugin-monkey 会提供 unsafeWindow
import { unsafeWindow } from '$';

// 当在 dev 环境中时，unsafeWindow 是 undefined
// 在真实 Tampermonkey 中，unsafeWindow 才是正确的 window
export const hostWindow = typeof unsafeWindow !== 'undefined'
  ? unsafeWindow
  : window;

// 便捷导出关键对象（可选）
export const doc = hostWindow.document;
export const loc = hostWindow.location;
export const setTimeoutHost = hostWindow.setTimeout.bind(hostWindow);
export const clearTimeoutHost = hostWindow.clearTimeout.bind(hostWindow);
export const PlayerHost = hostWindow.Player;
