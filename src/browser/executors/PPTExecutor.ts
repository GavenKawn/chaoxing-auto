import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';
import { TaskPoint } from '../state/TaskStatus.js';
import { TaskDetector } from '../detectors/TaskDetector.js';

// 翻页按钮选择器
const NEXT_BUTTON_SELECTORS = [
  '.nextPage',
  '.next-btn',
  '.btn-next',
  '#nextPage',
  '.layui-laypage-next',
  '.page-next',
  'button[class*="next"]',
  'a[class*="next"]',
  '.arrow-right',
  '.next',
];

// 当前页码选择器
const PAGE_CURRENT_SELECTORS = [
  '.page-current',
  '.current-page',
  '[class*="current-page"]',
  '[class*="pageCurrent"]',
];

// 总页数选择器
const PAGE_TOTAL_SELECTORS = [
  '.page-total',
  '.total-page',
  '[class*="total-page"]',
  '[class*="pageCount"]',
];

// 可滚动容器选择器
const SCROLL_CONTAINERS = [
  '.document-content',
  '.ppt-content',
  '.reader-container',
  '.flipbook',
  '.pdf-viewer',
  'body',
];

/**
 * PPT/文档任务执行器
 * 负责自动翻页 PPT/文档：
 * - 检测当前页数和总页数
 * - 翻到底后等待服务器同步
 * - 使用 TaskDetector.detectTaskCompleted() 确认完成
 */
export class PPTExecutor {
  /**
   * 执行 PPT/文档任务：自动翻页并等待完成
   */
  async execute(task: TaskPoint): Promise<boolean> {
    logger.log('PPT', `开始执行 PPT/文档任务: ${task.id}`);

    // 1. 自动翻页
    logger.info('开始自动翻页 PPT/文档');
    await this.flipPages();

    // 2. 翻到底后等待服务器同步
    logger.info('PPT 翻页完成，等待服务器同步');
    const completed = await this.waitForServerSync();

    if (completed) {
      logger.success('PPT/文档任务完成');
    } else {
      logger.warning('PPT/文档任务等待服务器同步超时');
    }

    return completed;
  }

  /**
   * 自动翻页
   * 循环翻页直到到达最后一页、无法继续翻页或达到上限
   */
  private async flipPages(): Promise<void> {
    const page = getLearningPage();
    let flipCount = 0;

    while (flipCount < TimingConfig.PPT_MAX_FLIPS) {
      // 检测当前页数和总页数
      const pageInfo = await this.getPageInfo();
      if (pageInfo.total > 0 && pageInfo.current > 0) {
        logger.debug(`PPT 当前页: ${pageInfo.current}/${pageInfo.total}`);
        if (pageInfo.current >= pageInfo.total) {
          logger.info('已翻到最后一页');
          return;
        }
      }

      // 尝试点击翻页按钮
      const flipped = await this.clickNextButton();
      if (flipped) {
        flipCount++;
        await page.waitForTimeout(TimingConfig.PPT_FLIP_INTERVAL).catch(() => {});
        continue;
      }

      // 尝试滚动到底部
      const scrolled = await this.scrollDown();
      if (scrolled) {
        flipCount++;
        await page.waitForTimeout(TimingConfig.PPT_FLIP_INTERVAL).catch(() => {});
        continue;
      }

      // 无法继续翻页，已翻完
      logger.info(`PPT/文档已翻完 (${flipCount} 页)`);
      return;
    }

    logger.info(`翻页达到上限 (${TimingConfig.PPT_MAX_FLIPS})`);
  }

  /**
   * 检测当前页数和总页数
   * 遍历所有 frame 查找页码元素
   */
  private async getPageInfo(): Promise<{ current: number; total: number }> {
    const page = getLearningPage();
    let current = 0;
    let total = 0;

    for (const frame of page.frames()) {
      if (current === 0) {
        for (const selector of PAGE_CURRENT_SELECTORS) {
          try {
            const el = await frame.$(selector);
            if (el) {
              const text = (await el.textContent()) || '';
              const match = text.match(/\d+/);
              if (match) {
                current = parseInt(match[0], 10);
                break;
              }
            }
          } catch {
            // 继续尝试下一个选择器
          }
        }
      }

      if (total === 0) {
        for (const selector of PAGE_TOTAL_SELECTORS) {
          try {
            const el = await frame.$(selector);
            if (el) {
              const text = (await el.textContent()) || '';
              const match = text.match(/\d+/);
              if (match) {
                total = parseInt(match[0], 10);
                break;
              }
            }
          } catch {
            // 继续尝试下一个选择器
          }
        }
      }

      if (current > 0 && total > 0) break;
    }

    return { current, total };
  }

  /**
   * 查找并点击翻页按钮
   * 遍历所有 frame 查找可用的下一页按钮
   */
  private async clickNextButton(): Promise<boolean> {
    const page = getLearningPage();

    for (const frame of page.frames()) {
      for (const selector of NEXT_BUTTON_SELECTORS) {
        try {
          const btn = await frame.$(selector);
          if (!btn) continue;

          // 检查按钮是否禁用
          const isDisabled = await btn
            .evaluate(
              (el) =>
                (el as HTMLButtonElement).disabled ||
                el.classList.contains('disabled')
            )
            .catch(() => false);
          if (isDisabled) continue;

          await btn.click();
          return true;
        } catch {
          // 继续尝试下一个选择器
        }
      }
    }

    return false;
  }

  /**
   * 滚动文档到底部
   * 遍历所有 frame 查找可滚动容器并滚动到底
   */
  private async scrollDown(): Promise<boolean> {
    const page = getLearningPage();

    for (const frame of page.frames()) {
      for (const selector of SCROLL_CONTAINERS) {
        try {
          const container = await frame.$(selector);
          if (!container) continue;

          const scrolled = await container
            .evaluate((el: HTMLElement) => {
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
                return true;
              }
              return false;
            })
            .catch(() => false);

          if (scrolled) return true;
        } catch {
          // 继续尝试下一个选择器
        }
      }
    }

    return false;
  }

  /**
   * 等待服务器同步
   * 翻到底后轮询 TaskDetector.detectTaskCompleted() 确认完成
   */
  private async waitForServerSync(): Promise<boolean> {
    const page = getLearningPage();
    const start = Date.now();

    while (Date.now() - start < TimingConfig.PPT_COMPLETE_WAIT) {
      const completed = await TaskDetector.detectTaskCompleted();
      if (completed) {
        logger.success('服务器同步成功，任务完成');
        return true;
      }
      await page.waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL).catch(() => {});
    }

    logger.warning('等待服务器同步超时');
    return false;
  }
}
