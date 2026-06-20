# chaoxing-auto

> 学习通自动刷课 CLI 工具 - 终端一键完成视频观看任务

[![npm version](https://img.shields.io/npm/v/chaoxing-auto.svg)](https://www.npmjs.com/package/chaoxing-auto)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/chaoxing-auto.svg)](https://nodejs.org)

## 项目简介

学习通自动刷课 CLI 工具。基于 Playwright 浏览器自动化，通过终端交互式界面一键完成视频观看任务，支持自动切换下一小节、防暂停保护、断点续刷等功能。

## 快速开始

克隆项目：

```bash
git clone https://github.com/GavenKwan/chaoxing-auto.git
cd chaoxing-auto
```

安装依赖：

```bash
npm install
```

启动：

```bash
npm start
```

首次启动时，终端会显示登录界面。按 Enter 后会打开学习通官方登录页，你可以使用扫码、短信验证码或账号密码登录。登录成功后，终端会显示课程列表。

## 常用命令

启动交互式界面：

```bash
npm start
```

单独登录：

```bash
npm run login
```

清除登录状态：

```bash
npm run clear
```

列出课程：

```bash
npm run list
```

账号密码登录（备用）：

```bash
npm run login -- --password
```

## 功能特性

- 自动播放视频 - 自动穿透 iframe 找到视频元素并播放
- 倍速播放 - 支持 1.5x-2x 随机倍速，模拟真实观看
- 自动静音 - 静音播放，不打扰工作
- 防暂停保护 - 拦截平台暂停机制，持续播放
- 断点续刷 - 记录播放进度，中断后可继续
- 精美终端 UI - 基于 Ink (React for CLI) 的现代化界面
- 实时进度显示 - 进度条、剩余时间、播放速度一目了然
- Cookie 持久化 - 登录状态自动保存，无需重复登录
- 智能课程解析 - 自动获取课程列表和任务点

## 终端截图

```
╔══════════════════════════════════════════════════════════════╗
║  ● chaoxing-auto by GavenKwan        v1.0.0                   ║
╚══════════════════════════════════════════════════════════════╝

课程列表

> 高等数学（上）
  张老师 | 45%
  
  大学物理
  李老师 | 78%
  
  程序设计基础
  王老师 | 100%

[↑/↓] 选择 | [Enter] 开始 | [q] 退出
```

## 开发

开发模式：

```bash
npm run dev
```

构建：

```bash
npm run build
```

类型检查：

```bash
npm run typecheck
```

## 全局安装

项目发布到 npm 后，可以通过以下方式安装：

```bash
npm install -g chaoxing-auto
chaoxing
```

## 项目结构

```
chaoxing-auto/
├── bin/
│   └── cli.ts              # CLI 入口
├── src/
│   ├── index.ts            # 主入口
│   ├── commands/           # CLI 命令
│   │   ├── login.ts
│   │   ├── run.ts
│   │   ├── list.ts
│   │   └── clear.ts
│   ├── browser/            # 浏览器自动化
│   │   ├── launcher.ts
│   │   ├── auth.ts
│   │   ├── video.ts
│   │   ├── course.ts
│   │   └── anti-detect.ts
│   ├── ui/                 # 终端 UI
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── theme.ts
│   └── utils/              # 工具函数
│       ├── config.ts
│       ├── storage.ts
│       └── logger.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## 技术栈

- TypeScript - 类型安全
- Commander - CLI 框架
- Ink - React for CLI
- Playwright - 浏览器自动化
- Chalk - 终端颜色
- Boxen - 边框装饰
- Conf - 配置持久化

## 安全说明

- 本工具仅供技术学习和研究。
- 使用者应遵守学校、课程平台和相关规则。
- 自动化访问可能导致账号、课程记录或平台风控风险。
- 默认推荐浏览器扫码/验证码登录，不推荐在不可信环境中输入真实账号密码。
- Cookie 会保存在本机配置目录中。
- 可以通过 `npm run clear` 命令删除 Cookie。
- 密码输入会遮蔽显示，不会保存到本地，不会打印到日志。

## 免责声明

本工具仅供学习和研究使用，请勿用于违反学校规定的行为。使用本工具产生的任何后果由使用者自行承担。

## 许可证

[MIT](LICENSE) © GavenKwan

## 作者

**GavenKwan**

- GitHub: [@GavenKwan](https://github.com/GavenKwan)

## 贡献

欢迎提交 Issue 和 Pull Request！

---

如果这个项目对你有帮助，请给一个 Star！