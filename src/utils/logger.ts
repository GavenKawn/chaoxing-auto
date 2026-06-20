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

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 100;
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

  // 设置静默模式（Ink 模式下使用）
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

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

export const logger = new Logger();
