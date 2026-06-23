import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';
import { TaskPoint } from '../state/TaskStatus.js';
import { VideoManager } from '../managers/VideoManager.js';
import { RecoverManager } from '../managers/RecoverManager.js';
import { VideoDetector } from '../detectors/VideoDetector.js';

/**
 * 视频任务执行器
 * 负责播放视频并等待完成：
 * - 使用 VideoManager 查找视频、等待元数据、判断完成
 * - 设置防暂停保护（覆盖 pause、拦截失焦事件、定时保活）
 * - 处理播放失败和恢复（RecoverManager.retry）
 */
export class VideoExecutor {
  private videoManager: VideoManager;
  private recoverManager: RecoverManager;

  constructor(videoManager?: VideoManager, recoverManager?: RecoverManager) {
    this.videoManager = videoManager ?? new VideoManager();
    this.recoverManager = recoverManager ?? new RecoverManager();
  }

  /**
   * 执行视频任务：播放视频并等待完成
   */
  async execute(task: TaskPoint): Promise<boolean> {
    logger.log('VIDEO', `开始执行视频任务: ${task.id} (${task.signature})`);

    const result = await this.recoverManager.retry(async () => {
      return await this.playVideoToComplete();
    });

    if (result) {
      logger.success('视频任务执行完成');
    } else {
      logger.error('视频任务执行失败');
    }

    return result ?? false;
  }

  /**
   * 播放视频至完成
   * 查找视频 → 等待元数据 → 防暂停保护 → 开始播放 → 轮询等待完成
   */
  private async playVideoToComplete(): Promise<boolean> {
    // 1. 查找可播放视频
    const video = await this.videoManager.findPlayableVideo();
    if (!video) {
      logger.warning('未找到可播放视频');
      return false;
    }

    // 2. 等待视频元数据加载
    const metadataLoaded = await this.videoManager.waitMetadata(video);
    if (!metadataLoaded) {
      logger.warning('视频元数据加载失败');
      return false;
    }

    // 3. 设置防暂停保护
    await this.setupAntiPause(video);

    // 4. 开始播放
    const started = await this.startPlayback(video);
    if (!started) {
      return false;
    }

    // 5. 轮询等待完成
    return await this.waitForCompletion(video);
  }

  /**
   * 设置防暂停保护
   * 覆盖 pause 方法、拦截失焦/可见性事件、定时保活恢复播放
   */
  private async setupAntiPause(video: any): Promise<void> {
    try {
      await video.evaluate(
        (el: HTMLVideoElement, keepAliveInterval: number) => {
          const win = window as Window & {
            __chaoxingAutoStop?: boolean;
            __chaoxingKeepAlive?: number;
          };
          win.__chaoxingAutoStop = false;

          // 保存原始 pause 方法
          const originalPause = el.pause.bind(el);
          (el as HTMLVideoElement & { __chaoxingOriginalPause?: () => void }).__chaoxingOriginalPause = originalPause;

          // 覆盖 pause 方法：未结束时忽略暂停请求
          el.pause = function () {
            if (win.__chaoxingAutoStop) {
              return originalPause();
            }
            if (el.ended) {
              return originalPause();
            }
            return undefined;
          };

          // 拦截 pause 事件
          el.addEventListener(
            'pause',
            (e) => {
              if (win.__chaoxingAutoStop) return;
              if (el.ended) return;
              e.stopImmediatePropagation();
              el.play().catch(() => {});
            },
            true
          );

          // 拦截可见性变化
          document.addEventListener(
            'visibilitychange',
            (e) => {
              if (win.__chaoxingAutoStop) return;
              if (el.ended) return;
              e.stopImmediatePropagation();
              if (document.hidden) {
                el.play().catch(() => {});
              }
            },
            true
          );

          // 拦截窗口失焦
          window.addEventListener(
            'blur',
            (e) => {
              if (win.__chaoxingAutoStop) return;
              if (el.ended) return;
              e.stopImmediatePropagation();
              el.play().catch(() => {});
            },
            true
          );

          // 拦截鼠标离开
          document.addEventListener(
            'mouseout',
            (e) => {
              if (win.__chaoxingAutoStop) return;
              if (el.ended) return;
              if (e.target === document || (e.target as Element)?.tagName === 'HTML') {
                e.stopImmediatePropagation();
                el.play().catch(() => {});
              }
            },
            true
          );

          // 定时保活：检查暂停并恢复
          if (win.__chaoxingKeepAlive) {
            clearInterval(win.__chaoxingKeepAlive);
          }
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
          }, keepAliveInterval);
        },
        TimingConfig.VIDEO_CHECK_INTERVAL
      );
      logger.debug('已设置防暂停保护');
    } catch (error) {
      logger.debug(`设置防暂停保护失败: ${String(error)}`);
    }
  }

  /**
   * 开始播放视频
   * 设置静音、自动播放、倍速，并触发 play()
   */
  private async startPlayback(video: any): Promise<boolean> {
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
      return true;
    } catch (error) {
      logger.error(`视频播放启动失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 轮询等待视频完成
   * 多信号联合判断完成 + 暂停恢复 + 卡顿检测
   */
  private async waitForCompletion(video: any): Promise<boolean> {
    const page = getLearningPage();
    let lastTime = -1;
    let lastChangeTime = Date.now();

    while (true) {
      // 多信号联合判断完成
      const completed = await this.videoManager.isVideoComplete(video);
      if (completed) {
        logger.success('视频播放完成（多信号判断）');
        return true;
      }

      try {
        const info = await VideoDetector.getVideoInfo(video);

        // 进度日志
        if (info.currentTime !== lastTime) {
          lastTime = info.currentTime;
          lastChangeTime = Date.now();
          const progress = info.duration > 0 ? (info.currentTime / info.duration) * 100 : 0;
          logger.debug(
            `播放进度: ${progress.toFixed(1)}% (${Math.floor(info.currentTime)}/${Math.floor(info.duration)}s)`
          );
        }

        // 检测暂停并恢复
        if (info.paused && info.duration > 0) {
          logger.debug('视频已暂停，尝试恢复播放');
          await video
            .evaluate((el: HTMLVideoElement) => {
              el.muted = true;
              el.play().catch(() => {});
            })
            .catch(() => {});
        }

        // 卡顿检测：长时间无进度则判定失败，触发重试恢复
        const stalledMs = Date.now() - lastChangeTime;
        if (stalledMs > TimingConfig.WATCHDOG_TIMEOUT) {
          logger.warning(`视频长时间无进度 (${Math.floor(stalledMs / 1000)}s)，判定播放失败`);
          return false;
        }
      } catch {
        // 忽略进度查询错误
      }

      await page.waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL).catch(() => {});
    }
  }
}
