import { Page } from 'playwright';
import * as readline from 'readline';
import { getPage } from './launcher.js';
import { APP_CONFIG, TaskType, isTrustedChaoxingUrl } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { randomDelay } from './anti-detect.js';
import { parseChaptersFromPage, waitForChapterPage } from './chapter-parser.js';

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

// 等待用户在终端按 Enter
const waitForEnter = (message: string): Promise<void> => {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      rl.question(message, () => resolve());
    } finally {
      rl.close();
    }
  });
};

// 获取课程列表 - 从当前页面解析
export const getCourses = async (): Promise<Course[]> => {
  const page = getPage();
  const courses: Course[] = [];

  try {
    logger.info('正在获取课程列表...');
    await randomDelay();

    const url = page.url();
    if (!isTrustedChaoxingUrl(url)) {
      logger.warning('当前页面不是官方学习通域名');
      return [];
    }

    await page.waitForLoadState('domcontentloaded');
    const courseElements = await page.$$('.course, .Mcourse, ul.course-list li, .course-cover, .course-item');
    logger.debug(`找到 ${courseElements.length} 个课程候选元素`);

    if (courseElements.length === 0) {
      logger.warning('未检测到课程列表，请确保已进入课程页面');
      return [];
    }

    for (const el of courseElements) {
      try {
        const link = await el.$('a');
        if (!link) continue;

        const url = await link.getAttribute('href') || '';
        const id = url.match(/courseid=(\d+)/)?.[1] || url.match(/course_(\d+)/)?.[1] || '';
        const nameEl = await el.$('.course-name, h3, .title');
        const name = await nameEl?.textContent() || '未知课程';
        const teacherEl = await el.$('.teacher, .teacher-name');
        const teacher = await teacherEl?.textContent() || '';
        const progressEl = await el.$('.progress, .course-progress');
        const progressText = await progressEl?.textContent() || '0%';
        const progress = parseInt(progressText.match(/\d+/)?.[0] || '0');

        courses.push({ id, name: name.trim(), teacher: teacher.trim(), progress, url });
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

// [备用方案] 进入课程并获取章节列表
export const getCourseChapters = async (courseUrl: string): Promise<Chapter[]> => {
  const page = getPage();

  try {
    logger.info('正在进入课程...');
    const fullUrl = courseUrl.startsWith('http') ? courseUrl : new URL(courseUrl, page.url()).toString();

    if (!isTrustedChaoxingUrl(fullUrl)) {
      logger.error('课程链接不是官方学习通域名，已跳过');
      return [];
    }

    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    await randomDelay();

    let isChapterPage = await waitForChapterPage(page);
    if (!isChapterPage) {
      logger.warning('未能自动进入课程章节页');
      await waitForEnter('请在浏览器中手动进入该课程的"章节"页面，完成后按 Enter 继续... ');
      isChapterPage = await waitForChapterPage(page, 5000);
      if (!isChapterPage) {
        logger.error('仍未识别到章节页，请确认当前页面为课程章节页');
        return [];
      }
    }

    return await parseChaptersFromPage(page);
  } catch (error) {
    logger.error(`获取章节列表失败: ${error}`);
    return [];
  }
};

// [备用方案] 从当前页面解析章节和任务点（不跳转）
export const getCourseChaptersFromCurrentPage = async (): Promise<Chapter[]> => {
  const page = getPage();

  try {
    logger.info('正在检测当前页面...');
    const url = page.url();
    if (!isTrustedChaoxingUrl(url)) {
      logger.warning('当前页面不是官方学习通域名');
      return [];
    }

    await page.waitForLoadState('domcontentloaded');
    const isChapterPage = await waitForChapterPage(page, 3000);
    if (!isChapterPage) {
      logger.warning('当前页面不是章节页');
      return [];
    }

    return await parseChaptersFromPage(page);
  } catch (error) {
    logger.error(`解析章节失败: ${error}`);
    return [];
  }
};
