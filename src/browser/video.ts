/**
 * 视频模块（统一出口）
 *
 * 已拆分为单一职责的子模块：
 * - video-search.ts    视频查找与检测
 * - video-player.ts     视频播放控制与防暂停
 * - video-complete.ts   视频完成判断与完整播放流程
 * - video-signature.ts  视频签名与切换检测
 *
 * 此文件仅做 re-export，保持向后兼容。
 */

// 视频查找
export { findVideoInFrames, hasVideoOnCurrentPage, waitForVideoOnCurrentPage } from './video-search.js';

// 视频播放器
export { getVideoInfo, playVideo, preventPause, stopCurrentVideos } from './video-player.js';
export type { VideoInfo } from './video-player.js';

// 视频完成
export { waitForVideoEnd, playVideoComplete } from './video-complete.js';

// 视频签名
export { getCurrentVideoSignature, waitForDifferentVideo } from './video-signature.js';
