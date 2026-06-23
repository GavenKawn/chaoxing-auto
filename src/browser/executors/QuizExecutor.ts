import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';
import { TaskPoint } from '../state/TaskStatus.js';
import { TaskDetector } from '../detectors/TaskDetector.js';
import { TaskManager } from '../managers/TaskManager.js';

/**
 * 测验任务执行器
 * 负责跳过章节测验：
 * - 检测 #prevNextFocusNext 按钮并点击
 * - 使用 TaskManager.markSkipped() 防止 scan→skip→scan→skip 无限循环
 */
export class QuizExecutor {
  private taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * 执行测验任务：跳过测验
   */
  async execute(task: TaskPoint): Promise<boolean> {
    logger.log('QUIZ', `开始执行测验任务: ${task.id}`);

    // 1. 检测是否为测验页面
    const isQuiz = await TaskDetector.detectQuizPage();
    if (!isQuiz) {
      logger.warning('当前页面不是测验页面');
      this.taskManager.markSkipped(task);
      return false;
    }

    // 2. 查找并点击 #prevNextFocusNext 按钮
    const page = getLearningPage();
    try {
      const nextBtn = await page.$('#prevNextFocusNext');
      if (!nextBtn) {
        logger.warning('未找到测验跳过按钮 #prevNextFocusNext');
        this.taskManager.markSkipped(task);
        return false;
      }

      logger.info('检测到章节测验，自动跳过');
      await nextBtn.click();

      // 3. 标记跳过，防止 scan→skip→scan→skip 无限循环
      this.taskManager.markSkipped(task);

      // 4. 等待页面切换
      await page.waitForTimeout(TimingConfig.QUIZ_SKIP_WAIT).catch(() => {});

      logger.success('测验已跳过');
      return true;
    } catch (error) {
      logger.error(`跳过测验失败: ${String(error)}`);
      // 跳过失败也标记为 skipped，防止无限重试
      this.taskManager.markSkipped(task);
      return false;
    }
  }
}
