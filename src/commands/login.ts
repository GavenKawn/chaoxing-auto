import * as readline from 'readline';
import { login, loginWithBrowser } from '../browser/auth.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import boxen from 'boxen';

interface LoginOptions {
  password?: boolean;
}

// 修复 readline 泄漏：使用 try/finally 确保 rl.close()
function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    } finally {
      rl.close();
    }
  });
}

function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    
    if (process.stdin.isTTY) {
      const wasRaw = process.stdin.isRaw;
      
      process.stdin.setRawMode(true);
      process.stdin.resume();
      
      let password = '';
      
      const onData = (char: Buffer) => {
        const c = char.toString('utf8');
        
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.setRawMode(wasRaw || false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(password);
            break;
          case '\u0003':
            process.stdout.write('\n');
            process.exit(1);
            break;
          case '\u007F':
          case '\b':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.clearLine(0);
              process.stdout.cursorTo(0);
              process.stdout.write(prompt + '*'.repeat(password.length));
            }
            break;
          default:
            password += c;
            process.stdout.write('*');
            break;
        }
      };
      
      process.stdin.on('data', onData);
    } else {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export const loginCommand = async (options: LoginOptions = {}) => {
  console.log(boxen(
    chalk.cyan.bold('● chaoxing-auto') + chalk.gray(' by GavenKwan\n\n') +
    chalk.white('学习通自动刷课工具'),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  ));

  if (options.password) {
    let phone = process.env.CHAOXING_PHONE || '';
    let password = process.env.CHAOXING_PASSWORD || '';

    if (!phone) {
      console.log(chalk.yellow('请输入登录信息：\n'));
      phone = await question(chalk.cyan('手机号: '));
      
      if (!phone) {
        logger.error('手机号不能为空');
        process.exit(1);
      }
    }

    if (!password) {
      password = await questionHidden(chalk.cyan('密码: '));
      
      if (!password) {
        logger.error('密码不能为空');
        process.exit(1);
      }
    }

    console.log(chalk.gray('\n正在登录，请在浏览器中完成验证码验证（如有）...\n'));

    const success = await login(phone, password);

    if (success) {
      logger.success('登录成功！Cookie 已保存');
      console.log(chalk.gray('\n现在可以运行 chaoxing run 开始刷课'));
    } else {
      logger.error('登录失败，请检查账号密码');
      process.exit(1);
    }
  } else {
    console.log(chalk.gray('正在打开学习通登录页...\n'));
    console.log(chalk.white('请在浏览器中完成扫码、短信验证码或账号密码登录'));
    console.log(chalk.gray('登录成功后会自动保存 Cookie\n'));

    const success = await loginWithBrowser();

    if (success) {
      logger.success('登录成功！Cookie 已保存');
      console.log(chalk.gray('\n现在可以运行 chaoxing run 开始刷课'));
    } else {
      logger.error('登录失败或超时');
      process.exit(1);
    }
  }
};