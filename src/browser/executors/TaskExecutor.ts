import { logger } from '../../utils/logger.js';
import { TaskPoint, TaskType } from '../state/TaskStatus.js';
import { TaskManager } from '../managers/TaskManager.js';
import { VideoExecutor } from './VideoExecutor.js';
import { PPTExecutor } from './PPTExecutor.js';
import { QuizExecutor } from './QuizExecutor.js';

/**
 * 任务执行器接口
 * 所有具体执行器（VideoExecutor/PPTExecutor/QuizExecutor）均实现此接口
 */
interface ITaskExecutor {
  execute(task: TaskPoint): Promise<boolean>;
}

/**
 * 任务分发执行器
 * 根据 TaskType 调用对应的 Executor：
 * - VIDEO → VideoExecutor
 * - PPT / DOCUMENT → PPTExecutor
 * - QUIZ → QuizExecutor
 *
 * 使用 Map 模式分发，禁止 if(type===...) 散落
 */
export class TaskExecutor {
  private executors: Map<TaskType, ITaskExecutor>;
  private taskManager: TaskManager;

  constructor() {
    this.taskManager = new TaskManager();

    const pptExecutor = new PPTExecutor();

    this.executors = new Map<TaskType, ITaskExecutor>([
      [TaskType.VIDEO, new VideoExecutor()],
      [TaskType.PPT, pptExecutor],
      [TaskType.DOCUMENT, pptExecutor],
      [TaskType.QUIZ, new QuizExecutor(this.taskManager)],
    ]);
  }

  /**
   * 执行任务：根据 task.type 分发到对应的执行器
   */
  async execute(task: TaskPoint): Promise<boolean> {
    const executor = this.executors.get(task.type);

    if (!executor) {
      logger.warning(`未知任务类型: ${task.type}，跳过`);
      return false;
    }

    return await executor.execute(task);
  }

  /**
   * 获取共享的 TaskManager 实例
   * 供外部编排器扫描任务点、获取待执行队列等
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }
}
