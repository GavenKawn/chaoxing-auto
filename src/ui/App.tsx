import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { LoginView } from './components/LoginView.js';
import { CourseList } from './components/CourseList.js';
import { ProgressPanel } from './components/ProgressPanel.js';
import { LogPanel } from './components/LogPanel.js';
import { theme, icons } from './theme.js';
import { login, loginWithBrowser } from '../browser/auth.js';
import { getCourses } from '../browser/course.js';
import { injectAutoplay, stopAutoplay, getAutoplayStatus } from '../browser/autoplay.js';
import { logger } from '../utils/logger.js';

type AppState = 'login' | 'guide' | 'course_list' | 'playing' | 'completed';

interface PlayState {
  courseName: string;
  chapterName: string;
  taskName: string;
  progress: number;
  currentTime: number;
  duration: number;
}

export const App: React.FC = () => {
  const { exit } = useApp();
  const isRunningRef = useRef(false);
  const statusTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 应用状态
  const [state, setState] = useState<AppState>('login');
  const [error, setError] = useState<string>('');
  const [isBrowserStarted, setIsBrowserStarted] = useState(false);

  // 课程列表
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourseIndex, setSelectedCourseIndex] = useState(0);

  // 播放状态
  const [playState, setPlayState] = useState<PlayState>({
    courseName: '',
    chapterName: '',
    taskName: '',
    progress: 0,
    currentTime: 0,
    duration: 0,
  });

  // 初始化
  useEffect(() => {
    setState('login');
    return () => {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
      }
    };
  }, []);

  const shouldStopRun = () => !isRunningRef.current;

  const startRun = (): boolean => {
    if (isRunningRef.current) {
      logger.warning('已有自动任务正在运行，请先按 s 停止');
      return false;
    }
    isRunningRef.current = true;
    return true;
  };

  const stopRun = () => {
    isRunningRef.current = false;
    // 停止注入的自动播放脚本
    void stopAutoplay();
    // 停止状态轮询
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  };

  // 处理浏览器登录
  const handleBrowserLogin = async () => {
    setError('');
    const success = await loginWithBrowser();

    if (success) {
      setIsBrowserStarted(true);
      setState('guide');
    } else {
      setError('登录失败或超时，请重试');
      setState('login');
    }
  };

  // 处理账号密码登录
  const handlePasswordLogin = async (phone: string, password: string) => {
    setError('');
    const success = await login(phone, password);

    if (success) {
      setIsBrowserStarted(true);
      setState('guide');
    } else {
      setError('登录失败，请检查账号密码');
      setState('login');
    }
  };

  // 启动自动播放（注入脚本方案）
  // v 模式和 a 模式都使用这个方法
  const startAutoplay = async (mode: 'v' | 'a') => {
    setError('');

    if (!isBrowserStarted) {
      setError('请先按 Enter 打开浏览器并完成登录');
      return;
    }

    if (!startRun()) return;

    setState('playing');
    setPlayState(prev => ({
      ...prev,
      taskName: mode === 'v' ? '接管当前视频' : '自动播放任务',
      progress: 0,
      currentTime: 0,
      duration: 0,
    }));

    try {
      logger.info(`[${mode} 模式] 注入自动播放脚本...`);

      // 注入脚本
      const injected = await injectAutoplay();

      if (!injected) {
        setError('注入自动播放脚本失败，请重试');
        setState('guide');
        isRunningRef.current = false;
        return;
      }

      logger.success('自动播放脚本已启动，视频结束后将自动切换下一节');
      logger.info('按 s 停止播放，按 q 停止并退出');

      // 开始轮询状态
      let lastStatusTime = 0;
      let lastTitle = '';

      statusTimerRef.current = setInterval(async () => {
        if (shouldStopRun()) {
          if (statusTimerRef.current) {
            clearInterval(statusTimerRef.current);
            statusTimerRef.current = null;
          }
          return;
        }

        try {
          const status = await getAutoplayStatus();

          if (!status) {
            return;
          }

          // 检查脚本是否还活着
          if (!status.active) {
            logger.info('自动播放脚本已结束');
            if (statusTimerRef.current) {
              clearInterval(statusTimerRef.current);
              statusTimerRef.current = null;
            }
            isRunningRef.current = false;
            setState('completed');
            return;
          }

          // 更新播放状态
          const progress = status.duration > 0
            ? (status.currentTime / status.duration) * 100
            : 0;

          // 标题变化时记录日志
          if (status.title && status.title !== lastTitle) {
            lastTitle = status.title;
            logger.info(`当前播放: ${status.title}`);
          }

          setPlayState(prev => ({
            ...prev,
            taskName: status.title || prev.taskName,
            progress,
            currentTime: status.currentTime,
            duration: status.duration,
          }));

          // 记录状态消息
          if (status.message && status.currentTime !== lastStatusTime) {
            lastStatusTime = status.currentTime;
          }
        } catch (err) {
          // 轮询出错不中断
        }
      }, 1000);
    } catch (err) {
      setError(`自动播放启动失败: ${err}`);
      setState('guide');
      isRunningRef.current = false;
    }
  };

  // 刷新检测当前页面
  const refreshCurrentPage = async () => {
    setError('');

    if (!isBrowserStarted) {
      setError('请先按 Enter 打开浏览器并完成登录');
      return;
    }

    try {
      // 解析课程列表
      const courseList = await getCourses();

      if (courseList.length > 0) {
        setCourses(courseList);
        setState('course_list');
        return;
      }

      setError('当前页面未检测到课程列表，请进入课程页面后重试');
    } catch (err) {
      setError(`刷新检测失败: ${err}`);
    }
  };

  // 键盘输入处理
  useInput((input, key) => {
    if (input === 'q') {
      stopRun();
      exit();
      return;
    }

    if (input === 's') {
      if (state === 'playing') {
        stopRun();
        setState('guide');
        logger.info('已停止播放');
      }
      return;
    }

    if (input === 'r') {
      if (state === 'guide' || state === 'course_list') {
        refreshCurrentPage();
      }
    }

    if (input === 'v') {
      if (state === 'guide' || state === 'course_list' || state === 'playing') {
        startAutoplay('v');
      }
    }

    if (input === 'a') {
      if (state === 'guide' || state === 'course_list') {
        startAutoplay('a');
      }
    }

    if (state === 'course_list') {
      if (key.upArrow) {
        setSelectedCourseIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedCourseIndex(prev => Math.min(courses.length - 1, prev + 1));
      }
    }

    if (state === 'completed') {
      if (key.return) {
        setState('guide');
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* 顶部标题栏 */}
      <Box
        borderStyle="round"
        borderColor={theme.primary}
        paddingX={2}
        marginBottom={1}
      >
        <Text color={theme.primary} bold>
          {icons.logo} chaoxing-auto
        </Text>
        <Text color={theme.textMuted}> by GavenKwan</Text>
        <Box marginLeft={2}>
          <Text color={theme.textMuted} dimColor>
            v1.0.0
          </Text>
        </Box>
      </Box>

      {/* 主内容区 */}
      {state === 'login' && (
        <LoginView
          onBrowserLogin={handleBrowserLogin}
          onPasswordLogin={handlePasswordLogin}
          error={error}
        />
      )}

      {state === 'guide' && (
        <Box flexDirection="column">
          <Text color={theme.success} bold>
            {icons.success} 登录成功
          </Text>
          <Box marginTop={1}>
            <Text color={theme.text}>
              请在浏览器中进入课程章节页或视频任务点页面
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.info}>
              推荐操作：
            </Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.warning}>
              [a] 自动运行当前章节任务（推荐）
            </Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.textMuted}>
              [v] 接管当前视频
            </Text>
          </Box>
          <Box marginLeft={1}>
            <Text color={theme.textMuted}>
              [r] 刷新检测当前页面
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.textMuted}>
              [s] 停止播放 | [q] 退出终端 UI
            </Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color={theme.error}>{error}</Text>
            </Box>
          )}
        </Box>
      )}

      {state === 'course_list' && (
        <CourseList
          courses={courses}
          selectedIndex={selectedCourseIndex}
        />
      )}

      {state === 'playing' && (
        <Box flexDirection="column">
          <ProgressPanel
            currentTask={`${playState.chapterName} - ${playState.taskName}`}
            progress={playState.progress}
            currentTime={playState.currentTime}
            duration={playState.duration}
          />
          <Box marginTop={1}>
            <LogPanel maxLines={8} />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.textMuted}>[s] 停止播放 | [q] 停止并退出</Text>
          </Box>
        </Box>
      )}

      {state === 'completed' && (
        <Box flexDirection="column">
          <Text color={theme.success} bold>
            {icons.success} 当前任务已处理完成
          </Text>
          <Box marginTop={1}>
            <Text color={theme.textMuted}>[Enter] 返回引导页 | [q] 退出</Text>
          </Box>
        </Box>
      )}

      {/* 底部快捷键提示 */}
      <Box marginTop={1}>
        <Text color={theme.textMuted} dimColor>
          [q] 退出
          {state === 'login' && ' | [Enter] 打开浏览器登录'}
          {state === 'guide' && ' | [a] 自动运行 | [v] 检测视频 | [r] 刷新'}
          {state === 'course_list' && ' | [a] 自动运行 | [v] 检测视频 | [r] 刷新'}
          {state === 'playing' && ' | [s] 停止播放'}
          {state === 'course_list' && courses.length > 0 && ' | [↑↓] 选择'}
        </Text>
      </Box>
    </Box>
  );
};
