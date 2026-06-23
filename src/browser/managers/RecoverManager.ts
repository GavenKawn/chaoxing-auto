import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';
import { RecoverState } from '../state/RecoverState.js';

/**
 * 恢复管理器
 * 负责指数退避恢复（带 RecoverLock）、重试机制、frame 脱离/执行上下文销毁处理
 *
 * RecoverLock 保证同一时刻只有一个恢复器工作，禁止并发恢复
 */
export class RecoverManager {
  private recoverLock = false;
  private recoverAttempt = 0;
  private state: RecoverState = RecoverState.IDLE;

  /**
   * 获取当前恢复状态
   */
  getState(): RecoverState {
    return this.state;
  }

  /**
   * 获取当前恢复尝试次数
   */
  getAttempt(): number {
    return this.recoverAttempt;
  }

  /**
   * 是否正在恢复
   */
  isRecovering(): boolean {
    return this.recoverLock;
  }

  /**
   * 指数退避恢复（带 RecoverLock）
   * 保证同一时刻只有一个恢复器工作，禁止并发恢复
   *
   * @param action 恢复后执行的操作
   */
  async recover(action: () => Promise<void>): Promise<void> {
    // RecoverLock：保证同一时刻只有一个恢复器工作
    if (this.recoverLock) {
      logger.debug('已有恢复器在工作，跳过');
      return;
    }

    this.recoverLock = true;
    this.state = RecoverState.RECOVERING;
    this.recoverAttempt++;

    // 指数退避延迟: base * 2^(attempt-1)，上限为 max
    const delay = Math.min(
      TimingConfig.RECOVER_BASE_DELAY * Math.pow(2, this.recoverAttempt - 1),
      TimingConfig.RECOVER_MAX_DELAY
    );

    logger.log(
      'RECOVER',
      `第 ${this.recoverAttempt} 次恢复，等待 ${delay}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await action();
      this.state = RecoverState.COMPLETED;
      this.recoverAttempt = 0;
      logger.log('RECOVER', '恢复成功');
    } catch (error) {
      this.state = RecoverState.ABORTED;
      logger.error(`恢复失败: ${String(error)}`);
    } finally {
      this.recoverLock = false;
    }
  }

  /**
   * 重试机制
   * 对操作进行多次重试，每次失败后延迟递增
   *
   * @param action 需要重试的操作
   * @param maxAttempts 最大重试次数
   * @returns 操作结果，全部失败返回 null
   */
  async retry<T>(
    action: () => Promise<T>,
    maxAttempts: number = 3
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (attempt >= maxAttempts) {
          logger.error(`重试 ${attempt}/${maxAttempts} 次后仍失败: ${String(error)}`);
          break;
        }

        const delay = TimingConfig.RECOVER_BASE_DELAY * attempt;
        logger.debug(
          `重试 ${attempt}/${maxAttempts} 失败，${delay}ms 后重试: ${String(error)}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * 处理 frame 脱离
   * frame 被移除时（导航/DOM 变化），重置恢复状态以准备全新恢复
   *
   * @param recoveryAction 可选的恢复操作
   */
  async handleFrameDetached(
    recoveryAction?: () => Promise<void>
  ): Promise<void> {
    logger.warning('检测到 frame 脱离，重置恢复状态');
    this.state = RecoverState.RECOVERING;
    this.recoverAttempt = 0;

    if (recoveryAction) {
      await this.recover(recoveryAction);
    }
  }

  /**
   * 处理执行上下文销毁
   * 页面导航导致 JS 上下文销毁时，重置恢复状态以准备全新恢复
   *
   * @param recoveryAction 可选的恢复操作
   */
  async handleExecutionContextDestroyed(
    recoveryAction?: () => Promise<void>
  ): Promise<void> {
    logger.warning('检测到执行上下文销毁，重置恢复状态');
    this.state = RecoverState.RECOVERING;
    this.recoverAttempt = 0;

    if (recoveryAction) {
      await this.recover(recoveryAction);
    }
  }

  /**
   * 重置恢复器状态
   */
  reset(): void {
    this.recoverLock = false;
    this.recoverAttempt = 0;
    this.state = RecoverState.IDLE;
  }
}
