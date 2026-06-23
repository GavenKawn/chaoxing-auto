import { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { TaskType, isTrustedChaoxingUrl } from '../utils/config.js';
import { TaskDetector } from './detectors/TaskDetector.js';
import { TimingConfig } from '../utils/TimingConfig.js';
import type { Chapter, Task } from './course.js';

/**
 * 章节解析模块
 * 负责从页面解析章节和任务点，包括兜底扫描
 */

// 等待进入章节页
export const waitForChapterPage = async (page: Page, timeout: number = TimingConfig.METADATA_TIMEOUT): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const url = page.url();
      if (isTrustedChaoxingUrl(url) && url.includes('mooc2-ans') && url.includes('/mycourse/stu')) {
        return true;
      }

      const hasChapter = await page.locator('text=章节').count().catch(() => 0);
      const hasTask = await page.locator('text=/待完成任务点|任务点/').count().catch(() => 0);

      if ((hasChapter > 0 || hasTask > 0) && isTrustedChaoxingUrl(url)) {
        return true;
      }
    } catch {}

    await page.waitForTimeout(TimingConfig.VIDEO_CHECK_INTERVAL);
  }

  return false;
};

// 解析页面中的章节和任务点（增强版带兜底扫描）
export const parseChaptersFromPage = async (page: Page): Promise<Chapter[]> => {
  const chapters: Chapter[] = [];
  const sourceUrl = page.url();

  const chapterElements = await page.$$('.chapter, .unit, .catalog .item, .section, [class*="chapter"], [class*="unit"]');
  logger.debug(`找到 ${chapterElements.length} 个章节候选元素`);

  let totalPendingTasks = 0;

  for (const el of chapterElements) {
    try {
      const nameEl = await el.$('.chapter-name, .title, h3, [class*="title"]');
      const name = await nameEl?.textContent() || '未知章节';

      const tasks: Task[] = [];
      const taskElements = await el.$$('.task, .section, .catalog_item, [class*="task"], [class*="section"]');
      logger.debug(`章节 "${name.trim()}" 找到 ${taskElements.length} 个任务候选`);

      for (const taskEl of taskElements) {
        const taskNameEl = await taskEl.$('.task-name, .title, a, [class*="title"]');
        const taskName = await taskNameEl?.textContent() || '';

        const taskLink = await taskEl.$('a');
        let taskUrl = await taskLink?.getAttribute('href') || '';

        if (
          taskUrl.startsWith('javascript:') ||
          taskUrl.startsWith('#') ||
          taskUrl === sourceUrl ||
          taskUrl === page.url()
        ) {
          taskUrl = '';
        }

        let taskType = TaskType.VIDEO;
        if (taskName.includes('文档') || taskName.includes('ppt') || taskName.includes('PDF')) {
          taskType = TaskType.DOCUMENT;
        } else if (taskName.includes('测验') || taskName.includes('作业') || taskName.includes('考试')) {
          taskType = TaskType.QUIZ;
        }

        // 委托 TaskDetector 检测完成状态
        const completed = await TaskDetector.detectElementTaskCompleted(taskEl);

        if (!completed) {
          totalPendingTasks++;
          logger.debug(`任务 "${taskName.trim()}" 未完成`);
        }

        const selector = taskName ? `text=${taskName.trim()}` : undefined;

        tasks.push({
          id: taskUrl.match(/jobid=(\d+)/)?.[1] || '',
          name: taskName.trim(),
          type: taskType,
          url: taskUrl,
          sourceUrl,
          completed,
          selector,
        });
      }

      chapters.push({
        id: '',
        name: name.trim(),
        tasks,
      });
    } catch (e) {
      continue;
    }
  }

  // 兜底扫描
  if (chapters.length === 0) {
    logger.info('未找到标准章节结构，尝试兜底扫描...');
    const fallbackTasks = await fallbackScanForTasks(page);
    if (fallbackTasks.length > 0) {
      chapters.push({
        id: '',
        name: '任务列表',
        tasks: fallbackTasks,
      });
      totalPendingTasks = fallbackTasks.filter(t => !t.completed).length;
    }
  }

  if (totalPendingTasks > 0) {
    logger.info(`发现 ${totalPendingTasks} 个待完成任务点`);
  } else {
    logger.info('未发现待完成任务点');
  }

  logger.success(`获取到 ${chapters.length} 个章节`);
  return chapters;
};

// 兜底扫描：查找页面中所有可能的任务点
export const fallbackScanForTasks = async (page: Page): Promise<Task[]> => {
  const tasks: Task[] = [];
  const sourceUrl = page.url();

  try {
    const selectors = [
      'a[href]',
      'button',
      '[role="button"]',
      '[onclick]',
      '[class*="task"]',
      '[class*="catalog"]',
      '[class*="chapter"]',
      '[class*="section"]',
    ];

    const allElements = await page.$$(selectors.join(', '));
    logger.debug(`兜底扫描找到 ${allElements.length} 个候选元素`);

    const excludePatterns = [
      '首页', '登录', '消息', '通知', '讨论',
      '返回', '上一页', '下一页', '帮助', '设置', '退出',
    ];

    for (const el of allElements) {
      try {
        const text = await el.textContent() || '';
        const trimmedText = text.trim();

        if (
          trimmedText.length < 2 ||
          trimmedText.length > 50 ||
          excludePatterns.some(pattern => trimmedText.includes(pattern))
        ) {
          continue;
        }

        let taskUrl = await el.getAttribute('href') || '';

        if (
          taskUrl.startsWith('javascript:') ||
          taskUrl.startsWith('#') ||
          taskUrl === sourceUrl ||
          taskUrl === page.url()
        ) {
          taskUrl = '';
        }

        let taskType = TaskType.VIDEO;
        if (trimmedText.includes('文档') || trimmedText.includes('ppt') || trimmedText.includes('PDF')) {
          taskType = TaskType.DOCUMENT;
        } else if (trimmedText.includes('测验') || trimmedText.includes('作业') || trimmedText.includes('考试')) {
          taskType = TaskType.QUIZ;
        }

        const completed = await TaskDetector.detectElementTaskCompleted(el);

        tasks.push({
          id: '',
          name: trimmedText,
          type: taskType,
          url: taskUrl,
          sourceUrl,
          completed,
          selector: `text=${trimmedText}`,
        });
      } catch (e) {
        continue;
      }
    }

    logger.info(`兜底扫描找到 ${tasks.length} 个任务候选`);
  } catch (error) {
    logger.debug(`兜底扫描失败: ${error}`);
  }

  return tasks;
};
