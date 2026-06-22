import { launchBrowser, saveCurrentCookies, checkLoginStatus } from './launcher.js';
import { APP_CONFIG, isTrustedChaoxingUrl } from '../utils/config.js';
import { saveUsername } from '../utils/storage.js';
import { logger } from '../utils/logger.js';

// 等待登录成功 - 只做被动检测，不主动刷新或跳转页面
const waitForLoginSuccess = async (
  page: any,
  timeout: number = 180000
): Promise<boolean> => {
  const startTime = Date.now();
  const checkInterval = 1500; // 每1.5秒检查一次

  while (Date.now() - startTime < timeout) {
    try {
      const url = page.url();

      // 登录成功后通常会跳转到 i.chaoxing.com 或 mooc1.chaoxing.com
      // 且不再在 passport2.chaoxing.com/login 页面
      if (
        (url.includes('i.chaoxing.com') || url.includes('mooc1.chaoxing.com') || url.includes('mooc2-ans.chaoxing.com')) &&
        !url.includes('passport2.chaoxing.com/login')
      ) {
        // URL 已经跳转到可信域名，说明登录成功
        return true;
      }

      // 如果页面上出现用户信息，也认为登录成功
      if (isTrustedChaoxingUrl(url)) {
        const userInfo = await page.$(
          '.user-name, .userName, .avatar, [class*="user"], [class*="User"]'
        );

        if (userInfo) {
          return true;
        }
      }

      // 如果仍在 passport2.chaoxing.com 登录页，不要刷新，不要跳转
      // 用户可能正在扫码、输入验证码或完成滑块验证
      // 对于非 chaoxing 域名（如 about:blank、重定向中间页），继续等待
    } catch {
      // 忽略临时检测错误，继续等待
    }

    await page.waitForTimeout(checkInterval);
  }

  return false;
};

// 通过浏览器登录（推荐）
export const loginWithBrowser = async (): Promise<boolean> => {
  try {
    const page = await launchBrowser(false);

    logger.info('正在打开学习通登录页...');
    await page.goto(APP_CONFIG.urls.login, { waitUntil: 'domcontentloaded' });

    logger.info('请在浏览器中完成扫码、短信验证码或账号密码登录...');
    const success = await waitForLoginSuccess(page, 180000); // 最长等待3分钟

    if (!success) {
      logger.error('登录超时，请重新尝试');
      return false;
    }

    await saveCurrentCookies();
    logger.success('登录成功，登录状态已保存');

    // 不关闭浏览器，后续操作（a/v/r）需要浏览器保持打开
    // 用户可在浏览器中进入课程页面

    return true;
  } catch (error) {
    logger.error(`登录过程出错: ${error}`);
    return false;
  }
};

// 登录学习通（账号密码方式）
export const login = async (phone: string, password: string): Promise<boolean> => {
  try {
    const page = await launchBrowser(false); // 登录时显示浏览器

    logger.info('正在访问登录页面...');
    await page.goto(APP_CONFIG.urls.login, { waitUntil: 'networkidle' });

    // 等待登录表单加载
    await page.waitForSelector('#phone, #username', { timeout: 10000 });

    // 点击账号密码登录方式（如果存在）
    const pwdLoginTab = await page.$('text=密码登录');
    if (pwdLoginTab) {
      await pwdLoginTab.click();
      await page.waitForTimeout(500);
    }

    logger.info('正在填写登录信息...');

    // 填写手机号
    const phoneInput = await page.$('#phone, #username, input[placeholder*="手机"], input[placeholder*="账号"]');
    if (phoneInput) {
      await phoneInput.fill(phone);
    }

    // 填写密码
    const pwdInput = await page.$('#pwd, #password, input[type="password"], input[placeholder*="密码"]');
    if (pwdInput) {
      await pwdInput.fill(password);
    }

    logger.info('请在浏览器中完成验证码验证（如有）...');

    // 点击登录按钮
    const loginBtn = await page.$('#loginBtn, button:has-text("登录"), input[type="submit"][value="登录"]');
    if (loginBtn) {
      await loginBtn.click();
    }

    // 等待登录成功（使用被动检测，不主动等待特定 URL）
    logger.info('等待登录完成...');

    const success = await waitForLoginSuccess(page, 60000);

    if (success) {
      logger.success('登录成功！');

      // 保存 cookies 和用户名
      await saveCurrentCookies();
      saveUsername(phone);

      // 不关闭浏览器，后续操作（a/v/r）需要浏览器保持打开

      return true;
    } else {
      // 检查是否有错误提示
      const errorMsg = await page.$('.error-msg, .errorTip, text=密码错误, text=账号不存在');
      if (errorMsg) {
        const text = await errorMsg.textContent();
        logger.error(`登录失败: ${text || '未知错误'}`);
      } else {
        logger.error('登录超时，请检查网络或账号密码');
      }
      return false;
    }
  } catch (error) {
    logger.error(`登录过程出错: ${error}`);
    return false;
  }
};

// 检查并自动登录
export const ensureLogin = async (): Promise<boolean> => {
  const isLoggedIn = await checkLoginStatus();
  
  if (isLoggedIn) {
    logger.success('已检测到登录状态');
    return true;
  }
  
  return false;
};
