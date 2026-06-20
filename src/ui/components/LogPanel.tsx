import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme, icons } from '../theme.js';
import { logger, LogLevel, LogEntry } from '../../utils/logger.js';

interface LogPanelProps {
  maxLines?: number;
}

export const LogPanel: React.FC<LogPanelProps> = ({ maxLines = 10 }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    // 设置 logger 为静默模式，避免 console.log 干扰 Ink 渲染
    logger.setQuiet(true);

    // 定期更新日志
    const interval = setInterval(() => {
      const allLogs = logger.getLogs();
      setLogs(allLogs.slice(-maxLines));
    }, 500);

    return () => {
      clearInterval(interval);
      logger.setQuiet(false);
    };
  }, [maxLines]);

  // 根据日志级别获取颜色
  const getLogColor = (level: LogLevel): string => {
    switch (level) {
      case LogLevel.SUCCESS:
        return theme.success;
      case LogLevel.ERROR:
        return theme.error;
      case LogLevel.WARNING:
        return theme.warning;
      default:
        return theme.text;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      padding={1}
      height={maxLines + 4}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          {icons.info} 操作日志
        </Text>
      </Box>

      {/* 日志内容 */}
      <Box flexDirection="column">
        {logs.map((log, index) => (
          <Box key={index}>
            <Text color={theme.textMuted} dimColor>
              [{log.timestamp}]
            </Text>
            <Text color={getLogColor(log.level)}> {log.icon} </Text>
            <Text color={getLogColor(log.level)}>
              {log.message}
            </Text>
          </Box>
        ))}
        
        {logs.length === 0 && (
          <Text color={theme.textMuted} dimColor>
            暂无日志
          </Text>
        )}
      </Box>
    </Box>
  );
};
