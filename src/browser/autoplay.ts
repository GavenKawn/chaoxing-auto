import { getPage, getLearningPage } from './launcher.js';
import { logger, LogLevel } from '../utils/logger.js';
import { AUTOPLAY_SCRIPT } from './autoplay-script.js';

// 注入自动播放脚本
export const injectAutoplay = async (): Promise<boolean> => {
  const page = getLearningPage();

  if (!page) {
    logger.error('[SYSTEM] 注入失败：无法获取页面对象');
    return false;
  }

  try {
    logger.log('SYSTEM', '准备注入自动播放脚本...');

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);

    const active = await page.evaluate(() => {
      return (window as any).__chaoxingAutoplayActive === true;
    }).catch((e: any) => {
      logger.log('SYSTEM', `检查脚本状态失败: ${e.message}`, LogLevel.DEBUG);
      return false;
    });

    if (active) {
      logger.log('SYSTEM', '自动播放脚本已在运行，先停止再重新启动');
      await page.evaluate(() => {
        (window as any).__chaoxingAutoStop = true;
        (window as any).__chaoxingAutoplayActive = false;
      }).catch(() => {});
      await page.waitForTimeout(500);
    }

    await page.evaluate(() => {
      (window as any).__chaoxingAutoStop = false;
      (window as any).__chaoxingAutoplayActive = false;
      (window as any).__chaoxingStatus = null;
    }).catch(() => {});

    logger.log('SYSTEM', '开始注入脚本...');

    let injected = false;
    for (let i = 0; i < 3; i++) {
      try {
        await page.evaluate(AUTOPLAY_SCRIPT);
        logger.log('SYSTEM', `注入尝试 ${i + 1} 执行完成`);

        injected = await page.evaluate(() => {
          return !!(window as any).__chaoxingAutoplayActive;
        }).catch(() => false);

        if (injected) {
          logger.success('[SYSTEM] 自动播放脚本已注入页面');
          return true;
        }
      } catch (e: any) {
        logger.log('SYSTEM', `注入尝试 ${i + 1} 失败: ${e.message}`, LogLevel.ERROR);
        await page.waitForTimeout(300);
      }
    }

    logger.error('[SYSTEM] 注入失败：多次尝试后脚本仍未成功执行');
    return false;
  } catch (error: any) {
    logger.error(`[SYSTEM] 注入自动播放脚本失败: ${error.message}`);
    return false;
  }
};

// 停止自动播放
export const stopAutoplay = async (): Promise<void> => {
  const page = getLearningPage();

  try {
    await page.evaluate(() => {
      (window as any).__chaoxingAutoStop = true;
      (window as any).__chaoxingAutoplayActive = false;
    });

    for (const frame of page.frames()) {
      await frame.evaluate(() => {
        for (const video of Array.from(document.querySelectorAll('video'))) {
          video.pause();
        }
      }).catch(() => {});
    }

    logger.log('SYSTEM', '自动播放脚本已停止');
  } catch (error) {
    logger.debug(`[SYSTEM] 停止自动播放脚本失败: ${error}`);
  }
};

// 获取自动播放状态
export const getAutoplayStatus = async (): Promise<{
  active: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  title: string;
  message: string;
  state?: string;
  taskIndex?: number;
  taskTotal?: number;
  pendingCount?: number;
  completedCount?: number;
} | null> => {
  const page = getLearningPage();

  try {
    return await page.evaluate(() => {
      return (window as any).__chaoxingStatus || null;
    });
  } catch {
    return null;
  }
};
