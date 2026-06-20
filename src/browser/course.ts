import { Page } from 'playwright';
import * as readline from 'readline';
import { getPage, getLearningPage } from './launcher.js';
import { APP_CONFIG, TaskType, isTrustedChaoxingUrl } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { randomDelay } from './anti-detect.js';
import { playVideoComplete, waitForVideoOnCurrentPage, getCurrentVideoSignature } from './video.js';

// 课程信息接口
export interface Course {
  id: string;
  name: string;
  teacher: string;
  progress: number;
  url: string;
  cover?: string;
}

// 章节信息接口
export interface Chapter {
  id: string;
  name: string;
  tasks: Task[];
}

// 任务点信息接口
export interface Task {
  id: string;
  name: string;
  type: TaskType;
  url?: string;
  sourceUrl?: string;
  completed: boolean;
  selector?: string;
  index?: number;
  chapterName?: string;
}

type StopCheck = () => boolean;

// 等待用户在终端按 Enter
const waitForEnter = (message: string): Promise<void> => {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
};

// 检测任务是否完成
const detectTaskCompleted = async (element: any): Promise<boolean> => {
  try {
    const text = ((await element.textContent()) || '').trim();

    // 如果包含待完成或未完成文本，则未完成
    if (text.includes('待完成任务点') || text.includes('未完成') || text.includes('待完成')) {
      return false;
    }

    // 检查是否有橙色/警告/未完成样式
    const pending = await element.$('[class*="orange"], [class*="warn"], [class*="unfinished"], [style*="orange"], [class*="pending"]');
    if (pending) return false;

    // 检查是否有已完成样式
    const completed = await element.$('.finished, .complete, .done, [class*="finish"], [class*="complete"], [class*="done"], [class*="success"]');
    if (completed) return true;

    // 检查是否有绿色对勾图标
    const checkIcon = await element.$('[class*="check"], [class*="tick"], svg[class*="green"]');
    if (checkIcon) return true;

    // 不确定时保守判断为未完成
    return false;
  } catch {
    return false;
  }
};

// 等待进入章节页
const waitForChapterPage = async (page: Page, timeout = 15000): Promise<boolean> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const url = page.url();

      if (isTrustedChaoxingUrl(url) && url.includes('mooc2-ans') && url.includes('/mycourse/stu')) {
        return true;
      }

      // 检查是否有章节或任务点元素
      const hasChapter = await page.locator('text=章节').count().catch(() => 0);
      const hasTask = await page.locator('text=/待完成任务点|任务点/').count().catch(() => 0);

      if ((hasChapter > 0 || hasTask > 0) && isTrustedChaoxingUrl(url)) {
        return true;
      }
    } catch {}

    await page.waitForTimeout(1000);
  }

  return false;
};

