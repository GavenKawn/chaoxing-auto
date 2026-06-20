import { APP_CONFIG } from '../utils/config.js';

// 随机延迟
export const randomDelay = async (
  min: number = APP_CONFIG.antiDetect.minDelay,
  max: number = APP_CONFIG.antiDetect.maxDelay
): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min) + min);
  await new Promise(resolve => setTimeout(resolve, delay));
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 随机播放速率
export const randomPlaybackRate = (): number => {
  const { minPlaybackRate, maxPlaybackRate } = APP_CONFIG.antiDetect;
  return Number((Math.random() * (maxPlaybackRate - minPlaybackRate) + minPlaybackRate).toFixed(2));
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 模拟人类鼠标移动
export const simulateHumanMouseMove = async (page: any): Promise<void> => {
  try {
    const viewport = page.viewportSize();
    if (!viewport) return;
    
    // 随机移动到页面某个位置
    const x = Math.floor(Math.random() * viewport.width);
    const y = Math.floor(Math.random() * viewport.height);
    
    await page.mouse.move(x, y, {
      steps: Math.floor(Math.random() * 10) + 5,
    });
  } catch (error) {
    // 忽略错误
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 模拟人类滚动
export const simulateHumanScroll = async (page: any): Promise<void> => {
  try {
    await page.evaluate(() => {
      const scrollAmount = Math.floor(Math.random() * 300) + 100;
      window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth',
      });
    });
  } catch (error) {
    // 忽略错误
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 随机执行人类行为
export const randomHumanBehavior = async (page: any): Promise<void> => {
  const behaviors = [
    () => simulateHumanMouseMove(page),
    () => simulateHumanScroll(page),
  ];
  
  const behavior = behaviors[Math.floor(Math.random() * behaviors.length)];
  await behavior();
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 获取随机 User-Agent
export const getRandomUserAgent = (): string => {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};
