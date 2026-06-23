import chalk from 'chalk';

export enum LogLevel {
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  icon: string;
}

// 日志分类
export type LogCategory =
  | 'LOGIN'
  | 'COURSE'
  | 'CHAPTER'
  | 'TASK'
  | 'VIDEO'
  | 'PPT'
  | 'QUIZ'
  | 'FRAME'
  | 'STATE'
  | 'RECOVER'
  | 'SYSTEM';

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 200;
  private quiet = false;

  private getTimestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  private addLog(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  setQuiet(quiet: boolean) {
    this.quiet = quiet;
  }

  private getIcon(level: LogLevel): string {
    switch (level) {
      case LogLevel.SUCCESS:
        return '✓';
      case LogLevel.ERROR:
        return '✗';
      case LogLevel.WARNING:
        return '⚠';
      case LogLevel.DEBUG:
        return '⚡';
      default:
        return 'ℹ';
    }
  }

  private formatLog(entry: LogEntry): string {
    const icon = entry.icon;
    let coloredIcon: string;

    switch (entry.level) {
      case LogLevel.SUCCESS:
        coloredIcon = chalk.green(icon);
        break;
      case LogLevel.ERROR:
        coloredIcon = chalk.red(icon);
        break;
      case LogLevel.WARNING:
        coloredIcon = chalk.yellow(icon);
        break;
      case LogLevel.DEBUG:
        coloredIcon = chalk.gray(icon);
        break;
      default:
        coloredIcon = chalk.blue(icon);
    }

    return `[${entry.timestamp}] ${coloredIcon} ${entry.message}`;
  }

  // 基础日志方法
  info(message: string) {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: LogLevel.INFO,
      message,
      icon: this.getIcon(LogLevel.INFO),
    };
    this.addLog(entry);
    if (!this.quiet) {
      console.log(this.formatLog(entry));
    }
  }

  success(message: string) {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: LogLevel.SUCCESS,
      message,
      icon: this.getIcon(LogLevel.SUCCESS),
    };
    this.addLog(entry);
    if (!this.quiet) {
      console.log(this.formatLog(entry));
    }
  }

  warning(message: string) {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: LogLevel.WARNING,
      message,
      icon: this.getIcon(LogLevel.WARNING),
    };
    this.addLog(entry);
    if (!this.quiet) {
      console.log(this.formatLog(entry));
    }
  }

  error(message: string) {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: LogLevel.ERROR,
      message,
      icon: this.getIcon(LogLevel.ERROR),
    };
    this.addLog(entry);
    if (!this.quiet) {
      console.log(this.formatLog(entry));
    }
  }

  debug(message: string) {
    const entry: LogEntry = {
      timestamp: this.getTimestamp(),
      level: LogLevel.DEBUG,
      message,
      icon: this.getIcon(LogLevel.DEBUG),
    };
    this.addLog(entry);
    if (!this.quiet) {
      console.log(this.formatLog(entry));
    }
  }

  // 分类日志方法 - 带标签的日志，方便排查问题
  log(category: LogCategory, message: string, level: LogLevel = LogLevel.INFO) {
    const taggedMessage = `[${category}] ${message}`;
    switch (level) {
      case LogLevel.SUCCESS:
        this.success(taggedMessage);
        break;
      case LogLevel.ERROR:
        this.error(taggedMessage);
        break;
      case LogLevel.WARNING:
        this.warning(taggedMessage);
        break;
      case LogLevel.DEBUG:
        this.debug(taggedMessage);
        break;
      default:
        this.info(taggedMessage);
    }
  }

  // 状态转换日志
  stateChange(oldState: string, newState: string) {
    this.log('STATE', `${oldState} -> ${newState}`, LogLevel.INFO);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

export const logger = new Logger();
