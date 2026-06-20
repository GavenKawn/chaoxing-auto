#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { loginCommand } from '../src/commands/login.js';
import { runCommand } from '../src/commands/run.js';
import { listCommand } from '../src/commands/list.js';
import { clearCommand } from '../src/commands/clear.js';

// 显示 Logo
const showLogo = () => {
  console.log(boxen(
    chalk.cyan.bold('⚡ chaoxing-auto') + chalk.gray(' by GavenKwan'),
    {
      padding: { left: 2, right: 2, top: 0, bottom: 0 },
      margin: { left: 0, right: 0, top: 1, bottom: 1 },
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  ));
};

// 创建 CLI 程序
const program = new Command();

program
  .name('chaoxing')
  .description('学习通自动刷课 CLI 工具')
  .version('1.0.0')
  .hook('preAction', () => {
    showLogo();
  });

// 默认命令 - 直接运行时启动交互式界面
program
  .argument('[command]', '子命令')
  .action(async (command) => {
    // 如果没有指定子命令，启动交互式界面
    if (!command) {
      await runCommand();
    }
  });

// run 命令 - 主命令，启动交互式界面
program
  .command('run')
  .description('启动交互式刷课界面')
  .action(async () => {
    await runCommand();
  });

// login 命令 - 登录
program
  .command('login')
  .description('登录学习通账号')
  .option('-p, --password', '使用账号密码登录（默认使用浏览器登录）')
  .action(async (options) => {
    await loginCommand(options);
  });

// list 命令 - 列出课程
program
  .command('list')
  .alias('ls')
  .description('列出所有课程')
  .action(async () => {
    await listCommand();
  });

// clear 命令 - 清除缓存
program
  .command('clear')
  .description('清除缓存数据')
  .option('-a, --all', '清除所有数据')
  .action(async (options) => {
    await clearCommand(options);
  });

// 解析命令行参数
program.parse();
