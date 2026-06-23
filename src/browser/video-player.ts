import { getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';
import { VideoDetector } from './detectors/VideoDetector.js';
import { TimingConfig } from '../utils/TimingConfig.js';

/**
 * 视频播放器模块
 * 负责视频信息获取、播放控制、防暂停保护、停止播放
 */

// 视频信息接口
export interface VideoInfo {
  element: any;
  duration: number;
  currentTime: number;
  paused: boolean;
  title?: string;
}

// 获取视频信息（委托 VideoDetector）
export const getVideoInfo = async (video: any): Promise<VideoInfo> => {
  try {
    const info = await VideoDetector.getVideoInfo(video);
    return {
      element: video,
      duration: info.duration,
      currentTime: info.currentTime,
      paused: info.paused,
    };
  } catch (error) {
    logger.debug(`获取视频信息失败: ${error}`);
    return {
      element: video,
      duration: 0,
      currentTime: 0,
      paused: true,
    };
  }
};

// [备用方案] 播放视频（带重试机制）
export const playVideo = async (video: any): Promise<void> => {
  const tryPlay = async (attempt: number = 0): Promise<void> => {
    try {
      await video.evaluate((el: HTMLVideoElement) => {
        el.muted = true;
        el.autoplay = true;
        el.playbackRate = TimingConfig.PLAYBACK_RATE;
        if (el.paused) {
          el.play().catch(() => {});
        }
      });

      logger.success('视频播放控制已设置');
    } catch (error) {
      if (attempt < 3) {
        logger.debug(`播放设置失败，重试 ${attempt + 1}/3: ${error}`);
        await new Promise(resolve => setTimeout(resolve, TimingConfig.MEDIUM_DELAY));
        return tryPlay(attempt + 1);
      }
      throw error;
    }
  };

  await tryPlay();
};

// [备用方案] 防止视频暂停（带保活机制）
// 关键修复：视频 ended 后不再恢复播放，否则会导致视频无法结束
export const preventPause = async (video: any): Promise<void> => {
  await video.evaluate((el: HTMLVideoElement) => {
    const win = window as typeof window & {
      __chaoxingAutoStop?: boolean;
      __chaoxingKeepAlive?: number;
    };
    win.__chaoxingAutoStop = false;

    const originalPause = el.pause.bind(el);
    (el as HTMLVideoElement & { __chaoxingOriginalPause?: () => void }).__chaoxingOriginalPause = originalPause;

    el.pause = function() {
      if (win.__chaoxingAutoStop) return originalPause();
      if (el.ended) return originalPause();
      return undefined;
    };

    el.addEventListener('pause', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      e.stopImmediatePropagation();
      el.play().catch(() => {});
    }, true);

    document.addEventListener('visibilitychange', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      e.stopImmediatePropagation();
      if (document.hidden) el.play().catch(() => {});
    }, true);

    window.addEventListener('blur', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      e.stopImmediatePropagation();
      el.play().catch(() => {});
    }, true);

    document.addEventListener('mouseout', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      if (e.target === document || (e.target as Element)?.tagName === 'HTML') {
        e.stopImmediatePropagation();
        el.play().catch(() => {});
      }
    }, true);

    if (win.__chaoxingKeepAlive) clearInterval(win.__chaoxingKeepAlive);
    win.__chaoxingKeepAlive = window.setInterval(() => {
      if (win.__chaoxingAutoStop) {
        clearInterval(win.__chaoxingKeepAlive!);
        return;
      }
      if (el.ended) {
        clearInterval(win.__chaoxingKeepAlive!);
        return;
      }
      if (el.paused && !el.ended) {
        el.play().catch(() => {});
      }
    }, TimingConfig.VIDEO_CHECK_INTERVAL);
  });

  logger.debug('已设置防暂停保护和保活机制');
};

// [备用方案] 停止当前页面所有视频播放（清理保活定时器）
export const stopCurrentVideos = async (): Promise<void> => {
  const page = getLearningPage();

  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const win = window as typeof window & {
        __chaoxingAutoStop?: boolean;
        __chaoxingKeepAlive?: number;
      };
      win.__chaoxingAutoStop = true;

      if (win.__chaoxingKeepAlive) {
        clearInterval(win.__chaoxingKeepAlive);
        win.__chaoxingKeepAlive = undefined;
      }

      for (const video of Array.from(document.querySelectorAll('video'))) {
        const el = video as HTMLVideoElement & { __chaoxingOriginalPause?: () => void };
        if (el.__chaoxingOriginalPause) {
          el.__chaoxingOriginalPause();
        } else {
          el.pause();
        }
      }
    }).catch(() => {});
  }
};
