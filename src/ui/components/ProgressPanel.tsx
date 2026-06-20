import React from 'react';
import { Box, Text } from 'ink';
import { theme, icons, progressChars } from '../theme.js';

interface ProgressPanelProps {
  currentTask: string;
  progress: number;
  currentTime: number;
  duration: number;
  speed?: string;
}

export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  currentTask,
  progress,
  currentTime,
  duration,
  speed = '1.5x',
}) => {
  // 格式化时间
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 生成进度条
  const generateProgressBar = (percent: number, width: number = 30): string => {
    const complete = Math.floor((percent / 100) * width);
    const incomplete = width - complete;
    
    return (
      progressChars.complete.repeat(complete) +
      progressChars.incomplete.repeat(incomplete)
    );
  };

  // 计算剩余时间
  const remainingTime = Math.max(0, duration - currentTime);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      padding={1}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={theme.text} bold>
          {icons.play} 刷课进度
        </Text>
      </Box>

      {/* 当前任务 */}
      <Box marginBottom={1}>
        <Text color={theme.textMuted}>任务: </Text>
        <Text color={theme.text}>
          {currentTask || '无'}
        </Text>
      </Box>

      {/* 进度条 */}
      <Box marginBottom={1}>
        <Text color={theme.success}>{generateProgressBar(progress)}</Text>
        <Text color={theme.text}> </Text>
        <Text color={theme.textHighlight} bold>
          {progress.toFixed(1)}%
        </Text>
      </Box>

      {/* 时间信息 */}
      <Box>
        <Text color={theme.textMuted}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Text>
        <Text color={theme.textMuted}> | </Text>
        <Text color={theme.textMuted}>剩余: {formatTime(remainingTime)}</Text>
        <Text color={theme.textMuted}> | </Text>
        <Text color={theme.info}>{speed}</Text>
      </Box>
    </Box>
  );
};
