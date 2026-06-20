import { getPage, getLearningPage } from './launcher.js';
import { logger } from '../utils/logger.js';

/**
 * 自动播放注入脚本（原创实现）
 *
 * 核心原理：脚本在页面内部运行，直接监听 video 的 ended 事件，
 * 触发后立即调用 nextUnit() 点击下一节，无需外部轮询。
 *
 * 功能：
 * 1. 在嵌套 iframe 中查找 video 元素
 * 2. 自动播放（静音、1.5 倍速）
 * 3. 监听 ended 事件 → 自动切换下一小节
 * 4. 检测"学习目标"页 → 点击"视频"页签
 * 5. 检测章节测验 → 点击 #prevNextFocusNext 跳过
 * 6. 检测 PPT/文档 → 自动翻页到底部后跳转
 * 7. 视频卡顿检测（7 秒无进度 → 恢复播放）
 * 8. 页面失焦/切后台 → 保持播放
 * 9. 通过 window.__chaoxingAutoStop 控制停止
 */
const AUTOPLAY_SCRIPT = `
(function() {
  if (window.__chaoxingAutoplayActive) {
    console.log('[cx] 脚本已在运行，跳过注入');
    return;
  }

  window.__chaoxingAutoplayActive = true;
  window.__chaoxingAutoStop = false;

  window.__chaoxingStatus = {
    active: true,
    playing: false,
    currentTime: 0,
    duration: 0,
    title: '',
    message: '脚本启动中...',
  };

  var CONFIG = {
    playbackRate: 1.5,
    checkInterval: 1000,
    guardNoProgressMs: 7000,
    guardResumeCooldownMs: 1500,
    pptFlipInterval: 2000,
    pptMaxFlips: 50,
  };

  var videoEl = null;
  var isPlaying = false;
  var checkTimer = null;
  var guardLastTime = 0;
  var guardLastWallTs = 0;
  var guardLastResumeTs = 0;
  var retryCount = 0;
  var maxRetries = 10;
  var isHandlingPpt = false;

  function updateStatus(msg) {
    if (videoEl) {
      window.__chaoxingStatus.playing = isPlaying;
      window.__chaoxingStatus.currentTime = videoEl.currentTime || 0;
      window.__chaoxingStatus.duration = videoEl.duration || 0;
    }
    if (msg) {
      window.__chaoxingStatus.message = msg;
      console.log('[cx] ' + msg);
    }
  }

  // 在嵌套 iframe 中查找 video 元素
  function findVideo() {
    try {
      var iframes = document.querySelectorAll('iframe');

      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (!doc) continue;

          var videoIframes = doc.querySelectorAll('iframe.ans-insertvideo-online');
          for (var j = 0; j < videoIframes.length; j++) {
            try {
              var vDoc = videoIframes[j].contentDocument;
              if (!vDoc) continue;
              var video = vDoc.querySelector('video#video_html5_api');
              if (video) {
                console.log('[cx] 在嵌套 iframe 中找到 video#video_html5_api');
                return video;
              }
              video = vDoc.querySelector('video');
              if (video) {
                console.log('[cx] 在嵌套 iframe 中找到 video');
                return video;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }

      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (!doc) continue;
          var video = doc.querySelector('video#video_html5_api') || doc.querySelector('video');
          if (video) {
            console.log('[cx] 在 iframe 中找到 video');
            return video;
          }
        } catch (e) {}
      }

      var video = document.querySelector('video#video_html5_api') || document.querySelector('video');
      if (video) {
        console.log('[cx] 在当前文档找到 video');
        return video;
      }
    } catch (e) {
      console.error('[cx] 查找 video 出错:', e);
    }
    return null;
  }

  function getTreeContainer() {
    return document.querySelector('#coursetree');
  }

  // 获取课程树的直接子章节（只获取第一层 li，不包含嵌套小节）
  // 关键修复：必须只获取 #coursetree > ul > li 的直接子元素
  // 不能用 querySelectorAll('ul > li') 因为会匹配所有层级的 li
  function getDirectCells() {
    var tree = getTreeContainer();
    if (!tree) return [];

    // 找 #coursetree 的直接子 ul
    var ul = null;
    for (var i = 0; i < tree.children.length; i++) {
      if (tree.children[i].tagName === 'UL') {
        ul = tree.children[i];
        break;
      }
    }
    if (!ul) return [];

    // 获取 ul 的直接子 li（即章节，不包含嵌套小节）
    var cells = [];
    for (var i = 0; i < ul.children.length; i++) {
      if (ul.children[i].tagName === 'LI') {
        cells.push(ul.children[i]);
      }
    }
    return cells;
  }

  // 查找当前激活的视频位置
  function findCurrentPosition() {
    var tree = getTreeContainer();
    if (!tree) return null;

    var cells = getDirectCells();
    if (cells.length === 0) return null;

    var currentCell = -1;
    var currentNCell = -1;
    var currentTitle = '';

    for (var i = 0; i < cells.length; i++) {
      // 在章节内查找所有视频节点（排除 firstLayer 即章节标题本身）
      var nCells = cells[i].querySelectorAll('.posCatalog_select:not(.firstLayer)');
      for (var j = 0; j < nCells.length; j++) {
        if (nCells[j].classList.contains('posCatalog_active')) {
          currentCell = i;
          currentNCell = j;
          var titleSpan = nCells[j].querySelector('.posCatalog_name');
          if (titleSpan) {
            currentTitle = titleSpan.getAttribute('title') || titleSpan.textContent || '';
          }
        }
      }
    }

    console.log('[cx] 目录树: ' + cells.length + '章, 当前位置: 第' + (currentCell + 1) + '章第' + (currentNCell + 1) + '节');

    return { cells: cells, currentCell: currentCell, currentNCell: currentNCell, title: currentTitle };
  }

  function clickVideoNode(node) {
    var span = node.querySelector('.posCatalog_name');
    if (!span) {
      console.error('[cx] 找不到 .posCatalog_name');
      return false;
    }
    var title = span.getAttribute('title') || span.textContent || '未知';
    console.log('[cx] 点击切换到: ' + title);
    window.__chaoxingStatus.title = title;
    span.click();
    return true;
  }

  // 切换到下一小节
  function nextUnit() {
    console.log('[cx] === 准备切换到下一小节 ===');
    updateStatus('正在切换到下一小节...');

    var pos = findCurrentPosition();

    if (!pos || pos.currentCell < 0) {
      console.warn('[cx] 未找到当前激活位置，尝试从头开始');
      updateStatus('未找到当前激活位置，尝试第一个视频');

      var tree = getTreeContainer();
      if (tree) {
        var firstNode = tree.querySelector('.posCatalog_select:not(.firstLayer) .posCatalog_name');
        if (firstNode) {
          firstNode.click();
          videoEl = null;
          isPlaying = false;
          setTimeout(function() { play(); }, 3000);
          return true;
        }
      }
      return false;
    }

    var cells = pos.cells;
    var currentCell = pos.currentCell;
    var currentNCell = pos.currentNCell;

    // 获取当前章节内的所有视频节点
    var currentChapterNCells = cells[currentCell].querySelectorAll('.posCatalog_select:not(.firstLayer)');

    console.log('[cx] 当前章节有 ' + currentChapterNCells.length + ' 个小节, 当前是第 ' + (currentNCell + 1) + ' 个');

    // 1. 同章节内还有下一个视频
    if (currentChapterNCells.length > currentNCell + 1) {
      var nextNIndex = currentNCell + 1;
      console.log('[cx] 切换到同章节下一个视频: ' + (nextNIndex + 1) + '/' + currentChapterNCells.length);
      updateStatus('切换到同章节第 ' + (nextNIndex + 1) + '/' + currentChapterNCells.length + ' 节');
      if (clickVideoNode(currentChapterNCells[nextNIndex])) {
        videoEl = null;
        isPlaying = false;
        setTimeout(function() { play(); }, 3000);
        return true;
      }
    } else {
      // 2. 切换到下一个有视频的章节
      for (var i = currentCell + 1; i < cells.length; i++) {
        var nCells = cells[i].querySelectorAll('.posCatalog_select:not(.firstLayer)');
        if (nCells.length > 0) {
          console.log('[cx] 切换到下一章节: ' + (i + 1) + '/' + cells.length + ' (共 ' + nCells.length + ' 节)');
          updateStatus('切换到第 ' + (i + 1) + ' 章');
          if (clickVideoNode(nCells[0])) {
            videoEl = null;
            isPlaying = false;
            setTimeout(function() { play(); }, 3000);
            return true;
          }
        }
      }
    }

    console.log('[cx] 已是最后一节，课程学习完成');
    updateStatus('课程学习完成');
    window.__chaoxingStatus.active = false;
    return false;
  }

  // 检测"学习目标"页面，点击"视频"页签
  function advanceLearningStep() {
    var prevTitle = document.querySelector('.prev_title');
    var stepTitle = prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';

    if (stepTitle === '章节测验' || stepTitle === '视频') {
      return false;
    }

    var tabs = document.querySelectorAll('.prev_white');
    for (var i = 0; i < tabs.length; i++) {
      var text = (tabs[i].textContent || '').replace(/\\s+/g, '');
      if (text === '2视频' || text === '视频') {
        console.log('[cx] 检测到"学习目标"页，点击"视频"页签');
        updateStatus('切换到视频页签...');
        tabs[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    return false;
  }

  // 跳过章节测验
  function skipQuiz() {
    var nextBtn = document.querySelector('#prevNextFocusNext');
    if (nextBtn) {
      console.log('[cx] 检测到章节测验，自动跳过');
      updateStatus('跳过章节测验...');
      nextBtn.click();
      return true;
    }
    return false;
  }

  // 检测并处理 PPT/文档页面
  // 学习通的 PPT/文档通常在 iframe 内，需要翻页到底部才算完成
  function handlePptOrDocument() {
    if (isHandlingPpt) return false;

    try {
      // 检查是否有文档/PPT iframe
      var iframes = document.querySelectorAll('iframe');
      var docIframe = null;
      var docIframeDoc = null;

      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (!doc) continue;

          // 检查是否是文档/PPT 页面
          // 学习通文档常见特征：有翻页按钮、有页面容器
          var hasPptContent = doc.querySelector('.nextPage, .next-btn, .btn-next, #nextPage, .layui-laypage-next, .page-next');
          var hasDocContent = doc.querySelector('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer');

          // 也检查内层 iframe（文档可能在嵌套 iframe 中）
          if (!hasPptContent && !hasDocContent) {
            var innerIframes = doc.querySelectorAll('iframe');
            for (var j = 0; j < innerIframes.length; j++) {
              try {
                var innerDoc = innerIframes[j].contentDocument;
                if (!innerDoc) continue;
                hasPptContent = innerDoc.querySelector('.nextPage, .next-btn, .btn-next, #nextPage, .layui-laypage-next, .page-next');
                hasDocContent = innerDoc.querySelector('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer');
                if (hasPptContent || hasDocContent) {
                  docIframe = innerIframes[j];
                  docIframeDoc = innerDoc;
                  break;
                }
              } catch (e) {}
            }
          }

          if (hasPptContent || hasDocContent) {
            docIframe = iframes[i];
            docIframeDoc = doc;
            break;
          }

          // 另一种检测：iframe src 包含 document/ppt/reader
          var src = iframes[i].src || '';
          if (src.indexOf('document') >= 0 || src.indexOf('ppt') >= 0 || src.indexOf('reader') >= 0 || src.indexOf('office') >= 0) {
            docIframe = iframes[i];
            docIframeDoc = doc;
            break;
          }
        } catch (e) {}
      }

      if (!docIframeDoc) return false;

      console.log('[cx] 检测到 PPT/文档页面，开始自动翻页');
      updateStatus('正在翻阅 PPT/文档...');
      isHandlingPpt = true;

      // 开始翻页
      var flipCount = 0;

      function findNextButton() {
        // 在文档 iframe 中查找翻页按钮
        var selectors = [
          '.nextPage', '.next-btn', '.btn-next', '#nextPage',
          '.layui-laypage-next', '.page-next',
          'button[class*="next"]', 'a[class*="next"]',
          '.arrow-right', '.next'
        ];

        for (var i = 0; i < selectors.length; i++) {
          var btn = docIframeDoc.querySelector(selectors[i]);
          if (btn && !btn.disabled && !btn.classList.contains('disabled')) {
            return btn;
          }
        }

        // 也检查嵌套 iframe
        try {
          var innerIframes = docIframeDoc.querySelectorAll('iframe');
          for (var i = 0; i < innerIframes.length; i++) {
            try {
              var innerDoc = innerIframes[i].contentDocument;
              if (!innerDoc) continue;
              for (var j = 0; j < selectors.length; j++) {
                var btn = innerDoc.querySelector(selectors[j]);
                if (btn && !btn.disabled && !btn.classList.contains('disabled')) {
                  return btn;
                }
              }
            } catch (e) {}
          }
        } catch (e) {}

        return null;
      }

      function tryScrollDown() {
        // 尝试滚动文档到底部
        try {
          var scrollContainers = docIframeDoc.querySelectorAll('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer, body');
          for (var i = 0; i < scrollContainers.length; i++) {
            var container = scrollContainers[i];
            if (container.scrollHeight > container.clientHeight) {
              container.scrollTop = container.scrollHeight;
              console.log('[cx] 滚动文档到底部');
              return true;
            }
          }
        } catch (e) {}
        return false;
      }

      function flipNext() {
        if (window.__chaoxingAutoStop) {
          isHandlingPpt = false;
          return;
        }

        if (flipCount >= CONFIG.pptMaxFlips) {
          console.log('[cx] PPT 翻页达到上限，尝试切换下一节');
          isHandlingPpt = false;
          // 尝试点击完成/下一节按钮
          var nextBtn = document.querySelector('#prevNextFocusNext');
          if (nextBtn) {
            nextBtn.click();
          }
          setTimeout(function() { play(); }, 2000);
          return;
        }

        // 1. 尝试点击翻页按钮
        var nextBtn = findNextButton();
        if (nextBtn) {
          console.log('[cx] 翻页 ' + (flipCount + 1));
          nextBtn.click();
          flipCount++;
          setTimeout(flipNext, CONFIG.pptFlipInterval);
          return;
        }

        // 2. 尝试滚动到底部
        if (tryScrollDown()) {
          flipCount++;
          setTimeout(flipNext, CONFIG.pptFlipInterval);
          return;
        }

        // 3. 翻页按钮和滚动都不行，可能已经到底了
        console.log('[cx] PPT/文档已翻完 (' + flipCount + ' 页)，切换下一节');
        isHandlingPpt = false;

        // 尝试点击 #prevNextFocusNext
        var skipBtn = document.querySelector('#prevNextFocusNext');
        if (skipBtn) {
          console.log('[cx] 点击"下一节"按钮');
          skipBtn.click();
          setTimeout(function() { play(); }, 2000);
        } else {
          // 直接切换下一节
          setTimeout(function() { nextUnit(); }, 1000);
        }
      }

      // 开始翻页
      setTimeout(flipNext, 1000);
      return true;
    } catch (e) {
      console.error('[cx] PPT 处理出错:', e);
      isHandlingPpt = false;
      return false;
    }
  }

  function tryResume(reason) {
    var now = Date.now();
    if (now - guardLastResumeTs < CONFIG.guardResumeCooldownMs) return;
    guardLastResumeTs = now;

    if (!videoEl || !isPlaying) return;

    console.log('[cx] 恢复播放(' + reason + ')');
    videoEl.play().catch(function(e) {
      console.warn('[cx] 直接恢复失败，尝试静音:', e.message);
      videoEl.muted = true;
      videoEl.play().catch(function(err) {
        console.error('[cx] 静音恢复也失败:', err.message);
      });
    });
  }

  function setupVideoEvents(el) {
    el.addEventListener('ended', function() {
      if (window.__chaoxingAutoStop) return;
      console.log('[cx] 视频ended事件触发');
      isPlaying = false;
      updateStatus('视频播放完成，准备切换...');
      setTimeout(function() { nextUnit(); }, 1000);
    });

    el.addEventListener('play', function() {
      isPlaying = true;
      retryCount = 0;
      guardLastTime = Number(videoEl.currentTime || 0);
      guardLastWallTs = Date.now();
      updateStatus('正在播放: ' + (window.__chaoxingStatus.title || '当前视频'));
    });

    el.addEventListener('pause', function() {
      if (window.__chaoxingAutoStop) return;
      if (videoEl.ended) return;
      console.log('[cx] 视频被暂停，尝试恢复');
      setTimeout(function() {
        if (!window.__chaoxingAutoStop && videoEl && !videoEl.ended && videoEl.paused) {
          videoEl.play().catch(function() {});
        }
      }, 500);
    });

    el.addEventListener('loadedmetadata', function() {
      console.log('[cx] 视频加载完成，时长: ' + Math.floor(el.duration) + '秒');
      window.__chaoxingStatus.duration = el.duration || 0;
    });
  }

  // 播放视频或处理非视频任务
  function play() {
    if (window.__chaoxingAutoStop) return;

    if (!videoEl) {
      videoEl = findVideo();
      if (!videoEl) {
        // 没有视频，可能是"学习目标"页、测验页或 PPT 页

        // 1. 尝试切换到"视频"页签
        if (advanceLearningStep()) {
          updateStatus('正在切换到视频页...');
          setTimeout(function() { play(); }, 2000);
          return;
        }

        // 2. 尝试跳过章节测验
        if (skipQuiz()) {
          updateStatus('正在跳过测验...');
          setTimeout(function() { play(); }, 2000);
          return;
        }

        // 3. 尝试处理 PPT/文档
        if (handlePptOrDocument()) {
          // handlePptOrDocument 内部会自动翻页并切换
          return;
        }

        // 4. 都不是，等待视频加载
        updateStatus('未找到视频，等待中...');
        return;
      }
      setupVideoEvents(videoEl);
    }

    if (!videoEl.isConnected) {
      videoEl = null;
      isPlaying = false;
      setTimeout(function() { play(); }, 1000);
      return;
    }

    isPlaying = true;
    videoEl.muted = true;
    videoEl.playbackRate = CONFIG.playbackRate;

    var pos = findCurrentPosition();
    if (pos && pos.title) {
      window.__chaoxingStatus.title = pos.title;
    }

    videoEl.play().then(function() {
      console.log('[cx] 视频开始播放 ' + videoEl.playbackRate + 'x');
      retryCount = 0;
    }).catch(function(e) {
      console.error('[cx] 播放失败:', e.message);
      videoEl.muted = true;
      videoEl.play().then(function() {
        console.log('[cx] 静音播放成功');
      }).catch(function(err) {
        console.error('[cx] 静音播放也失败:', err.message);
        retryCount++;
        if (retryCount > maxRetries) {
          console.error('[cx] 达到最大重试次数，跳到下一节');
          updateStatus('播放失败，跳到下一节');
          setTimeout(function() { nextUnit(); }, 3000);
        } else {
          updateStatus('播放失败，重试 ' + retryCount + '/' + maxRetries);
          setTimeout(function() { play(); }, 2000);
        }
      });
    });
  }

  function checkVideoStatus() {
    if (window.__chaoxingAutoStop) {
      clearInterval(checkTimer);
      window.__chaoxingAutoplayActive = false;
      window.__chaoxingStatus.active = false;
      window.__chaoxingStatus.message = '已停止';
      return;
    }

    try {
      if (videoEl && videoEl.isConnected) {
        window.__chaoxingStatus.currentTime = videoEl.currentTime || 0;
        window.__chaoxingStatus.duration = videoEl.duration || 0;
        window.__chaoxingStatus.playing = isPlaying;

        if (videoEl.ended && isPlaying) {
          console.log('[cx] 检测到视频结束');
          isPlaying = false;
          setTimeout(function() { nextUnit(); }, 1000);
          return;
        }

        if (videoEl.paused && isPlaying && !videoEl.ended) {
          tryResume('paused');
        } else if (isPlaying && !videoEl.ended) {
          var now = Date.now();
          var current = Number(videoEl.currentTime || 0);
          if (guardLastWallTs === 0) {
            guardLastWallTs = now;
            guardLastTime = current;
          } else {
            var stalled = Math.abs(current - guardLastTime) < 0.01;
            var stalledMs = now - guardLastWallTs;
            if (stalled && stalledMs >= CONFIG.guardNoProgressMs) {
              tryResume('no-progress');
              guardLastWallTs = now;
              guardLastTime = Number(videoEl.currentTime || 0);
            } else if (!stalled) {
              guardLastWallTs = now;
              guardLastTime = current;
            }
          }
        }
      } else if (!isHandlingPpt && (!videoEl || !videoEl.isConnected)) {
        videoEl = null;
        isPlaying = false;
        play();
      }
    } catch (e) {
      console.error('[cx] 监控出错:', e);
    }
  }

  // 防止页面事件导致暂停
  document.addEventListener('mouseleave', function(e) {
    if (window.__chaoxingAutoStop) return;
    e.stopPropagation();
    e.preventDefault();
  });

  window.addEventListener('mouseleave', function(e) {
    if (window.__chaoxingAutoStop) return;
    e.stopPropagation();
    e.preventDefault();
  });

  document.addEventListener('mouseout', function(e) {
    if (window.__chaoxingAutoStop) return;
    if (videoEl && !videoEl.ended) {
      e.stopPropagation();
    }
  });

  window.addEventListener('blur', function() {
    if (window.__chaoxingAutoStop) return;
    if (videoEl && !videoEl.ended && videoEl.paused) {
      tryResume('window-blur');
    }
  });

  document.addEventListener('visibilitychange', function() {
    if (window.__chaoxingAutoStop) return;
    if (videoEl && !videoEl.ended && videoEl.paused) {
      tryResume('visibility-change');
    }
  });

  // 启动
  console.log('[cx] === 自动播放脚本启动 ===');
  updateStatus('脚本已启动，正在查找视频...');

  checkTimer = setInterval(checkVideoStatus, CONFIG.checkInterval);
  play();
})();
`;

