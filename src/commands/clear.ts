import { clearAll, clearCookies } from '../utils/storage.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export const clearCommand = async (options: { all?: boolean }) => {
  if (options.all) {
    clearAll();
    logger.success('已清除所有缓存数据');
  } else {
    clearCookies();
    logger.success('已清除登录状态');
  }
  
  console.log(chalk.gray('\n提示: 使用 chaoxing clear --all 清除所有数据'));
};