// 获取课程列表 - 从当前页面解析，不主动跳转 mooc1
export const getCourses = async (): Promise<Course[]> => {
  const page = getPage();
  const courses: Course[] = [];
  
  try {
    logger.info('正在获取课程列表...');
    logger.debug(`当前页面 URL: ${page.url()}`);
    
    // 不主动跳转 mooc1，从当前页面解析
    await randomDelay();
    
    // 检查是否在课程列表页
    const url = page.url();
    if (!isTrustedChaoxingUrl(url)) {
      logger.warning('当前页面不是官方学习通域名');
      return [];
    }
    
    // 等待页面加载
    await page.waitForLoadState('domcontentloaded');
    
    // 解析课程卡片
    const courseElements = await page.$$('.course, .Mcourse, ul.course-list li, .course-cover, .course-item');
    logger.debug(`找到 ${courseElements.length} 个课程候选元素`);
    
    if (courseElements.length === 0) {
      logger.warning('未检测到课程列表，请确保已进入课程页面');
      logger.info('如果还在登录页，请先完成登录');
      return [];
    }
    
    for (const el of courseElements) {
      try {
        // 获取课程链接
        const link = await el.$('a');
        if (!link) continue;
        
        const url = await link.getAttribute('href') || '';
        const id = url.match(/courseid=(\d+)/)?.[1] || url.match(/course_(\d+)/)?.[1] || '';
        
        // 获取课程名称
        const nameEl = await el.$('.course-name, h3, .title');
        const name = await nameEl?.textContent() || '未知课程';
        
        // 获取教师
        const teacherEl = await el.$('.teacher, .teacher-name');
        const teacher = await teacherEl?.textContent() || '';
        
        // 获取进度
        const progressEl = await el.$('.progress, .course-progress');
        const progressText = await progressEl?.textContent() || '0%';
        const progress = parseInt(progressText.match(/\d+/)?.[0] || '0');
        
        courses.push({
          id,
          name: name.trim(),
          teacher: teacher.trim(),
          progress,
          url,
        });
      } catch (e) {
        continue;
      }
    }
    
    logger.success(`获取到 ${courses.length} 门课程`);
    return courses;
  } catch (error) {
    logger.error(`获取课程列表失败: ${error}`);
    return [];
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 进入课程并获取章节列表
export const getCourseChapters = async (courseUrl: string): Promise<Chapter[]> => {
  const page = getPage();
  const chapters: Chapter[] = [];
  
  try {
    logger.info('正在进入课程...');
    logger.debug(`课程 URL: ${courseUrl}`);
    
    // 补全相对路径
    const fullUrl = courseUrl.startsWith('http') ? courseUrl : new URL(courseUrl, page.url()).toString();
    
    // 验证域名
    if (!isTrustedChaoxingUrl(fullUrl)) {
      logger.error('课程链接不是官方学习通域名，已跳过');
      return [];
    }
    
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    await randomDelay();
    
    // 等待章节页加载
    let isChapterPage = await waitForChapterPage(page);
    logger.debug(`是否识别为章节页: ${isChapterPage}`);
    
    if (!isChapterPage) {
      logger.warning('未能自动进入课程章节页');
      await waitForEnter('请在浏览器中手动进入该课程的"章节"页面，完成后按 Enter 继续... ');
      
      // 用户手动进入后再次检查
      isChapterPage = await waitForChapterPage(page, 5000);
      
      if (!isChapterPage) {
        logger.error('仍未识别到章节页，请确认当前页面为课程章节页');
        return [];
      }
    }
    
    // 解析章节和任务点
    return await parseChaptersFromPage(page);
  } catch (error) {
    logger.error(`获取章节列表失败: ${error}`);
    return [];
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 从当前页面解析章节和任务点（不跳转）
export const getCourseChaptersFromCurrentPage = async (): Promise<Chapter[]> => {
  const page = getPage();
  
  try {
    logger.info('正在检测当前页面...');
    logger.debug(`当前页面 URL: ${page.url()}`);
    
    // 检查是否为可信域名
    const url = page.url();
    if (!isTrustedChaoxingUrl(url)) {
      logger.warning('当前页面不是官方学习通域名');
      return [];
    }
    
    // 等待页面加载
    await page.waitForLoadState('domcontentloaded');
    
    // 检查是否为章节页
    const isChapterPage = await waitForChapterPage(page, 3000);
    logger.debug(`是否识别为章节页: ${isChapterPage}`);
    
    if (!isChapterPage) {
      logger.warning('当前页面不是章节页');
      return [];
    }
    
    // 解析章节和任务点
    return await parseChaptersFromPage(page);
  } catch (error) {
    logger.error(`解析章节失败: ${error}`);
    return [];
  }
};

// 解析页面中的章节和任务点（内部函数，增强版带兜底扫描）
const parseChaptersFromPage = async (page: Page): Promise<Chapter[]> => {
  const chapters: Chapter[] = [];
  const sourceUrl = page.url();

  // 新版章节页选择器
  const chapterElements = await page.$$('.chapter, .unit, .catalog .item, .section, [class*="chapter"], [class*="unit"]');
  logger.debug(`找到 ${chapterElements.length} 个章节候选元素`);

  let totalPendingTasks = 0;

  for (const el of chapterElements) {
    try {
      const nameEl = await el.$('.chapter-name, .title, h3, [class*="title"]');
      const name = await nameEl?.textContent() || '未知章节';

      // 获取任务点
      const tasks: Task[] = [];
      const taskElements = await el.$$('.task, .section, .catalog_item, [class*="task"], [class*="section"]');
      logger.debug(`章节 "${name.trim()}" 找到 ${taskElements.length} 个任务候选`);

      for (const taskEl of taskElements) {
        const taskNameEl = await taskEl.$('.task-name, .title, a, [class*="title"]');
        const taskName = await taskNameEl?.textContent() || '';

        // 获取任务链接
        const taskLink = await taskEl.$('a');
        let taskUrl = await taskLink?.getAttribute('href') || '';

        // 过滤无效链接
        if (
          taskUrl.startsWith('javascript:') ||
          taskUrl.startsWith('#') ||
          taskUrl === sourceUrl ||
          taskUrl === page.url()
        ) {
          taskUrl = '';
        }

        // 判断任务类型
        let taskType = TaskType.VIDEO;
        if (taskName.includes('文档') || taskName.includes('ppt') || taskName.includes('PDF')) {
          taskType = TaskType.DOCUMENT;
        } else if (taskName.includes('测验') || taskName.includes('作业') || taskName.includes('考试')) {
          taskType = TaskType.QUIZ;
        }

        // 检查是否完成 - 使用增强的检测逻辑
        const completed = await detectTaskCompleted(taskEl);

        if (!completed) {
          totalPendingTasks++;
          logger.debug(`任务 "${taskName.trim()}" 未完成`);
        }

        // 获取选择器用于点击
        const selector = taskName ? `text=${taskName.trim()}` : undefined;

        tasks.push({
          id: taskUrl.match(/jobid=(\d+)/)?.[1] || '',
          name: taskName.trim(),
          type: taskType,
          url: taskUrl,
          sourceUrl,
          completed,
          selector,
        });
      }

      chapters.push({
        id: '',
        name: name.trim(),
        tasks,
      });
    } catch (e) {
      continue;
    }
  }

  // 如果没有解析到章节，尝试兜底扫描
  if (chapters.length === 0) {
    logger.info('未找到标准章节结构，尝试兜底扫描...');

    const fallbackTasks = await fallbackScanForTasks(page);
    if (fallbackTasks.length > 0) {
      chapters.push({
        id: '',
        name: '任务列表',
        tasks: fallbackTasks,
      });
      totalPendingTasks = fallbackTasks.filter(t => !t.completed).length;
    }
  }

  if (totalPendingTasks > 0) {
    logger.info(`发现 ${totalPendingTasks} 个待完成任务点`);
  } else {
    logger.info('未发现待完成任务点');
  }

  logger.success(`获取到 ${chapters.length} 个章节`);
  return chapters;
};

// 兜底扫描：查找页面中所有可能的任务点
const fallbackScanForTasks = async (page: Page): Promise<Task[]> => {
  const tasks: Task[] = [];
  const sourceUrl = page.url();

  try {
    // 扫描所有可能的任务点元素
    const selectors = [
      'a[href]',
      'button',
      '[role="button"]',
      '[onclick]',
      '[class*="task"]',
      '[class*="catalog"]',
      '[class*="chapter"]',
      '[class*="section"]',
    ];

    const allElements = await page.$$(selectors.join(', '));
    logger.debug(`兜底扫描找到 ${allElements.length} 个候选元素`);

    // 过滤无关文本
    const excludePatterns = [
      '首页',
      '登录',
      '消息',
      '通知',
      '讨论',
      '返回',
      '上一页',
      '下一页',
      '帮助',
      '设置',
      '退出',
    ];

    for (const el of allElements) {
      try {
        const text = await el.textContent() || '';
        const trimmedText = text.trim();

        // 过滤无关文本
        if (
          trimmedText.length < 2 ||
          trimmedText.length > 50 ||
          excludePatterns.some(pattern => trimmedText.includes(pattern))
        ) {
          continue;
        }

        // 获取链接
        let taskUrl = await el.getAttribute('href') || '';

        // 过滤无效链接
        if (
          taskUrl.startsWith('javascript:') ||
          taskUrl.startsWith('#') ||
          taskUrl === sourceUrl ||
          taskUrl === page.url()
        ) {
          taskUrl = '';
        }

        // 判断任务类型
        let taskType = TaskType.VIDEO;
        if (trimmedText.includes('文档') || trimmedText.includes('ppt') || trimmedText.includes('PDF')) {
          taskType = TaskType.DOCUMENT;
        } else if (trimmedText.includes('测验') || trimmedText.includes('作业') || trimmedText.includes('考试')) {
          taskType = TaskType.QUIZ;
        }

        // 检查是否完成
        const completed = await detectTaskCompleted(el);

        tasks.push({
          id: '',
          name: trimmedText,
          type: taskType,
          url: taskUrl,
          sourceUrl,
          completed,
          selector: `text=${trimmedText}`,
        });
      } catch (e) {
        continue;
      }
    }

    logger.info(`兜底扫描找到 ${tasks.length} 个任务候选`);
  } catch (error) {
    logger.debug(`兜底扫描失败: ${error}`);
  }

  return tasks;
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 进入任务点页面
export const enterTask = async (task: Task): Promise<void> => {
  const page = getPage();
  
  try {
    logger.info(`正在进入任务: ${task.name}`);
    logger.debug(`任务 URL: ${task.url || '无'}, 选择器: ${task.selector || '无'}`);
    
    if (task.url) {
      // 补全相对路径
      const url = task.url.startsWith('http') ? task.url : new URL(task.url, page.url()).toString();
      
      // 验证域名
      if (!isTrustedChaoxingUrl(url)) {
        logger.error('任务链接不是官方学习通域名，已跳过');
        return;
      }
      
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } else if (task.selector || task.name) {
      if (task.sourceUrl && page.url() !== task.sourceUrl) {
        logger.debug('返回章节列表页后再点击任务');
        await page.goto(task.sourceUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(1500);
      }

      // 通过点击文本进入
      const selector = task.selector || `text=${task.name}`;
      await page.locator(selector).first().click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    } else {
      logger.error('任务没有可用的链接或名称，无法进入');
      return;
    }
    
    await randomDelay();
    
    // 等待内容加载
    await page.waitForSelector('iframe, video, .job', { timeout: 10000 }).catch(() => {
      logger.warning('未检测到视频或任务内容');
    });
  } catch (error) {
    logger.error(`进入任务点失败: ${error}`);
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 检测当前任务类型
export const detectCurrentTaskType = async (): Promise<TaskType> => {
  const page = getLearningPage();

  try {
    const url = page.url();
    logger.debug(`当前页面 URL: ${url}`);

    // 1. 检测是否有 video（等待最多 3 秒）
    const hasVideo = await waitForVideoOnCurrentPage(3000);
    if (hasVideo) {
      logger.info('当前页面任务类型: VIDEO');
      return TaskType.VIDEO;
    }

    // 2. 获取页面文本
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

    // 3. 检测测验/作业
    if (/测验|作业|考试|章节测验/.test(text)) {
      logger.info('当前页面任务类型: QUIZ');
      return TaskType.QUIZ;
    }

    // 4. 检测文档/PPT/PDF
    if (/ppt|PPT|文档|PDF|阅读|课件|资料/.test(text)) {
      logger.info('当前页面任务类型: DOCUMENT');
      return TaskType.DOCUMENT;
    }

    // 5. 检测计时任务（没有 video，但有任务点/观看时长要求）
    const isTimedPage = 
      /任务点|完成条件|观看时长|总时长|当前视频不可拖拽/.test(text) ||
      url.includes('/mycourse/studentstudy');

    if (isTimedPage) {
      logger.info('当前页面任务类型: TIMED（计时/课件任务）');
      return TaskType.TIMED;
    }

    logger.info('当前页面任务类型: UNKNOWN');
    return TaskType.UNKNOWN;
  } catch (error) {
    logger.debug(`检测当前任务类型失败: ${error}`);
    return TaskType.UNKNOWN;
  }
};

// 获取当前页面任务标题
const getCurrentTaskTitle = async (): Promise<string> => {
  const page = getLearningPage();
  
  try {
    // 尝试从多个选择器获取标题
    const selectors = ['h1', 'h2', '.title', '[class*="title"]', '.chapter-title', '.task-title'];
    
    for (const selector of selectors) {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        if (text && text.trim()) {
          return text.trim();
        }
      }
    }
    
    // 尝试获取页面标题
    const title = await page.title();
    if (title && title.trim()) {
      return title.trim();
    }
  } catch {}
  
  return '当前页面任务';
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 从当前章节页解析任务队列
export const getTasksFromCurrentPage = async (): Promise<Task[]> => {
  const page = getLearningPage();
  const tasks: Task[] = [];
  
  try {
    logger.info('正在解析当前页面任务队列...');
    
    // 检查是否为可信域名
    const url = page.url();
    logger.debug(`当前页面 URL: ${url}`);
    
    if (!isTrustedChaoxingUrl(url)) {
      logger.warning('当前页面不是官方学习通域名');
      return [];
    }
    
    // 等待页面加载
    await page.waitForLoadState('domcontentloaded');
    
    // 检查是否为章节页
    const isChapterPage = await waitForChapterPage(page, 3000);
    
    if (isChapterPage) {
      // 解析章节和任务点
      const chapters = await parseChaptersFromPage(page);
      
      let taskIndex = 0;
      for (const chapter of chapters) {
        for (const task of chapter.tasks) {
          task.index = taskIndex++;
          task.chapterName = chapter.name;
          tasks.push(task);
        }
      }
      
      logger.success(`解析到 ${tasks.length} 个任务`);
      return tasks;
    }
    
    // 当前页面不是章节页，检查是否是任务点页面
    const currentType = await detectCurrentTaskType();
    
    if (currentType !== TaskType.UNKNOWN) {
      // 构造当前任务
      const taskTitle = await getCurrentTaskTitle();
      tasks.push({
        id: '',
        name: taskTitle,
        type: currentType,
        completed: false,
        index: 0,
      });
      logger.info(`当前页面为任务点页面，类型：${currentType}，标题：${taskTitle}`);
      return tasks;
    }
    
    // 额外检查：URL 包含 studentstudy 或页面包含任务点文本
    const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const isTaskPointPage = 
      url.includes('/mycourse/studentstudy') || 
      /任务点|完成条件|观看时长/.test(text);
    
    if (isTaskPointPage) {
      // 未找到 video，但检测到任务点特征，按 TIMED 处理
      const taskTitle = await getCurrentTaskTitle();
      tasks.push({
        id: '',
        name: taskTitle,
        type: TaskType.TIMED,
        completed: false,
        index: 0,
      });
      logger.info('未找到 video，但检测到任务点/完成条件，按 TIMED 处理');
      return tasks;
    }
    
    logger.warning('当前页面既不是章节页也不是任务点页面');
    return [];
  } catch (error) {
    logger.error(`解析任务队列失败: ${error}`);
    return [];
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 处理文档/PPT 任务
export const handleDocumentTask = async (): Promise<void> => {
  const page = getPage();
  
  try {
    logger.info('检测到文档/PPT 任务，正在浏览...');
    
    // 等待页面加载
    await randomDelay(3000, 8000);
    
    // 尝试滚动到页面底部
    try {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      logger.debug('已滚动到页面底部');
    } catch {}
    
    // 尝试点击"下一页"或"下一张"按钮
    const nextButton = page.locator('text=/下一页|下一张|继续|next/i').first();
    if (await nextButton.isVisible().catch(() => false)) {
      try {
        await nextButton.click();
        await randomDelay(2000, 4000);
        logger.debug('已点击下一页按钮');
      } catch {}
    }
    
    // 再滚动一次
    try {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
    } catch {}
    
    logger.info('文档/PPT 浏览完成');
  } catch (error) {
    logger.debug(`处理文档任务失败: ${error}`);
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 跳过测验/作业任务
export const skipQuizTask = async (): Promise<void> => {
  logger.info('检测到测验/作业任务，已跳过（不自动答题）');
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 处理计时任务（没有 video，但需要停留观看时长的任务）
export const handleTimedTask = async (): Promise<void> => {
  const page = getPage();
  logger.info('检测到计时/课件任务，开始浏览当前页面');

  try {
    const text = await page.locator('body').innerText().catch(() => '');
    let waitMs = 45000; // 默认等待 45 秒

    // 尝试解析页面中的时长信息
    const minuteMatch = text.match(/(\d+)\s*分钟/);
    if (minuteMatch) {
      // 取时长的 90%，但不超过 10 分钟
      const durationMinutes = Number(minuteMatch[1]);
      waitMs = Math.min(durationMinutes * 60 * 1000 * 0.9, 10 * 60 * 1000);
      logger.info(`解析到时长要求，预计等待 ${Math.floor(waitMs / 1000)} 秒`);
    }

    const start = Date.now();
    let scrollDirection = 1;

    while (Date.now() - start < waitMs) {
      try {
        // 模拟轻微滚动，保持页面活跃
        await page.mouse.wheel(0, 500 * scrollDirection);
        scrollDirection *= -1; // 改变方向
        await page.waitForTimeout(3000);
      } catch {
        await page.waitForTimeout(3000);
      }
    }

    logger.success('计时/课件任务浏览完成');
  } catch (error) {
    logger.debug(`处理计时任务失败: ${error}`);
    await randomDelay(30000, 45000); // 失败时默认等待
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 尝试点击"下一个任务点"按钮
export const tryClickNextTaskButton = async (): Promise<boolean> => {
  const page = getPage();
  
  try {
    const btn = page.getByText(/下一任务点|下一个|下一节|下一页|继续学习/).first();
    
    if (await btn.isVisible().catch(() => false)) {
      logger.info('尝试点击"下一任务点"按钮');
      await btn.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.debug(`点击下一任务点按钮失败: ${error}`);
    return false;
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 尝试进入下一个任务
export const tryGoToNextTask = async (tasks: Task[], currentIndex: number): Promise<boolean> => {
  const page = getPage();
  
  if (currentIndex >= tasks.length - 1) {
    logger.info('已经是最后一个任务');
    return false;
  }
  
  const nextTask = tasks[currentIndex + 1];
  
  if (!nextTask) {
    logger.warning('未找到下一个任务');
    return false;
  }
  
  try {
    logger.info(`正在进入下一个任务: ${nextTask.name}`);
    await enterTask(nextTask);
    return true;
  } catch (error) {
    logger.debug(`进入下一个任务失败: ${error}`);
    return false;
  }
};

// 获取课程目录树中的章节和视频节点信息
const getCourseTreeData = async (page: Page): Promise<{
  cells: any[];
  currentCellIndex: number;
  currentNCellIndex: number;
  nCellsPerCell: any[][];
} | null> => {
  try {
    // 查找课程目录树
    const courseTree = await page.$('#coursetree');
    if (!courseTree) {
      logger.debug('未找到课程目录树 #coursetree');
      return null;
    }

    // 获取所有章节（#coursetree > ul > li）
    const cells = await courseTree.$$('ul > li');
    if (cells.length === 0) {
      logger.debug('课程目录树中没有章节 li');
      return null;
    }

    // 收集每个章节的视频节点，并找到当前激活的节点
    const nCellsPerCell: any[][] = [];
    let currentCellIndex = 0;
    let currentNCellIndex = 0;
    let foundCurrent = false;

    for (let i = 0; i < cells.length; i++) {
      // 查找章节内的视频节点（排除 firstLayer 即章节标题）
      const nCells = await cells[i].$$('.posCatalog_select:not(.firstLayer)');
      nCellsPerCell.push(nCells);

      // 检查是否有激活的节点
      for (let j = 0; j < nCells.length; j++) {
        const className = await nCells[j].getAttribute('class') || '';
        if (className.includes('posCatalog_active')) {
          currentCellIndex = i;
          currentNCellIndex = j;
          foundCurrent = true;
        }
      }
    }

    if (!foundCurrent) {
      logger.warning('未找到当前激活的视频节点（.posCatalog_active）');
    }

    logger.debug(`课程信息: ${cells.length}章, 共${nCellsPerCell.flat().length}节, 当前: 第${currentCellIndex + 1}章第${currentNCellIndex + 1}节`);

    return {
      cells,
      currentCellIndex,
      currentNCellIndex,
      nCellsPerCell,
    };
  } catch (error) {
    logger.debug(`获取课程目录树数据失败: ${error}`);
    return null;
  }
};

// 点击视频节点并等待加载
const clickVideoNode = async (page: Page, nCell: any): Promise<boolean> => {
  try {
    // 查找可点击的 .posCatalog_name span
    const clickableSpan = await nCell.$('.posCatalog_name');
    if (!clickableSpan) {
      logger.error('找不到可点击的课程节点 .posCatalog_name');
      return false;
    }

    const title = await clickableSpan.getAttribute('title') || await clickableSpan.textContent() || '未知标题';
    logger.info(`点击切换到: ${title.trim()}`);

    // 点击切换
    await clickableSpan.click();

    // 等待页面加载
    await page.waitForTimeout(3000);
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    return true;
  } catch (error) {
    logger.error(`点击视频节点失败: ${error}`);
    return false;
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 切换到下一小节（学习通课程目录，匹配参考项目 v3_optimized.js 的逻辑）
export const nextUnit = async (): Promise<boolean> => {
  const page = getPage();

  try {
    logger.info('尝试切换到下一小节...');

    const treeData = await getCourseTreeData(page);
    if (!treeData) {
      return false;
    }

    const { cells, currentCellIndex, currentNCellIndex, nCellsPerCell } = treeData;
    const currentChapterNCells = nCellsPerCell[currentCellIndex] || [];

    // 1. 同章节内还有下一个视频
    if (currentChapterNCells.length > currentNCellIndex + 1) {
      const nextNIndex = currentNCellIndex + 1;
      logger.info(`切换到同章节下一个视频: ${nextNIndex + 1}/${currentChapterNCells.length}`);
      const clicked = await clickVideoNode(page, currentChapterNCells[nextNIndex]);
      if (!clicked) return false;
    } else {
      // 2. 切换到下一个章节
      const nextCellIndex = currentCellIndex + 1;
      if (nextCellIndex >= cells.length) {
        logger.success('已经是最后一节，本课程学习完成');
        return false;
      }

      logger.info(`切换到下一个章节: ${nextCellIndex + 1}/${cells.length}`);

      // 找下一章节的第一个视频节点
      const nextChapterNCells = nCellsPerCell[nextCellIndex] || [];
      if (nextChapterNCells.length === 0) {
        logger.warning(`第${nextCellIndex + 1}章没有视频节点，跳过`);
        // 递归尝试下一章
        // 这里简单返回 false，让外层处理
        return false;
      }

      const clicked = await clickVideoNode(page, nextChapterNCells[0]);
      if (!clicked) return false;
    }

    // 等待 iframe 或 video 更新
    await page.waitForSelector('iframe, video', { timeout: 10000 }).catch(() => {
      logger.warning('切换后未检测到 iframe 或 video');
    });

    logger.success('已切换到下一小节');
    return true;
  } catch (error) {
    logger.error(`切换下一小节失败: ${error}`);
    return false;
  }
};

// [备用方案]
// Playwright 外部控制方案，当前主流程使用 autoplay.ts 注入脚本
// 自动运行任务队列（增强版，避免重复播放）
export const runTasksFromCurrentPage = async (
  tasks: Task[],
  startIndex: number = 0,
  onProgress?: (taskName: string, taskType: TaskType, progress: number, current: number, total: number) => void,
  shouldStop?: StopCheck
): Promise<void> => {
  let currentIndex = startIndex;
  let lastVideoSignature = '';

  while (currentIndex < tasks.length) {
    if (shouldStop?.()) {
      logger.info('任务队列已停止');
      return;
    }

    const task = tasks[currentIndex];

    if (task.completed) {
      logger.debug(`任务 "${task.name}" 已完成，跳过`);
      currentIndex++;
      continue;
    }

    logger.info(`处理任务 [${currentIndex + 1}/${tasks.length}]: ${task.name} (${task.type})`);

    // 记录进入前的视频签名
    const beforeSignature = await getCurrentVideoSignature().catch(() => '');

    // 如果不是第一个任务，需要进入任务页面
    if (currentIndex > 0 || task.url || task.selector) {
      await enterTask(task);
      await randomDelay(2000, 3000);
    }

    // 检测实际任务类型（可能和解析的不一致）
    let actualType = task.type;
    if (task.type === TaskType.UNKNOWN || task.type === TaskType.VIDEO || task.type === TaskType.TIMED) {
      actualType = await detectCurrentTaskType();
    }

    // 根据任务类型处理
    switch (actualType) {
      case TaskType.VIDEO:
        logger.info('开始处理视频任务');

        // 检查是否重复进入同一个视频
        const afterSignature = await getCurrentVideoSignature().catch(() => '');
        if (currentIndex > 0 && afterSignature === beforeSignature && afterSignature === lastVideoSignature) {
          logger.warning('检测到重复进入同一个视频，跳过');
          currentIndex++;
          continue;
        }

        lastVideoSignature = afterSignature;

        // 播放视频
        const success = await playVideoComplete((progress: number, currentTime: number, duration: number) => {
          if (onProgress) {
            onProgress(task.name, actualType, progress, currentIndex + 1, tasks.length);
          }
        }, shouldStop);

        if (!success) {
          logger.warning('视频播放失败，继续下一个任务');
        }
        break;

      case TaskType.DOCUMENT:
        await handleDocumentTask();
        break;

      case TaskType.TIMED:
        await handleTimedTask();
        break;

      case TaskType.QUIZ:
        await skipQuizTask();
        break;

      default:
        logger.info('无法识别的任务类型，按计时任务处理');
        await handleTimedTask();
    }

    // 报告进度
    if (onProgress) {
      onProgress(task.name, actualType, 100, currentIndex + 1, tasks.length);
    }

    // 下一轮循环会显式进入任务队列中的下一个任务
    currentIndex++;
  }

  logger.success('任务队列处理完成');
};
