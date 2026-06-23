import { getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';
import { VideoDetector } from './detectors/VideoDetector.js';
import { TimingConfig } from '../utils/TimingConfig.js';

type StopCheck = () => boolean;

/**
 * 视频搜索模块
 * 负责在 frame 中查找视频元素、检测页面是否有视频、等待视频出现
 * 统一委托 VideoDetector，禁止 locator('video') 散落
 */

// 查找所有 frame 中的 video 元素（委托 VideoDetector）
export const findVideoInFrames = async (): Promise<any | null> => {
  return await VideoDetector.findVideoInFrames();
};

// 检测当前页面是否有视频（立即）
export const hasVideoOnCurrentPage = async (): Promise<boolean> => {
  return await VideoDetector.hasVideoOnCurrentPage();
};

// 等待当前页面出现视频
export const waitForVideoOnCurrentPage = async (
  timeout: number = TimingConfig.METADATA_TIMEOUT,
  shouldStop?: StopCheck
): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (shouldStop?.()) {
      logger.info('已停止检测视频');
      return false;
    }

    try {
      const video = await VideoDetector.findVideoInFrames();
      if (video) {
        logger.success('已检测到当前页面视频');
        return true;
      }

      const page = getLearningPage();
      const frameCount = page.frames().length;
      logger.debug(`当前页面 iframe 数量: ${frameCount}，暂未检测到 video`);

      await page.waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL);
    } catch (error) {
      logger.debug(`检测视频失败: ${error}`);
    }
  }

  return false;
};
