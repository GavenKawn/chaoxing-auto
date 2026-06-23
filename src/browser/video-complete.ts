import { getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';
import { VideoManager } from './managers/VideoManager.js';
import { TimingConfig } from '../utils/TimingConfig.js';
import { getVideoInfo } from './video-player.js';
import { preventPause, playVideo, stopCurrentVideos } from './video-player.js';
import { findVideoInFrames } from './video-search.js';

type StopCheck = () => boolean;

/**
 * 视频完成模块
 * 负责等待视频播放完成、完整播放流程
 * 委托 VideoManager 的多信号联合判断
 */

// [备用方案] 等待视频播放完成（监听 ended 事件和轮询进度）
export const waitForVideoEnd = async (
  video: any,
  onProgress?: (progress: number, currentTime: number, duration: number) => void,
  shouldStop?: StopCheck
): Promise<boolean> => {
  return new Promise((resolve) => {
    let lastTime = 0;
    let durationGot = false;
    let resolved = false;

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    // 监听 ended 事件
    video.evaluate((el: HTMLVideoElement) => {
      el.addEventListener('ended', () => {
        (window as any).__chaoxingVideoEnded = true;
      });
    }).catch(() => {});

    const checkProgress = async () => {
      if (shouldStop?.()) {
        logger.info('视频播放已停止');
        finish(false);
        return;
      }

      try {
        const ended = await video.evaluate((el: HTMLVideoElement) => {
          return el.ended || (window as any).__chaoxingVideoEnded === true;
        }).catch(() => false);

        if (ended) {
          logger.success('视频播放完成（ended 事件）');
          finish(true);
          return;
        }

        const info = await getVideoInfo(video);

        if (!durationGot && info.duration === 0) {
          logger.debug('视频时长为 0，等待加载...');
          setTimeout(checkProgress, TimingConfig.LONG_DELAY);
          return;
        }

        if (info.duration > 0 && !durationGot) {
          durationGot = true;
          logger.info(`视频总时长: ${Math.floor(info.duration)}秒`);
        }

        if (info.currentTime !== lastTime) {
          lastTime = info.currentTime;
          const progress = info.duration > 0 ? (info.currentTime / info.duration) * 100 : 0;
          if (onProgress) {
            onProgress(progress, info.currentTime, info.duration);
          }
        }

        if (info.duration > 0 && info.currentTime >= info.duration - 0.5) {
          logger.success('视频播放完成（进度到达终点）');
          finish(true);
          return;
        }

        setTimeout(checkProgress, TimingConfig.VIDEO_CHECK_INTERVAL);
      } catch (error) {
        logger.debug('检查视频进度出错');
        setTimeout(checkProgress, TimingConfig.LONG_DELAY);
      }
    };

    setTimeout(checkProgress, TimingConfig.VIDEO_CHECK_INTERVAL);
  });
};

// [备用方案] 完整的视频播放流程
// 委托 VideoManager 的多信号联合判断完成
export const playVideoComplete = async (
  onProgress?: (progress: number, currentTime: number, duration: number) => void,
  shouldStop?: StopCheck
): Promise<boolean> => {
  const page = getLearningPage();

  try {
    if (shouldStop?.()) return false;

    // 重置视频结束标志
    await page.evaluate(() => {
      (window as any).__chaoxingVideoEnded = false;
    }).catch(() => {});

    // 查找视频元素
    logger.info('正在查找视频元素...');
    const video = await findVideoInFrames();

    if (!video) {
      logger.warning('未找到视频元素');
      return false;
    }

    // 获取视频信息
    const info = await getVideoInfo(video);
    logger.info(`找到视频，当前进度: ${Math.floor(info.currentTime)}秒 / ${Math.floor(info.duration)}秒`);

    // 设置防暂停
    await preventPause(video);

    // 开始播放
    await playVideo(video);

    // 等待播放完成
    const completed = await waitForVideoEnd(video, onProgress, shouldStop);
    if (!completed) {
      await stopCurrentVideos();
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`视频播放出错: ${error}`);
    return false;
  }
};
