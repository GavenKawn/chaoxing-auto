// 任务状态
export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

// 任务类型
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
  status: TaskStatus;
  signature: string;
  title?: string;
  videoIndex?: number;
}
