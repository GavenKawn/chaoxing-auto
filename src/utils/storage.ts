import Conf from 'conf';
import type { Cookie } from 'playwright';

// 存储的数据结构
interface StorageData {
  cookies: Cookie[];
  username: string;
  courses: CourseProgress[];
  lastSync: string;
}

interface CourseProgress {
  courseId: string;
  courseName: string;
  progress: number;
  lastVideoId: string;
  lastPosition: number;
  completedVideos: string[];
}

// 创建存储实例
const storage = new Conf<StorageData>({
  projectName: 'chaoxing-auto',
  defaults: {
    cookies: [],
    username: '',
    courses: [],
    lastSync: '',
  },
});

// Cookie 操作
export const saveCookies = (cookies: Cookie[]) => {
  storage.set('cookies', cookies);
  storage.set('lastSync', new Date().toISOString());
};

export const loadCookies = (): Cookie[] => {
  return storage.get('cookies');
};

export const clearCookies = () => {
  storage.set('cookies', []);
  storage.set('username', '');
};

// 用户名操作
export const saveUsername = (username: string) => {
  storage.set('username', username);
};

export const loadUsername = (): string => {
  return storage.get('username');
};

// 课程进度操作
export const saveCourseProgress = (progress: CourseProgress) => {
  const courses = storage.get('courses');
  const index = courses.findIndex(c => c.courseId === progress.courseId);
  
  if (index >= 0) {
    courses[index] = progress;
  } else {
    courses.push(progress);
  }
  
  storage.set('courses', courses);
};

export const loadCourseProgress = (courseId: string): CourseProgress | undefined => {
  const courses = storage.get('courses');
  return courses.find(c => c.courseId === courseId);
};

export const loadAllCourseProgress = (): CourseProgress[] => {
  return storage.get('courses');
};

// 清除所有数据
export const clearAll = () => {
  storage.clear();
};

export type { CourseProgress };
