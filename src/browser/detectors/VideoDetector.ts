import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';

/**
 * 视频检测器
 * 统一 findPlayableVideo() 逻辑，禁止 locator('video') 散落
 */
export class VideoDetector {
  // 查找所有 frame 中的 video 元素
  static async findVideoInFrames(): Promise<any | null> {
    try {
      const page = getLearningPage();
      const frames = page.frames();

      logger.debug(`开始检测视频，frame 数量: ${frames.length}`);

      // 策略1：查找嵌套 iframe 中的 video#video_html5_api
      for (const frame of frames) {
        try {
          const videoIframes = await frame.$$('iframe.ans-insertvideo-online');
          for (const videoIframe of videoIframes) {
            try {
              const contentFrame = await videoIframe.contentFrame();
              if (contentFrame) {
                const video = await contentFrame.$('video#video_html5_api');
                if (video) {
                  logger.success('在嵌套 iframe.ans-insertvideo-online 中找到 video#video_html5_api');
                  return video;
                }
                const anyVideo = await contentFrame.$('video');
                if (anyVideo) {
                  logger.success('在嵌套 iframe.ans-insertvideo-online 中找到 video 元素');
                  return anyVideo;
                }
              }
            } catch (e) {
              logger.debug(`访问 iframe.contentFrame 失败: ${e}`);
            }
          }
        } catch (error) {
          logger.debug(`检测嵌套 iframe 失败: ${error}`);
        }
      }

      // 策略2：直接在所有 frame 中查找 video#video_html5_api
      for (const frame of frames) {
        try {
          const video = await frame.$('video#video_html5_api');
          if (video) {
            logger.success('找到 video#video_html5_api 元素');
            return video;
          }
        } catch (error) {
          logger.debug(`检测 video#video_html5_api 失败: ${error}`);
        }
      }

      // 策略3：Fallback 查找任意 video 元素
      for (const frame of frames) {
        try {
          const video = await frame.$('video');
          if (video) {
            logger.success('在 frame 中找到 video 元素（fallback）');
            return video;
          }
        } catch (error) {
          logger.debug(`检测 frame 视频失败: ${error}`);
        }
      }

      logger.debug('未在任何 frame 中找到 video 元素');
      return null;
    } catch (error) {
      logger.debug(`查找 video 出错: ${error}`);
      return null;
    }
  }

  // 检测当前页面是否有视频
  static async hasVideoOnCurrentPage(): Promise<boolean> {
    try {
      const video = await this.findVideoInFrames();
      return !!video;
    } catch {
      return false;
    }
  }

  // 获取视频信息
  static async getVideoInfo(video: any): Promise<{
    duration: number;
    currentTime: number;
    paused: boolean;
  }> {
    try {
      const duration = await video.evaluate((el: HTMLVideoElement) => el.duration || 0);
      const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime || 0);
      const paused = await video.evaluate((el: HTMLVideoElement) => el.paused);

      return {
        duration: isNaN(duration) ? 0 : duration,
        currentTime: isNaN(currentTime) ? 0 : currentTime,
        paused,
      };
    } catch (error) {
      logger.debug(`获取视频信息失败: ${error}`);
      return { duration: 0, currentTime: 0, paused: true };
    }
  }
}
