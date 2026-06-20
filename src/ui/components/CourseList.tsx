import React from 'react';
import { Box, Text } from 'ink';
import { theme, icons } from '../theme.js';
import type { Course } from '../../browser/course.js';

interface CourseListProps {
  courses: Course[];
  selectedIndex: number;
}

export const CourseList: React.FC<CourseListProps> = ({
  courses,
  selectedIndex,
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={theme.text} bold>
          课程列表
        </Text>
      </Box>

      {/* 课程列表 */}
      {courses.length === 0 ? (
        <Box flexDirection="column" padding={1}>
          <Text color={theme.warning}>
            当前页面未检测到课程列表
          </Text>
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              你可以：
            </Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.textMuted}>1. 在浏览器中进入视频任务点后按 v</Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.textMuted}>2. 在浏览器中进入章节页后按 r</Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.textMuted}>3. 在浏览器中进入课程列表后按 r</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {courses.map((course, index) => (
            <Box key={course.id} marginBottom={1}>
              {/* 选择指示器 */}
              <Box width={3}>
                <Text color={theme.primary}>
                  {index === selectedIndex ? `${icons.arrow} ` : '  '}
                </Text>
              </Box>

              {/* 课程信息 */}
              <Box flexDirection="column">
                <Text
                  color={index === selectedIndex ? theme.text : theme.textMuted}
                  bold={index === selectedIndex}
                >
                  {course.name}
                </Text>
                <Box>
                  <Text color={theme.textMuted} dimColor>
                    {course.teacher}
                  </Text>
                  <Text color={theme.textMuted}> | </Text>
                  <Text
                    color={
                      course.progress >= 100
                        ? theme.success
                        : course.progress > 0
                        ? theme.warning
                        : theme.textMuted
                    }
                  >
                    {course.progress}%
                  </Text>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* 提示 */}
      {courses.length > 0 && (
        <Box marginTop={1}>
          <Text color={theme.textMuted} dimColor>
            [↑/↓] 选择 | [Enter] 开始 | [q] 退出
          </Text>
        </Box>
      )}
    </Box>
  );
};
