import Table from 'cli-table3';
import chalk from 'chalk';
import { getCourses } from '../browser/course.js';
import { launchBrowser, closeBrowser, checkLoginStatus } from '../browser/launcher.js';
import { logger } from '../utils/logger.js';
import { loadUsername } from '../utils/storage.js';

export const listCommand = async () => {
  try {
    // 检查登录状态
    await launchBrowser(true); // 无头模式
    const isLoggedIn = await checkLoginStatus();
    
    if (!isLoggedIn) {
      logger.error('未登录，请先运行 chaoxing login');
      await closeBrowser();
      process.exit(1);
    }
    
    // 获取课程列表
    const courses = await getCourses();
    await closeBrowser();
    
    if (courses.length === 0) {
      logger.warning('没有找到课程');
      return;
    }
    
    // 创建表格
    const table = new Table({
      head: [
        chalk.cyan.bold('序号'),
        chalk.cyan.bold('课程名称'),
        chalk.cyan.bold('教师'),
        chalk.cyan.bold('进度'),
      ],
      colWidths: [6, 40, 15, 10],
      style: {
        head: [],
        border: ['gray'],
      },
    });
    
    // 添加数据
    courses.forEach((course, index) => {
      const progressColor = course.progress >= 100 ? chalk.green :
                           course.progress > 0 ? chalk.yellow : chalk.gray;
      
      table.push([
        index + 1,
        course.name,
        course.teacher,
        progressColor(`${course.progress}%`),
      ]);
    });
    
    // 显示表格
    console.log('\n' + table.toString());
    
    // 显示用户信息
    const username = loadUsername();
    if (username) {
      console.log(chalk.gray(`\n账号: ${username}`));
    }
    
    console.log(chalk.gray(`共 ${courses.length} 门课程\n`));
    
  } catch (error) {
    logger.error(`获取课程列表失败: ${error}`);
    await closeBrowser();
    process.exit(1);
  }
};
