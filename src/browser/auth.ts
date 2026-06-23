import { launchBrowser, saveCurrentCookies, checkLoginStatus } from './launcher.js';
import { APP_CONFIG, isTrustedChaoxingUrl } from '../utils/config.js';
import { saveUsername } from '../utils/storage.js';
import { logger, LogLevel } from '../utils/logger.js';

// 增强的登录检测 - 多重验证，避免假登录
const checkLoginSuccess = async (page: any): Promise<boolean> => {
  try {
    const url = page.url();

    // 1. URL 检测：登录成功后通常会跳转到 i.chaoxing.com 或 mooc1.chaoxing.com
    const isTrustedUrl =
      url.includes('i.chaoxing.com') ||
      url.includes('mooc1.chaoxing.com') ||
      url.includes('mooc2-ans.chaoxing.com');

    if (!isTrustedUrl || url.includes('passport2.chaoxing.com/login')) {
      return false;
    }

    // 2. Cookie 检测：检查关键 cookie 是否存在
    const cookies = await page.context().cookies();
    const hasUID = cookies.some((c: any) => c.name === 'UID' && c.value && c.value.length > 0);
    const hasfid = cookies.some((c: any) => c.name === 'fid' && c.value && c.value.length > 0);
    const hasName = cookies.some((c: any) => c.name === '_name' && c.value && c.value.length > 0);

    // 3. DOM 检测：检查用户头像、用户名是否存在
    const hasUserInfo = await page.$(
      '.user-name, .userName, .avatar, [class*="user"], [class*="User"]'
    ).then((el: any) => !!el).catch(() => false);

    // 4. 登录按钮检测：登录按钮是否消失
    const hasLoginButton = await page.$(
      'a:has-text("登录"), button:has-text("登录")'
    ).then((el: any) => !!el).catch(() => false);

    // 综合判断：满足多个条件才认为登录成功
    // 条件1：URL 是可信域名且不在登录页
    // 条件2：有 UID cookie 或 _name cookie
    // 条件3：有用户信息 DOM 或没有登录按钮
    const cookieValid = hasUID || hasName;
    const domValid = hasUserInfo || !hasLoginButton;

    if (cookieValid && domValid) {
      logger.log('LOGIN', '登录验证通过: cookie + DOM 双重验证', LogLevel.SUCCESS);
      return true;
    }

    // 如果 URL 在可信域名，且有 fid cookie，也认为登录成功
    if (isTrustedUrl && hasfid) {
      logger.log('LOGIN', '登录验证通过: URL + fid cookie', LogLevel.SUCCESS);
      return true;
    }

    return false;
  } catch (e) {
    logger.debug(`[LOGIN] 登录检测出错: ${e}`);
    return false;
  }
};

// 等待登录成功 - 被动检测，不主动刷新或跳转页面
const waitForLoginSuccess = async (
  page: any,
  timeout: number = 180000
): Promise<boolean> => {
  const startTime = Date.now();
  const checkInterval = 1500;

  while (Date.now() - startTime < timeout) {
    try {
      // 使用增强的登录检测
      if (await checkLoginSuccess(page)) {
        return true;
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

    logger.log('LOGIN', '正在打开学习通登录页...');
    await page.goto(APP_CONFIG.urls.login, { waitUntil: 'domcontentloaded' });

    logger.log('LOGIN', '请在浏览器中完成扫码、短信验证码或账号密码登录...');
    const success = await waitForLoginSuccess(page, 180000);

    if (!success) {
      logger.error('[LOGIN] 登录超时，请重新尝试');
      return false;
    }

    await saveCurrentCookies();
    logger.success('[LOGIN] 登录成功，登录状态已保存');

    // 不关闭浏览器，后续操作（a/v/r）需要浏览器保持打开
    return true;
  } catch (error) {
    logger.error(`[LOGIN] 登录过程出错: ${error}`);
    return false;
  }
};

// 登录学习通（账号密码方式）
export const login = async (phone: string, password: string): Promise<boolean> => {
  try {
    const page = await launchBrowser(false);

    logger.log('LOGIN', '正在访问登录页面...');
    await page.goto(APP_CONFIG.urls.login, { waitUntil: 'networkidle' });

    // 等待登录表单加载
    await page.waitForSelector('#phone, #username', { timeout: 10000 });

    // 点击账号密码登录方式（如果存在）
    const pwdLoginTab = await page.$('text=密码登录');
    if (pwdLoginTab) {
      await pwdLoginTab.click();
      await page.waitForTimeout(500);
    }

    logger.log('LOGIN', '正在填写登录信息...');

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

    logger.log('LOGIN', '请在浏览器中完成验证码验证（如有）...');

    // 点击登录按钮
    const loginBtn = await page.$('#loginBtn, button:has-text("登录"), input[type="submit"][value="登录"]');
    if (loginBtn) {
      await loginBtn.click();
    }

    logger.log('LOGIN', '等待登录完成...');

    const success = await waitForLoginSuccess(page, 60000);

    if (success) {
      logger.success('[LOGIN] 登录成功！');

      await saveCurrentCookies();
      saveUsername(phone);

      return true;
    } else {
      const errorMsg = await page.$('.error-msg, .errorTip, text=密码错误, text=账号不存在');
      if (errorMsg) {
        const text = await errorMsg.textContent();
        logger.error(`[LOGIN] 登录失败: ${text || '未知错误'}`);
      } else {
        logger.error('[LOGIN] 登录超时，请检查网络或账号密码');
      }
      return false;
    }
  } catch (error) {
    logger.error(`[LOGIN] 登录过程出错: ${error}`);
    return false;
  }
};

// 检查并自动登录
export const ensureLogin = async (): Promise<boolean> => {
  const isLoggedIn = await checkLoginStatus();

  if (isLoggedIn) {
    logger.success('[LOGIN] 已检测到登录状态');
    return true;
  }

  return false;
};
