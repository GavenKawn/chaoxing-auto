// 任务点类型枚举
export enum TaskType {
  VIDEO = 'VIDEO',
  PPT = 'PPT',
  DOCUMENT = 'DOCUMENT',
  QUIZ = 'QUIZ',
  UNKNOWN = 'UNKNOWN',
}

// 任务点接口
export interface TaskPoint {
  id: string;
  type: TaskType;
  completed: boolean;
  title?: string;
  // 用于定位的 DOM 信息
  framePath?: number[];
  videoIndex?: number;
}

// 播放器状态机
export enum PlayerState {
  IDLE = 'IDLE',
  SEARCHING_TASK = 'SEARCHING_TASK',
  SEARCHING_VIDEO = 'SEARCHING_VIDEO',
  WAIT_METADATA = 'WAIT_METADATA',
  PLAYING = 'PLAYING',
  PPT_READING = 'PPT_READING',
  QUIZ_SKIPPING = 'QUIZ_SKIPPING',
  FINISHED = 'FINISHED',
  NEXT_CHAPTER = 'NEXT_CHAPTER',
  ERROR = 'ERROR',
  RECOVERING = 'RECOVERING',
}

// 状态转换日志辅助
export const stateTransition = (oldState: PlayerState, newState: PlayerState): string => {
  return `[STATE] ${oldState} -> ${newState}`;
};

// 日志分类标签
export enum LogCategory {
  LOGIN = 'LOGIN',
  COURSE = 'COURSE',
  CHAPTER = 'CHAPTER',
  TASK = 'TASK',
  VIDEO = 'VIDEO',
  PPT = 'PPT',
  QUIZ = 'QUIZ',
  FRAME = 'FRAME',
  STATE = 'STATE',
  RECOVER = 'RECOVER',
}

export const logTag = (category: LogCategory): string => `[${category}]`;
