import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';
import { TaskStatus } from '../state/TaskStatus.js';

/**
 * 任务检测器
 * 统一 detectTaskCompleted() 逻辑，多信号联合判断
 * 修复：DOM 未加载 / 页面空白时返回 UNKNOWN 而非 COMPLETED
 */
export class TaskDetector {
  // 多信号联合判断任务完成（返回 TaskStatus，避免误判）
  static async detectTaskStatus(): Promise<TaskStatus> {
    const page = getLearningPage();
    try {
      return await page.evaluate(() => {
        // 0. 检查 DOM 是否已加载
        if (!document || !document.body) return 'UNKNOWN' as const;
        const bodyText = document.body.innerText || '';
        if (bodyText.trim().length < 10) return 'UNKNOWN' as const;

        // 1. 检查明确的完成样式（缩小选择器范围）
        const finishSelectors = ['.finished', '.complete', '.done', '.icon-success'];
        for (const sel of finishSelectors) {
          if (document.querySelector(sel)) return 'COMPLETED' as const;
        }

        // 2. 检查文本信号（必须包含"完成"相关词汇）
        if (bodyText.indexOf('已完成') >= 0 || bodyText.indexOf('任务点完成') >= 0) {
          return 'COMPLETED' as const;
        }

        // 3. 检查完成图标
        const iconSelectors = ['.icon-success', '[data-status*="success"]', '[aria-label*="success"]'];
        for (const sel of iconSelectors) {
          if (document.querySelector(sel)) return 'COMPLETED' as const;
        }

        return 'PENDING' as const;
      }) as TaskStatus;
    } catch {
      return TaskStatus.UNKNOWN;
    }
  }

  // 向后兼容：返回 boolean（COMPLETED = true，其它 = false）
  static async detectTaskCompleted(): Promise<boolean> {
    const status = await TaskDetector.detectTaskStatus();
    return status === TaskStatus.COMPLETED;
  }

  // 检测元素任务完成状态
  static async detectElementTaskCompleted(element: any): Promise<boolean> {
    try {
      const text = ((await element.textContent()) || '').trim();

      if (text.includes('待完成任务点') || text.includes('未完成') || text.includes('待完成')) {
        return false;
      }

      const pending = await element.$(
        '[class*="orange"], [class*="warn"], [class*="unfinished"], [style*="orange"], [class*="pending"]'
      );
      if (pending) return false;

      const completed = await element.$('.finished, .complete, .done, .icon-success');
      if (completed) return true;

      const checkIcon = await element.$('.icon-success, [data-status*="success"]');
      if (checkIcon) return true;

      return false;
    } catch {
      return false;
    }
  }

  // 检测章节测验
  static async detectQuizPage(): Promise<boolean> {
    const page = getLearningPage();
    try {
      return await page.evaluate(() => {
        const nextBtn = document.querySelector('#prevNextFocusNext');
        if (!nextBtn) return false;

        const body = document.body;
        if (!body) return false;

        const text = body.innerText || '';
        const quizKeywords = ['章节测验', '随堂练习', '作业', 'questionLi', 'exam', 'test'];
        for (const keyword of quizKeywords) {
          if (text.indexOf(keyword) >= 0) return true;
        }
        return false;
      });
    } catch {
      return false;
    }
  }
}
