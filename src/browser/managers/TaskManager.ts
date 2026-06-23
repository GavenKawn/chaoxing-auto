import { getLearningPage } from '../launcher.js';
import { TaskDetector } from '../detectors/TaskDetector.js';
import { VideoDetector } from '../detectors/VideoDetector.js';
import { logger } from '../../utils/logger.js';
import { TaskStatus, TaskType, TaskPoint } from '../state/TaskStatus.js';
import { VideoManager } from './VideoManager.js';

/**
 * 任务汇总信息
 * 统一由 TaskManager.getTaskSummary() 生成，禁止各模块自己计算
 */
export interface TaskSummary {
  scanSuccess: boolean;
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  skippedTasks: number;
  allTasksFinished: boolean;
}

/**
 * 任务管理器
 * 负责扫描任务点、维护任务队列（pendingTasks / completedTasks / skippedTasks）
 * 防止 scan→skip→scan→skip 无限循环
 */
export class TaskManager {
  private pendingTasks: TaskPoint[] = [];
  private completedTasks: TaskPoint[] = [];
  private skippedTasks: TaskPoint[] = [];
  private completedSignatures: Set<string> = new Set();
  private skippedSignatures: Set<string> = new Set();
  private videoManager: VideoManager;
  private lastScanSuccess: boolean = false;

  constructor() {
    this.videoManager = new VideoManager();
  }

  /**
   * 扫描当前页面所有任务点
   * 包括视频任务、章节测验等
   * 修复：扫描失败时返回空数组，但 lastScanSuccess=false
   */
  async scanTaskPoints(): Promise<TaskPoint[]> {
    const tasks: TaskPoint[] = [];

    // 1. 视频任务
    try {
      const video = await VideoDetector.findVideoInFrames();
      if (video) {
        const signature = await this.videoManager.getCurrentVideoSignature(video, 0);
        const status = this.getTaskStatus(signature);
        tasks.push({
          id: 'video_0',
          type: TaskType.VIDEO,
          status,
          signature,
          videoIndex: 0,
        });
      }
    } catch (error) {
      logger.debug(`扫描视频任务失败: ${String(error)}`);
    }

    // 2. 章节测验
    try {
      const isQuiz = await TaskDetector.detectQuizPage();
      if (isQuiz) {
        const signature = this.getChapterSignature() + '|quiz_0';
        const status = this.getTaskStatus(signature);
        tasks.push({
          id: 'quiz_0',
          type: TaskType.QUIZ,
          status,
          signature,
        });
      }
    } catch (error) {
      logger.debug(`扫描测验任务失败: ${String(error)}`);
    }

    // 记录扫描是否成功（找到至少一个任务）
    this.lastScanSuccess = tasks.length > 0;

    // 更新待执行队列
    this.pendingTasks = tasks.filter((t) => t.status === TaskStatus.PENDING);

    logger.info(`扫描到 ${tasks.length} 个任务点，待执行 ${this.pendingTasks.length} 个 (scanSuccess=${this.lastScanSuccess})`);

    return tasks;
  }

  /**
   * 获取任务汇总信息
   * 统一由 TaskManager 生成，禁止各模块自己计算
   */
  getTaskSummary(runningTask: TaskPoint | null = null): TaskSummary {
    const totalTasks = this.completedTasks.length + this.skippedTasks.length +
      this.pendingTasks.length + (runningTask ? 1 : 0);
    return {
      scanSuccess: this.lastScanSuccess,
      totalTasks,
      pendingTasks: this.pendingTasks.length,
      runningTasks: runningTask ? 1 : 0,
      completedTasks: this.completedTasks.length,
      skippedTasks: this.skippedTasks.length,
      allTasksFinished: this.lastScanSuccess && totalTasks > 0 &&
        this.pendingTasks.length === 0 && !runningTask,
    };
  }

  /**
   * 获取未完成任务列表
   */
  getPendingTasks(): TaskPoint[] {
    return this.pendingTasks;
  }

  /**
   * 获取已完成任务列表
   */
  getCompletedTasks(): TaskPoint[] {
    return this.completedTasks;
  }

  /**
   * 获取已跳过任务列表
   */
  getSkippedTasks(): TaskPoint[] {
    return this.skippedTasks;
  }

  /**
   * 标记任务完成
   */
  markCompleted(task: TaskPoint): void {
    task.status = TaskStatus.COMPLETED;
    this.completedTasks.push(task);
    this.completedSignatures.add(task.signature);
    const idx = this.pendingTasks.indexOf(task);
    if (idx >= 0) {
      this.pendingTasks.splice(idx, 1);
    }
    logger.debug(`任务已完成: ${task.id} (${task.signature})`);
  }

  /**
   * 标记任务跳过（防止 scan→skip→scan→skip 无限循环）
   */
  markSkipped(task: TaskPoint): void {
    task.status = TaskStatus.SKIPPED;
    this.skippedTasks.push(task);
    this.skippedSignatures.add(task.signature);
    const idx = this.pendingTasks.indexOf(task);
    if (idx >= 0) {
      this.pendingTasks.splice(idx, 1);
    }
    logger.debug(`任务已跳过: ${task.id} (${task.signature})`);
  }

  /**
   * 取出下一个待执行任务
   */
  nextTask(): TaskPoint | null {
    return this.pendingTasks.shift() || null;
  }

  /**
   * 清空待执行队列
   */
  clearPending(): void {
    this.pendingTasks = [];
  }

  /**
   * 检查是否所有任务都已完成
   * 修复：必须 scanSuccess && totalTasks > 0 && pendingTasks.length === 0
   * 禁止扫描失败 == 全部完成
   */
  isAllCompleted(): boolean {
    const summary = this.getTaskSummary();
    return summary.allTasksFinished;
  }

  /**
   * 根据签名获取任务状态
   */
  private getTaskStatus(signature: string): TaskStatus {
    if (this.completedSignatures.has(signature)) {
      return TaskStatus.COMPLETED;
    }
    if (this.skippedSignatures.has(signature)) {
      return TaskStatus.SKIPPED;
    }
    return TaskStatus.PENDING;
  }

  /**
   * 获取当前章节签名
   * 用于为非视频任务（测验/PPT）生成唯一标识
   */
  private getChapterSignature(): string {
    try {
      const page = getLearningPage();
      const parsed = new URL(page.url());
      const courseId =
        parsed.searchParams.get('courseId') || parsed.searchParams.get('courseid') || '';
      const clazzId =
        parsed.searchParams.get('clazzId') || parsed.searchParams.get('clazzid') || '';
      const knowledgeId =
        parsed.searchParams.get('knowledgeid') || parsed.searchParams.get('knowledgeId') || '';
      const chapterId =
        parsed.searchParams.get('chapterId') || parsed.searchParams.get('chapterid') || '';
      return `c=${courseId}|cl=${clazzId}|ch=${chapterId}|k=${knowledgeId}`;
    } catch {
      return 'unknown_chapter';
    }
  }
}
