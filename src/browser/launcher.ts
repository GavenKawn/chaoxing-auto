import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { existsSync } from 'fs';
import { APP_CONFIG, isTrustedChaoxingUrl } from '../utils/config.js';
import { loadCookies, saveCookies } from '../utils/storage.js';
import { logger } from '../utils/logger.js';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// 检测系统浏览器
const detectBrowserChannel = (): { channel: string | undefined; name: string } => {
  const platform = process.platform;
  
  // macOS
  if (platform === 'darwin') {
    // 检查 Chrome
    if (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) {
      return { channel: 'chrome', name: 'Chrome' };
    }
    // 检查 Edge
    if (existsSync('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')) {
      return { channel: 'msedge', name: 'Edge' };
    }
  }
  
  // Windows
  if (platform === 'win32') {
    // Windows 上 Playwright 可以自动检测 Chrome 和 Edge
    // 先尝试 Chrome
    return { channel: 'chrome', name: 'Chrome' };
  }
  
  // Linux
  if (platform === 'linux') {
    // 检查 Chrome
    const chromePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];
    
    for (const path of chromePaths) {
      if (existsSync(path)) {
        if (path.includes('chromium')) {
          return { channel: undefined, name: 'Chromium' };
        }
        return { channel: 'chrome', name: 'Chrome' };
      }
    }
  }
  
  // 未找到系统浏览器，使用 Playwright 自带的 Chromium
  return { channel: undefined, name: 'Chromium (Playwright)' };
};

// 启动浏览器
export const launchBrowser = async (headless: boolean = APP_CONFIG.browser.headless): Promise<Page> => {
  if (page) return page;

  logger.info('正在启动浏览器...');
  
  // 检测系统浏览器
  const { channel, name } = detectBrowserChannel();
  
  try {
    browser = await chromium.launch({
      headless,
      channel,
      slowMo: APP_CONFIG.browser.slowMo,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
    
    logger.success(`使用浏览器: ${name}${channel ? ' (系统)' : ''}`);
  } catch (error) {
    // 如果启动失败，可能是系统没有安装对应浏览器
    if (channel) {
      logger.warning(`未找到系统 ${name}，尝试使用 Playwright Chromium...`);
      
      browser = await chromium.launch({
        headless,
        slowMo: APP_CONFIG.browser.slowMo,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });
      
      logger.info('提示: 如果需要使用系统浏览器，请安装 Chrome 或 Edge');
      logger.info('或者运行: npx playwright install chromium');
    } else {
      throw error;
    }
  }

  context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  // 加载已保存的 cookies
  const savedCookies = loadCookies();
  if (savedCookies.length > 0) {
    await context.addCookies(savedCookies);
    logger.info('已加载保存的登录状态');
  }

  page = await context.newPage();
  
  // 监听新标签页
  context.on('page', async (newPage) => {
    page = newPage;
    logger.debug(`检测到新标签页: ${newPage.url()}`);
  });
  
  // 设置默认超时
  page.setDefaultTimeout(APP_CONFIG.browser.timeout);
  
  logger.success('浏览器启动成功');
  return page;
};

// 获取当前页面
export const getPage = (): Page => {
  if (!page) {
    throw new Error('浏览器未启动，请先调用 launchBrowser');
  }
  return page;
};

// 获取学习页面（优先选择学习任务页，而不是个人空间页）
export const getLearningPage = (): Page => {
  if (!context) {
    return getPage();
  }

  const pages = context.pages();
  logger.debug(`当前浏览器标签页数量: ${pages.length}`);

  // 页面评分函数
  const scorePage = (p: Page): number => {
    const url = p.url();

    if (url.includes('/mycourse/studentstudy')) return 100;
    if (url.includes('mooc2-ans') && url.includes('/mycourse/stu')) return 90;
    if (url.includes('studentstudy')) return 80;
    if (url.includes('chapterId')) return 70;
    if (url.includes('courseId') || url.includes('courseid')) return 60;
    if (url.includes('mooc1.chaoxing.com')) return 50;
    if (url.includes('i.chaoxing.com/base')) return 10;
    return 20;
  };

  // 过滤可信域名页面
  const trustedPages = pages.filter(p => {
    try {
      return isTrustedChaoxingUrl(p.url());
    } catch {
      return false;
    }
  });

  const candidates = trustedPages.length > 0 ? trustedPages : pages;

  // 输出候选页面日志
  for (const p of candidates) {
    logger.debug(`候选页面: ${p.url()}，评分: ${scorePage(p)}`);
  }

  // 按评分排序，选择最高分的页面
  const best = candidates
    .slice()
    .sort((a, b) => scorePage(b) - scorePage(a))[0];

  if (best) {
    page = best;
    logger.info(`已选择学习页面: ${best.url()}`);
    return best;
  }

  return getPage();
};

// 保存当前 cookies
export const saveCurrentCookies = async () => {
  if (!context) return;
  const cookies = await context.cookies();
  saveCookies(cookies);
  logger.success('登录状态已保存');
};

// 关闭浏览器
export const closeBrowser = async () => {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
    logger.info('浏览器已关闭');
  }
};

// 检查是否已登录
export const checkLoginStatus = async (): Promise<boolean> => {
  if (!page) return false;
  
  try {
    const url = page.url();

    // 检查是否为可信域名
    if (!isTrustedChaoxingUrl(url)) {
      return false;
    }

    // 如果在登录页，说明未登录
    if (url.includes('passport2.chaoxing.com/login')) {
      return false;
    }

    // 检查是否存在登录按钮或用户信息
    const loginBtn = await page.$('a:has-text("登录"), button:has-text("登录")');
    const userInfo = await page.$('.user-name, .userName, .avatar, [class*="user"], [class*="User"]');

    // 如果没有登录按钮或有用户信息，则认为已登录
    return !!userInfo || !loginBtn;
  } catch {
    return false;
  }
};
