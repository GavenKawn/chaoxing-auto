import { Page, Frame } from 'playwright';
import { getPage, getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';

// 视频信息接口
export interface VideoInfo {
  element: any;
  duration: number;
  currentTime: number;
  paused: boolean;
  title?: string;
}

type StopCheck = () => boolean;

// 查找所有 frame 中的 video 元素（匹配参考项目的嵌套 iframe 结构）
// 参考项目逻辑：$("iframe").eq(0).contents().find("iframe.ans-insertvideo-online").contents().find("video#video_html5_api")
export const findVideoInFrames = async (): Promise<any | null> => {
  try {
    const page = getLearningPage();
    const frames = page.frames();

    logger.debug(`开始检测视频，frame 数量: ${frames.length}`);
    logger.debug(`当前页面 URL: ${page.url()}`);

    // 策略1：查找嵌套 iframe 中的 video#video_html5_api（学习通标准结构）
    // 参考项目：先找外层 iframe，再找内层 iframe.ans-insertvideo-online，最后找 video#video_html5_api
    for (const frame of frames) {
      try {
        // 在当前 frame 中查找 iframe.ans-insertvideo-online
        const videoIframes = await frame.$$('iframe.ans-insertvideo-online');
        for (const videoIframe of videoIframes) {
          try {
            // 获取内层 iframe 的 content frame
            const contentFrame = await videoIframe.contentFrame();
            if (contentFrame) {
              // 在内层 iframe 中查找 video#video_html5_api
              const video = await contentFrame.$('video#video_html5_api');
              if (video) {
                logger.success('在嵌套 iframe.ans-insertvideo-online 中找到 video#video_html5_api');
                return video;
              }

              // 也尝试查找任意 video
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

        // 尝试用 locator 查找
        const videoCount = await frame.locator('video').count().catch(() => 0);
        if (videoCount > 0) {
          const handle = await frame.locator('video').first().elementHandle().catch(() => null);
          if (handle) {
            logger.success(`通过 locator 找到 video 元素 (count: ${videoCount})`);
            return handle;
          }
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
};

// 检测当前页面是否有视频（立即）
export const hasVideoOnCurrentPage = async (): Promise<boolean> => {
  try {
    const video = await findVideoInFrames();
    return !!video;
  } catch {
    return false;
  }
};

// 等待当前页面出现视频
export const waitForVideoOnCurrentPage = async (
  timeout: number = 15000,
  shouldStop?: StopCheck
): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (shouldStop?.()) {
      logger.info('已停止检测视频');
      return false;
    }

    try {
      const video = await findVideoInFrames();
      if (video) {
        logger.success('已检测到当前页面视频');
        return true;
      }

      const page = getLearningPage();
      const frameCount = page.frames().length;
      logger.debug(`当前页面 iframe 数量: ${frameCount}，暂未检测到 video`);

      await page.waitForTimeout(1000);
    } catch (error) {
      logger.debug(`检测视频失败: ${error}`);
    }
  }

  return false;
};

// 获取视频信息
export const getVideoInfo = async (video: any): Promise<VideoInfo> => {
  try {
    const duration = await video.evaluate((el: HTMLVideoElement) => el.duration || 0);
    const currentTime = await video.evaluate((el: HTMLVideoElement) => el.currentTime || 0);
    const paused = await video.evaluate((el: HTMLVideoElement) => el.paused);

    return {
      element: video,
      duration: isNaN(duration) ? 0 : duration,
      currentTime: isNaN(currentTime) ? 0 : currentTime,
      paused,
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

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 播放视频（增强版，带重试机制）
export const playVideo = async (video: any): Promise<void> => {
  const tryPlay = async (attempt: number = 0): Promise<void> => {
    try {
      await video.evaluate((el: HTMLVideoElement) => {
        // 静音
        el.muted = true;

        // 设置自动播放
        el.autoplay = true;

        // 设置播放速率（1.5-2.0倍速）
        el.playbackRate = 1.5 + Math.random() * 0.5;

        // 如果视频暂停则播放
        if (el.paused) {
          el.play().catch(() => {});
        }
      });

      logger.success('视频播放控制已设置');
    } catch (error) {
      if (attempt < 3) {
        logger.debug(`播放设置失败，重试 ${attempt + 1}/3: ${error}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return tryPlay(attempt + 1);
      }
      throw error;
    }
  };

  await tryPlay();
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 防止视频暂停（增强版，带保活机制）
// 关键修复：视频 ended 后不再恢复播放，否则会导致视频无法结束
export const preventPause = async (video: any): Promise<void> => {
  await video.evaluate((el: HTMLVideoElement) => {
    const win = window as typeof window & {
      __chaoxingAutoStop?: boolean;
      __chaoxingKeepAlive?: number;
    };
    win.__chaoxingAutoStop = false;

    // 保存原始 pause 方法
    const originalPause = el.pause.bind(el);
    (el as HTMLVideoElement & { __chaoxingOriginalPause?: () => void }).__chaoxingOriginalPause = originalPause;

    // 覆盖 pause 方法
    el.pause = function() {
      if (win.__chaoxingAutoStop) {
        return originalPause();
      }
      // 视频已结束时不拦截 pause
      if (el.ended) {
        return originalPause();
      }
      // 忽略暂停请求
      return undefined;
    };

    // 拦截 pause 事件
    el.addEventListener('pause', (e) => {
      if (win.__chaoxingAutoStop) return;
      // 视频已结束时不恢复播放
      if (el.ended) return;
      e.stopImmediatePropagation();
      el.play().catch(() => {});
    }, true);

    // 拦截失去焦点事件
    document.addEventListener('visibilitychange', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      e.stopImmediatePropagation();
      if (document.hidden) {
        el.play().catch(() => {});
      }
    }, true);

    // 拦截窗口失焦事件
    window.addEventListener('blur', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      e.stopImmediatePropagation();
      el.play().catch(() => {});
    }, true);

    // 拦截鼠标离开事件
    document.addEventListener('mouseout', (e) => {
      if (win.__chaoxingAutoStop) return;
      if (el.ended) return;
      if (e.target === document || (e.target as Element)?.tagName === 'HTML') {
        e.stopImmediatePropagation();
        el.play().catch(() => {});
      }
    }, true);

    // 定时保活：每 3 秒检查一次，如果暂停了就恢复播放
    if (win.__chaoxingKeepAlive) {
      clearInterval(win.__chaoxingKeepAlive);
    }
    win.__chaoxingKeepAlive = window.setInterval(() => {
      if (win.__chaoxingAutoStop) {
        clearInterval(win.__chaoxingKeepAlive!);
        return;
      }
      // 视频已结束时不恢复播放
      if (el.ended) {
        clearInterval(win.__chaoxingKeepAlive!);
        return;
      }
      if (el.paused && !el.ended) {
        console.log('[chaoxing-auto] 定时保活：恢复播放');
        el.play().catch(() => {});
      }
    }, 3000);
  });

  logger.debug('已设置防暂停保护和保活机制');
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 停止当前页面所有视频播放（增强版，清理保活定时器）
export const stopCurrentVideos = async (): Promise<void> => {
  const page = getLearningPage();

  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const win = window as typeof window & {
        __chaoxingAutoStop?: boolean;
        __chaoxingKeepAlive?: number;
      };
      win.__chaoxingAutoStop = true;

      // 清理保活定时器
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

// 获取当前视频身份，用于判断是否真的跳到了新视频（增强版）
export const getCurrentVideoSignature = async (): Promise<string> => {
  const page = getLearningPage();
  const video = await findVideoInFrames();

  if (!video) {
    return `${page.url()}|no-video`;
  }

  const meta = await video.evaluate((el: HTMLVideoElement) => ({
    src: el.currentSrc || el.src || '',
    duration: Number.isFinite(el.duration) ? Math.floor(el.duration) : 0,
    poster: el.poster || '',
    currentTime: Number.isFinite(el.currentTime) ? Math.floor(el.currentTime) : 0,
  })).catch(() => ({ src: '', duration: 0, poster: '', currentTime: 0 }));

  // 尝试获取当前选中的目录文字（学习通特有）
  const catalogText = await page.evaluate(() => {
    const selected = document.querySelector('.posCatalog_select, .catalog_selected, [class*="current"], [class*="active"]');
    return selected?.textContent?.trim() || '';
  }).catch(() => '');

  // 组合多个维度：页面URL + 视频src + 时长 + 当前时间 + 目录文字
  return `${page.url()}|${meta.src}|${meta.duration}|${meta.currentTime}|${catalogText}`;
};

export const waitForDifferentVideo = async (
  previousSignature: string,
  timeout: number = 10000,
  shouldStop?: StopCheck
): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (shouldStop?.()) return false;

    const currentSignature = await getCurrentVideoSignature().catch(() => '');
    if (currentSignature && currentSignature !== previousSignature && !currentSignature.endsWith('|no-video')) {
      return true;
    }

    await getLearningPage().waitForTimeout(1000).catch(() => {});
  }

  return false;
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 等待视频播放完成（增强版，同时监听 ended 事件和轮询进度）
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

    // 监听 ended 事件（参考项目的做法）
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
        // 检查 ended 标志
        const ended = await video.evaluate((el: HTMLVideoElement) => {
          return el.ended || (window as any).__chaoxingVideoEnded === true;
        }).catch(() => false);

        if (ended) {
          logger.success('视频播放完成（ended 事件）');
          finish(true);
          return;
        }

        const info = await getVideoInfo(video);

        // 如果 duration 还是 0，等待一下
        if (!durationGot && info.duration === 0) {
          logger.debug('视频时长为 0，等待加载...');
          setTimeout(checkProgress, 2000);
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

        // 检查是否播放完成
        if (info.duration > 0 && info.currentTime >= info.duration - 0.5) {
          logger.success('视频播放完成（进度到达终点）');
          finish(true);
          return;
        }

        // 继续检查
        setTimeout(checkProgress, 1000);
      } catch (error) {
        logger.debug('检查视频进度出错');
        setTimeout(checkProgress, 2000);
      }
    };

    // 初始等待视频加载
    setTimeout(checkProgress, 1000);
  });
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 完整的视频播放流程
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
