import { getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';
import { VideoManager } from './managers/VideoManager.js';
import { TimingConfig } from '../utils/TimingConfig.js';
import { findVideoInFrames } from './video-search.js';

type StopCheck = () => boolean;

/**
 * 视频签名模块
 * 负责生成视频唯一标识、等待视频切换
 * 委托 VideoManager 的多维度签名生成
 */

// 获取当前视频身份，用于判断是否真的跳到了新视频
// 委托 VideoManager 的多维度签名（courseid + clazzid + knowledgeid + frame.url + currentSrc + videoIndex）
export const getCurrentVideoSignature = async (): Promise<string> => {
  const page = getLearningPage();
  const video = await findVideoInFrames();

  if (!video) {
    return `${page.url()}|no-video`;
  }

  const videoManager = new VideoManager();
  return await videoManager.getCurrentVideoSignature(video, 0);
};

// 等待切换到不同的视频
export const waitForDifferentVideo = async (
  previousSignature: string,
  timeout: number = TimingConfig.METADATA_TIMEOUT,
  shouldStop?: StopCheck
): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (shouldStop?.()) return false;

    const currentSignature = await getCurrentVideoSignature().catch(() => '');
    if (currentSignature && currentSignature !== previousSignature && !currentSignature.endsWith('|no-video')) {
      return true;
    }

    await getLearningPage().waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL).catch(() => {});
  }

  return false;
};