// 注入自动播放脚本
export const injectAutoplay = async (): Promise<boolean> => {
  const page = getLearningPage();

  try {
    const active = await page.evaluate(() => {
      return (window as any).__chaoxingAutoplayActive === true;
    }).catch(() => false);

    if (active) {
      logger.info('自动播放脚本已在运行，先停止再重新启动');
      await page.evaluate(() => {
        (window as any).__chaoxingAutoStop = true;
        (window as any).__chaoxingAutoplayActive = false;
      }).catch(() => {});
      await page.waitForTimeout(500);
    }

    await page.evaluate(() => {
      (window as any).__chaoxingAutoStop = false;
      (window as any).__chaoxingAutoplayActive = false;
      (window as any).__chaoxingStatus = null;
    }).catch(() => {});

    await page.evaluate(AUTOPLAY_SCRIPT);
    logger.success('自动播放脚本已注入页面');
    return true;
  } catch (error) {
    logger.error(`注入自动播放脚本失败: ${error}`);
    return false;
  }
};

// 停止自动播放
export const stopAutoplay = async (): Promise<void> => {
  const page = getLearningPage();

  try {
    await page.evaluate(() => {
      (window as any).__chaoxingAutoStop = true;
      (window as any).__chaoxingAutoplayActive = false;
    });

    for (const frame of page.frames()) {
      await frame.evaluate(() => {
        for (const video of Array.from(document.querySelectorAll('video'))) {
          video.pause();
        }
      }).catch(() => {});
    }

    logger.info('自动播放脚本已停止');
  } catch (error) {
    logger.debug(`停止自动播放脚本失败: ${error}`);
  }
};

// 获取自动播放状态
export const getAutoplayStatus = async (): Promise<{
  active: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  title: string;
  message: string;
} | null> => {
  const page = getLearningPage();

  try {
    return await page.evaluate(() => {
      return (window as any).__chaoxingStatus || null;
    });
  } catch {
    return null;
  }
};
