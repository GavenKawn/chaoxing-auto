import { getLearningPage } from '../launcher.js';
import { VideoDetector } from '../detectors/VideoDetector.js';
import { TaskDetector } from '../detectors/TaskDetector.js';
import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';

type StopCheck = () => boolean;

/**
 * 视频管理器
 * 负责视频查找、签名生成、元数据等待、播放完成判断
 */
export class VideoManager {
  /**
   * 查找可播放的视频（调用 VideoDetector）
   */
  async findPlayableVideo(): Promise<any | null> {
    return await VideoDetector.findVideoInFrames();
  }

  /**
   * 获取当前视频签名
   * 使用 courseid + clazzid + knowledgeid + frame.url + currentSrc + videoIndex 联合生成唯一签名
   * 避免多个视频被识别成同一个
   */
  async getCurrentVideoSignature(video: any, videoIndex: number = 0): Promise<string> {
    try {
      const page = getLearningPage();
      const pageUrl = page.url();

      // 从页面 URL 提取参数
      let courseId = '';
      let clazzId = '';
      let knowledgeId = '';
      let chapterId = '';
      try {
        const parsed = new URL(pageUrl);
        courseId = parsed.searchParams.get('courseId') || parsed.searchParams.get('courseid') || '';
        clazzId = parsed.searchParams.get('clazzId') || parsed.searchParams.get('clazzid') || '';
        knowledgeId = parsed.searchParams.get('knowledgeid') || parsed.searchParams.get('knowledgeId') || '';
        chapterId = parsed.searchParams.get('chapterId') || parsed.searchParams.get('chapterid') || '';
      } catch {
        // URL 解析失败时使用空值
      }

      // 从视频元素获取 currentSrc 和所在 frame 的 URL
      let currentSrc = '';
      let frameUrl = '';
      if (video) {
        try {
          const meta = await video.evaluate((el: HTMLVideoElement) => ({
            currentSrc: el.currentSrc || el.src || '',
            frameUrl: window.location.href,
          }));
          currentSrc = (meta && meta.currentSrc) || '';
          frameUrl = (meta && meta.frameUrl) || '';
        } catch {
          // 视频元素访问失败时使用空值
        }
      }

      const signature = [
        'c=' + courseId,
        'cl=' + clazzId,
        'k=' + knowledgeId,
        'ch=' + chapterId,
        'f=' + frameUrl.substring(0, 200),
        's=' + currentSrc.substring(0, 200),
        'i=' + videoIndex,
      ].join('|');

      return signature;
    } catch {
      return 'unknown_' + Date.now();
    }
  }

  /**
   * 等待视频元数据加载
   */
  async waitMetadata(
    video: any,
    timeout: number = TimingConfig.METADATA_TIMEOUT
  ): Promise<boolean> {
    if (!video) return false;

    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const info = await VideoDetector.getVideoInfo(video);
        if (info.duration > 0) {
          logger.info(`视频元数据已加载，时长: ${Math.floor(info.duration)}秒`);
          return true;
        }
      } catch {
        // 忽略查询错误，继续等待
      }
      await getLearningPage().waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL).catch(() => {});
    }

    logger.warning('等待视频元数据超时');
    return false;
  }

  /**
   * 多信号联合判断视频是否完成
   * 信号: ended + 100% + 已完成 + icon-success + task status
   */
  async isVideoComplete(video: any): Promise<boolean> {
    if (!video) return false;

    let signals = 0;
    const reasons: string[] = [];

    // 信号1: ended 事件
    try {
      const ended = await video
        .evaluate((el: HTMLVideoElement) => el.ended)
        .catch(() => false);
      if (ended) {
        signals++;
        reasons.push('ended');
      }
    } catch {
      // 忽略
    }

    // 信号2: 进度 >= 99%
    try {
      const info = await VideoDetector.getVideoInfo(video);
      if (info.duration > 0 && info.currentTime / info.duration >= 0.99) {
        signals++;
        reasons.push('progress>=99%');
      }
    } catch {
      // 忽略
    }

    // 信号3: 页面文本显示 100% 或 已完成
    try {
      const page = getLearningPage();
      const hasText = await page
        .evaluate(() => {
          const body = document.body;
          if (!body) return false;
          const text = body.innerText || '';
          return text.indexOf('100%') >= 0 || text.indexOf('已完成') >= 0;
        })
        .catch(() => false);
      if (hasText) {
        signals++;
        reasons.push('text:100%');
      }
    } catch {
      // 忽略
    }

    // 信号4: icon-success
    try {
      const page = getLearningPage();
      const hasIcon = await page
        .evaluate(() => {
          return !!document.querySelector(
            '.icon-success, [data-status*="success"], [aria-label*="success"]'
          );
        })
        .catch(() => false);
      if (hasIcon) {
        signals++;
        reasons.push('icon-success');
      }
    } catch {
      // 忽略
    }

    // 信号5: task status 完成
    try {
      const taskCompleted = await TaskDetector.detectTaskCompleted();
      if (taskCompleted) {
        signals++;
        reasons.push('task-status');
      }
    } catch {
      // 忽略
    }

    // 至少满足 1 个信号才认为完成
    if (signals > 0) {
      logger.debug(`视频完成判断通过: ${reasons.join(', ')} (signals=${signals})`);
      return true;
    }

    return false;
  }

  /**
   * 播放视频至完成
   * 多信号联合判断完成（ended + 100% + 已完成 + icon-success + task status）
   */
  async playVideoComplete(
    onProgress?: (progress: number, currentTime: number, duration: number) => void,
    shouldStop?: StopCheck
  ): Promise<boolean> {
    const page = getLearningPage();

    try {
      if (shouldStop?.()) return false;

      // 查找可播放视频
      logger.info('正在查找可播放视频...');
      const video = await this.findPlayableVideo();
      if (!video) {
        logger.warning('未找到可播放视频');
        return false;
      }

      // 等待元数据加载
      await this.waitMetadata(video);

      // 设置播放参数并开始播放
      try {
        await video.evaluate(
          (el: HTMLVideoElement, rate: number) => {
            el.muted = true;
            el.autoplay = true;
            el.playbackRate = rate;
            if (el.paused) {
              el.play().catch(() => {});
            }
          },
          TimingConfig.PLAYBACK_RATE
        );
        logger.success('视频开始播放');
      } catch (error) {
        logger.error(`视频播放设置失败: ${String(error)}`);
        return false;
      }

      // 轮询等待完成
      let lastTime = -1;
      while (!shouldStop?.()) {
        // 多信号联合判断完成
        const completed = await this.isVideoComplete(video);
        if (completed) {
          logger.success('视频播放完成（多信号判断）');
          return true;
        }

        // 报告进度并检测暂停
        try {
          const info = await VideoDetector.getVideoInfo(video);
          if (info.currentTime !== lastTime) {
            lastTime = info.currentTime;
            const progress = info.duration > 0 ? (info.currentTime / info.duration) * 100 : 0;
            if (onProgress) {
              onProgress(progress, info.currentTime, info.duration);
            }
          }

          // 检测暂停并恢复（完成判断已由 isVideoComplete 处理）
          if (info.paused && info.duration > 0) {
            logger.debug('视频已暂停，尝试恢复播放');
            await video
              .evaluate((el: HTMLVideoElement) => {
                el.muted = true;
                el.play().catch(() => {});
              })
              .catch(() => {});
          }
        } catch {
          // 忽略进度查询错误
        }

        await page.waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL).catch(() => {});
      }

      logger.info('视频播放已停止');
      return false;
    } catch (error) {
      logger.error(`视频播放出错: ${String(error)}`);
      return false;
    }
  }
}
