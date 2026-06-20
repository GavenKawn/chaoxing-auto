// 应用配置
export const APP_CONFIG = {
  name: 'chaoxing-auto',
  version: '1.0.0',
  author: 'GavenKwan',
  
  // 学习通相关 URL - 只保留官方登录入口
  urls: {
    login: 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com',
  },
  
  // 浏览器配置
  browser: {
    headless: false,
    slowMo: 50,
    timeout: 30000,
  },
  
  // 反检测配置
  antiDetect: {
    minDelay: 1000,
    maxDelay: 3000,
    minPlaybackRate: 1.5,
    maxPlaybackRate: 2.0,
  },
};

// 可信学习通域名验证
export const isTrustedChaoxingUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'chaoxing.com' || hostname.endsWith('.chaoxing.com');
  } catch {
    return false;
  }
};

// 课程状态
export enum CourseStatus {
  NOT_STARTED = '未开始',
  IN_PROGRESS = '进行中',
  COMPLETED = '已完成',
}

// 任务点类型
export enum TaskType {
  VIDEO = 'video',
  DOCUMENT = 'document',
  QUIZ = 'quiz',
  TIMED = 'timed',
  UNKNOWN = 'unknown',
}
