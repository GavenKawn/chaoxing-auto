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

// 状态跳转合法性映射
export const allowedTransitions: Record<PlayerState, PlayerState[]> = {
  [PlayerState.IDLE]: [
    PlayerState.SEARCHING_TASK,
    PlayerState.SEARCHING_VIDEO,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.FINISHED,
  ],
  [PlayerState.SEARCHING_TASK]: [
    PlayerState.SEARCHING_VIDEO,
    PlayerState.PPT_READING,
    PlayerState.QUIZ_SKIPPING,
    PlayerState.IDLE,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.NEXT_CHAPTER,
  ],
  [PlayerState.SEARCHING_VIDEO]: [
    PlayerState.WAIT_METADATA,
    PlayerState.PPT_READING,
    PlayerState.QUIZ_SKIPPING,
    PlayerState.IDLE,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
  ],
  [PlayerState.WAIT_METADATA]: [
    PlayerState.PLAYING,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
  ],
  [PlayerState.PLAYING]: [
    PlayerState.PPT_READING,
    PlayerState.QUIZ_SKIPPING,
    PlayerState.NEXT_CHAPTER,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.IDLE,
  ],
  [PlayerState.PPT_READING]: [
    PlayerState.NEXT_CHAPTER,
    PlayerState.SEARCHING_TASK,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.IDLE,
  ],
  [PlayerState.QUIZ_SKIPPING]: [
    PlayerState.NEXT_CHAPTER,
    PlayerState.SEARCHING_TASK,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.IDLE,
  ],
  [PlayerState.FINISHED]: [PlayerState.IDLE],
  [PlayerState.NEXT_CHAPTER]: [
    PlayerState.SEARCHING_TASK,
    PlayerState.SEARCHING_VIDEO,
    PlayerState.IDLE,
    PlayerState.ERROR,
    PlayerState.RECOVERING,
    PlayerState.FINISHED,
  ],
  [PlayerState.ERROR]: [PlayerState.RECOVERING, PlayerState.IDLE],
  [PlayerState.RECOVERING]: [
    PlayerState.SEARCHING_TASK,
    PlayerState.SEARCHING_VIDEO,
    PlayerState.IDLE,
    PlayerState.ERROR,
  ],
};

// 检查状态跳转是否合法
export const isTransitionAllowed = (
  from: PlayerState,
  to: PlayerState
): boolean => {
  const allowed = allowedTransitions[from];
  return allowed ? allowed.includes(to) : false;
};
