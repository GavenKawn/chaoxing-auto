/**
 * 自动播放注入脚本
 * 此脚本会被注入到浏览器中执行，必须保持自包含（不能 import TypeScript 模块）
 */
export const AUTOPLAY_SCRIPT = `
(function() {
  // ========== 防止重复注入（但允许重新注入，不永久锁死） ==========
  if (window.__chaoxingAutoplayActive) {
    console.log('[TRACE] 脚本已在运行，先停止再重新启动');
    window.__chaoxingAutoStop = true;
    window.__chaoxingAutoplayActive = false;
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
    state: 'IDLE',
    taskIndex: 0,
    taskTotal: 0,
    pendingCount: 0,
    completedCount: 0,
  };

  var CONFIG = {
    playbackRate: 1.5,
    checkInterval: 1000,
    watchdogInterval: 10000,
    watchdogTimeoutMs: 30000,
    guardNoProgressMs: 7000,
    guardResumeCooldownMs: 1500,
    pptFlipInterval: 2000,
    pptMaxFlips: 50,
    recoverBaseDelay: 1000,
    recoverMaxDelay: 16000,
    metadataTimeout: 15000,
    // PPT 完成后等待服务器同步的最大时间
    pptCompleteWaitMs: 15000,
    // Quiz 跳过后等待页面切换的时间
    quizSkipWaitMs: 3000,
    // 页面稳定延迟：页面刚进入时等待 DOM 加载
    pageStabilizeDelay: 2000,
    // 章节跳转冷却：防止连续跳章节（毫秒）
    chapterJumpCooldown: 5000,
    // 最大扫描重试次数：扫描失败时重试次数
    maxScanRetries: 3,
    // 扫描重试间隔
    scanRetryDelay: 2000,
  };

  // ========== 状态机 ==========
  var PlayerState = {
    IDLE: 'IDLE',
    SEARCHING_TASK: 'SEARCHING_TASK',
    SEARCHING_VIDEO: 'SEARCHING_VIDEO',
    WAIT_METADATA: 'WAIT_METADATA',
    PLAYING: 'PLAYING',
    PPT_READING: 'PPT_READING',
    QUIZ_SKIPPING: 'QUIZ_SKIPPING',
    FINISHED: 'FINISHED',
    NEXT_CHAPTER: 'NEXT_CHAPTER',
    ERROR: 'ERROR',
    RECOVERING: 'RECOVERING',
  };

  // ========== allowedTransitions 状态跳转合法性 ==========
  var allowedTransitions = {
    IDLE: ['SEARCHING_TASK', 'SEARCHING_VIDEO', 'ERROR', 'RECOVERING', 'FINISHED'],
    SEARCHING_TASK: ['SEARCHING_VIDEO', 'PPT_READING', 'QUIZ_SKIPPING', 'IDLE', 'ERROR', 'RECOVERING', 'NEXT_CHAPTER'],
    SEARCHING_VIDEO: ['WAIT_METADATA', 'PPT_READING', 'QUIZ_SKIPPING', 'IDLE', 'ERROR', 'RECOVERING'],
    WAIT_METADATA: ['PLAYING', 'ERROR', 'RECOVERING'],
    PLAYING: ['PPT_READING', 'QUIZ_SKIPPING', 'NEXT_CHAPTER', 'ERROR', 'RECOVERING', 'IDLE'],
    PPT_READING: ['NEXT_CHAPTER', 'SEARCHING_TASK', 'ERROR', 'RECOVERING', 'IDLE'],
    QUIZ_SKIPPING: ['NEXT_CHAPTER', 'SEARCHING_TASK', 'ERROR', 'RECOVERING', 'IDLE'],
    FINISHED: ['IDLE'],
    NEXT_CHAPTER: ['SEARCHING_TASK', 'SEARCHING_VIDEO', 'IDLE', 'ERROR', 'RECOVERING', 'FINISHED'],
    ERROR: ['RECOVERING', 'IDLE'],
    RECOVERING: ['SEARCHING_TASK', 'SEARCHING_VIDEO', 'IDLE', 'ERROR'],
  };

  var currentState = PlayerState.IDLE;
  var videoEl = null;
  var isPlaying = false;
  var checkTimer = null;
  var watchdogTimer = null;
  var lastActivityTime = Date.now();
  var guardLastTime = 0;
  var guardLastWallTs = 0;
  var recoverAttempt = 0;
  var isHandlingPpt = false;
  var isHandlingQuiz = false;
  var mutationObserver = null;
  var videoEventMap = new WeakMap();

  // ========== 任务队列管理 ==========
  // pendingTasks: 待执行的任务
  // runningTask: 当前正在执行的任务
  // completedTasks: 已完成的任务（按签名去重）
  // skippedTasks: 已跳过的任务（防止 scan→skip→scan→skip 无限循环）
  var pendingTasks = [];
  var runningTask = null;
  var completedTasks = [];   // 存储已完成的任务签名
  var skippedTasks = [];      // 存储已跳过的任务签名
  var currentChapterSignature = '';

  // ========== 扫描与跳章节保护 ==========
  var scanRetryCount = 0;          // 当前扫描重试次数
  var lastScanSuccess = false;     // 上次扫描是否成功（找到至少一个任务）
  var lastChapterJumpTime = 0;     // 上次跳章节的时间戳（防抖）

  // ========== RecoverLock + AbortController ==========
  // 保证同一时刻只有一个恢复器工作，禁止多个 recover 并发
  var recoverLock = false;
  var recoverAbortController = null;

  // ========== TRACE 日志 ==========
  function trace(category, message) {
    console.log('[TRACE][' + category + '] ' + message);
  }

  function traceTaskQueue() {
    trace('TaskQueue', 'pending=' + pendingTasks.length +
      ', running=' + (runningTask ? '1' : '0') +
      ', completed=' + completedTasks.length +
      ', skipped=' + skippedTasks.length);
  }

  // ========== TaskSummary：统一任务状态汇总 ==========
  function getTaskSummary() {
    var totalTasks = completedTasks.length + skippedTasks.length + pendingTasks.length + (runningTask ? 1 : 0);
    return {
      scanSuccess: lastScanSuccess,
      totalTasks: totalTasks,
      pendingTasks: pendingTasks.length,
      runningTasks: runningTask ? 1 : 0,
      completedTasks: completedTasks.length,
      skippedTasks: skippedTasks.length,
      allTasksFinished: lastScanSuccess && totalTasks > 0 && pendingTasks.length === 0 && !runningTask,
    };
  }

  function logTaskSummary(context) {
    var s = getTaskSummary();
    trace('TaskSummary', '[' + context + '] ' +
      'scanSuccess=' + s.scanSuccess +
      ', total=' + s.totalTasks +
      ', pending=' + s.pendingTasks +
      ', running=' + s.runningTasks +
      ', completed=' + s.completedTasks +
      ', skipped=' + s.skippedTasks +
      ', allTasksFinished=' + s.allTasksFinished);
  }

  // ========== 状态转换（带合法性检查） ==========
  function setState(newState) {
    if (currentState === newState) return;

    // 检查状态跳转是否合法
    var allowed = allowedTransitions[currentState];
    if (allowed && allowed.indexOf(newState) === -1) {
      console.error('[STATE] 非法状态跳转: ' + currentState + ' -> ' + newState);
      // 仍然允许跳转，但打印 error 方便排查
    }

    var oldState = currentState;
    trace('STATE', oldState + ' -> ' + newState);
    window.__chaoxingStatus.state = newState;
    currentState = newState;
    lastActivityTime = Date.now();
  }

  function updateStatus(msg) {
    if (videoEl) {
      window.__chaoxingStatus.playing = isPlaying;
      var ct = Number(videoEl.currentTime);
      var dur = Number(videoEl.duration);
      window.__chaoxingStatus.currentTime = Number.isFinite(ct) ? ct : 0;
      window.__chaoxingStatus.duration = Number.isFinite(dur) ? dur : 0;
    }
    window.__chaoxingStatus.pendingCount = pendingTasks.length;
    window.__chaoxingStatus.completedCount = completedTasks.length;
    if (msg) {
      window.__chaoxingStatus.message = msg;
      console.log('[cx] ' + msg);
    }
  }

  // ========== 获取 URL 参数 ==========
  function getUrlParam(name) {
    try {
      var url = window.location.href;
      var regex = new RegExp('[?&]' + name + '=([^&]+)');
      var match = url.match(regex);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  }

  // ========== 视频签名（避免多个视频被识别成同一个） ==========
  // 使用 courseid + clazzid + knowledgeid + frame.url + currentSrc + videoIndex 联合生成
  function getCurrentVideoSignature(video, videoIndex) {
    try {
      var courseId = getUrlParam('courseId') || getUrlParam('courseid') || '';
      var clazzId = getUrlParam('clazzId') || getUrlParam('clazzid') || '';
      var knowledgeId = getUrlParam('knowledgeid') || getUrlParam('knowledgeId') || '';
      var chapterId = getUrlParam('chapterId') || getUrlParam('chapterid') || '';

      var frameUrl = '';
      try {
        // 查找 video 所在的 iframe
        var allIframes = document.querySelectorAll('iframe');
        for (var i = 0; i < allIframes.length; i++) {
          try {
            var doc = allIframes[i].contentDocument;
            if (!doc) continue;
            var videoIframes = doc.querySelectorAll('iframe.ans-insertvideo-online');
            for (var j = 0; j < videoIframes.length; j++) {
              try {
                var vDoc = videoIframes[j].contentDocument;
                if (vDoc && vDoc.contains(video)) {
                  frameUrl = videoIframes[j].src || '';
                  break;
                }
              } catch (e) {}
            }
            if (frameUrl) break;
          } catch (e) {}
        }
      } catch (e) {}

      var currentSrc = '';
      try {
        currentSrc = video.currentSrc || video.src || '';
      } catch (e) {}

      var signature = [
        'c=' + courseId,
        'cl=' + clazzId,
        'k=' + knowledgeId,
        'ch=' + chapterId,
        'f=' + frameUrl.substring(0, 200),
        's=' + currentSrc.substring(0, 200),
        'i=' + (videoIndex !== undefined ? videoIndex : 0),
      ].join('|');

      return signature;
    } catch (e) {
      return 'unknown_' + Date.now();
    }
  }

  // 获取当前章节签名（用于检测章节切换）
  function getCurrentChapterSignature() {
    var courseId = getUrlParam('courseId') || getUrlParam('courseid') || '';
    var clazzId = getUrlParam('clazzId') || getUrlParam('clazzid') || '';
    var knowledgeId = getUrlParam('knowledgeid') || getUrlParam('knowledgeId') || '';
    var chapterId = getUrlParam('chapterId') || getUrlParam('chapterid') || '';
    return 'c=' + courseId + '|cl=' + clazzId + '|ch=' + chapterId + '|k=' + knowledgeId;
  }

  // ========== 增强的 iframe 搜索 ==========
  function logFrameInfo(frame, context) {
    try {
      var url = frame.src || frame.getAttribute('src') || '';
      var name = frame.name || frame.getAttribute('name') || '';
      if (url) {
        console.log('[FRAME] ' + context + ' - URL: ' + url.substring(0, 100) + (name ? ', name: ' + name : ''));
      }
    } catch (e) {}
  }

  function findAllVideosInFrames() {
    var videos = [];
    try {
      var iframes = document.querySelectorAll('iframe');

      for (var i = 0; i < iframes.length; i++) {
        var doc = null;
        try {
          doc = iframes[i].contentDocument;
        } catch (e) {
          logFrameInfo(iframes[i], 'cross-origin iframe skipped');
          continue;
        }
        if (!doc) continue;

        var videoIframes = doc.querySelectorAll('iframe.ans-insertvideo-online');
        for (var j = 0; j < videoIframes.length; j++) {
          try {
            var vDoc = videoIframes[j].contentDocument;
            if (!vDoc) {
              logFrameInfo(videoIframes[j], 'video iframe contentDocument 为空');
              continue;
            }
            var video = vDoc.querySelector('video#video_html5_api') || vDoc.querySelector('video');
            if (video) {
              console.log('[VIDEO] 在嵌套 iframe.ans-insertvideo-online 中找到 video (index: ' + videos.length + ')');
              videos.push(video);
            }
          } catch (e) {
            logFrameInfo(videoIframes[j], 'video iframe 访问失败: ' + e.message);
          }
        }
      }

      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (!doc) continue;
          var directVideos = doc.querySelectorAll('video');
          for (var j = 0; j < directVideos.length; j++) {
            if (videos.indexOf(directVideos[j]) === -1) {
              videos.push(directVideos[j]);
            }
          }
        } catch (e) {}
      }

      var topVideos = document.querySelectorAll('video');
      for (var i = 0; i < topVideos.length; i++) {
        if (videos.indexOf(topVideos[i]) === -1) {
          videos.push(topVideos[i]);
        }
      }
    } catch (e) {
      console.error('[cx] 查找 video 出错:', e);
    }
    return videos;
  }

  // ========== 多视频选择策略 ==========
  function selectBestVideo(videos) {
    if (!videos || videos.length === 0) return null;

    function scoreVideo(v) {
      try {
        var score = 0;
        if (v.offsetParent !== null) score += 10;
        if (v.currentSrc && v.currentSrc.length > 0) score += 5;
        if (v.readyState >= 2) score += 5;
        if (Number.isFinite(v.duration) && v.duration > 0) score += 5;
        if (!v.paused && !v.ended) score += 10;
        return score;
      } catch (e) {
        return 0;
      }
    }

    var bestVideo = null;
    var bestScore = -1;
    for (var i = 0; i < videos.length; i++) {
      var score = scoreVideo(videos[i]);
      if (score > bestScore) {
        bestScore = score;
        bestVideo = videos[i];
      }
    }
    return bestVideo;
  }

  function findVideo() {
    var videos = findAllVideosInFrames();
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];
    var best = selectBestVideo(videos);
    console.log('[VIDEO] 找到 ' + videos.length + ' 个视频，选择最佳 (score 最高)');
    return best;
  }

  // ========== 多信号联合判断任务完成 ==========
  function isVideoCompleted(video) {
    try {
      if (!video) return false;
      // 1. 视频已播放结束
      if (video.ended) return true;
      // 2. 进度 >= 99%
      if (Number.isFinite(video.duration) && video.duration > 0) {
        if (video.currentTime / video.duration >= 0.99) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // 多信号联合判断任务完成（不依赖单一信号）
  // 修复：DOM 未加载 / 页面空白时禁止返回 true，避免误判导致无限跳章节
  function detectTaskCompleted() {
    try {
      // 0. 检查 DOM 是否已加载
      if (!document || !document.body) {
        trace('DETECT', 'document.body 不存在，返回 false');
        return false;
      }
      var bodyText = document.body.innerText || '';
      // 页面内容过少，可能尚未加载完成
      if (bodyText.trim().length < 10) {
        trace('DETECT', '页面内容过少，可能未加载完成');
        return false;
      }

      // 1. 检查明确的完成样式（缩小选择器范围，避免误匹配）
      var finishSelectors = ['.finished', '.complete', '.done', '.icon-success'];
      for (var i = 0; i < finishSelectors.length; i++) {
        if (document.querySelector(finishSelectors[i])) return true;
      }

      // 2. 检查文本信号（必须同时包含"完成"相关词汇，避免单独匹配 100%）
      if (bodyText.indexOf('已完成') >= 0 || bodyText.indexOf('任务点完成') >= 0) {
        return true;
      }

      // 3. 检查完成图标（缩小范围，避免 [class*="check"] 等过于宽泛的选择器）
      var iconSelectors = ['.icon-success', '[data-status*="success"]', '[aria-label*="success"]'];
      for (var i = 0; i < iconSelectors.length; i++) {
        if (document.querySelector(iconSelectors[i])) return true;
      }

      return false;
    } catch (e) {
      trace('DETECT', 'detectTaskCompleted 出错: ' + e.message);
      return false;
    }
  }

  // 视频播放完成的多信号联合判断
  function playVideoComplete(video) {
    if (!video) return false;

    var signals = 0;
    var reasons = [];

    // 信号1: ended 事件
    if (video.ended) {
      signals++;
      reasons.push('ended');
    }

    // 信号2: currentTime >= duration (99%)
    try {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        if (video.currentTime / video.duration >= 0.99) {
          signals++;
          reasons.push('progress>=99%');
        }
      }
    } catch (e) {}

    // 信号3: 页面文本显示 100% 或 已完成
    try {
      var body = document.body;
      if (body) {
        var text = body.innerText || '';
        if (text.indexOf('100%') >= 0 || text.indexOf('已完成') >= 0) {
          signals++;
          reasons.push('text:100%');
        }
      }
    } catch (e) {}

    // 信号4: icon-success 或 status-success
    try {
      if (document.querySelector('.icon-success, [data-status*="success"], [aria-label*="success"]')) {
        signals++;
        reasons.push('icon-success');
      }
    } catch (e) {}

    // 信号5: task status 完成
    if (detectTaskCompleted()) {
      signals++;
      reasons.push('task-status');
    }

    // 至少满足 1 个信号才认为完成
    if (signals > 0) {
      trace('VIDEO', '播放完成判断通过: ' + reasons.join(', ') + ' (signals=' + signals + ')');
      return true;
    }

    return false;
  }

  // ========== 扫描所有任务点 ==========
  function findAllTaskPoints() {
    var tasks = [];
    try {
      // 1. 视频任务点
      var videos = findAllVideosInFrames();
      for (var i = 0; i < videos.length; i++) {
        var signature = getCurrentVideoSignature(videos[i], i);
        var isCompleted = completedTasks.indexOf(signature) >= 0;
        var isSkipped = skippedTasks.indexOf(signature) >= 0;
        tasks.push({
          id: 'video_' + i,
          type: 'VIDEO',
          completed: isCompleted || isSkipped,
          videoIndex: i,
          video: videos[i],
          signature: signature,
        });
      }

      // 2. PPT/文档任务点
      var pptIframe = findPptOrDocumentIframe();
      if (pptIframe) {
        var pptSignature = getCurrentChapterSignature() + '|ppt_0';
        var isPptCompleted = completedTasks.indexOf(pptSignature) >= 0;
        var isPptSkipped = skippedTasks.indexOf(pptSignature) >= 0;
        tasks.push({
          id: 'ppt_0',
          type: 'PPT',
          completed: isPptCompleted || isPptSkipped,
          signature: pptSignature,
        });
      }

      // 3. 章节测验
      if (detectQuizPage()) {
        var quizSignature = getCurrentChapterSignature() + '|quiz_0';
        var isQuizCompleted = completedTasks.indexOf(quizSignature) >= 0;
        var isQuizSkipped = skippedTasks.indexOf(quizSignature) >= 0;
        tasks.push({
          id: 'quiz_0',
          type: 'QUIZ',
          completed: isQuizCompleted || isQuizSkipped,
          signature: quizSignature,
        });
      }

      window.__chaoxingStatus.taskTotal = tasks.length;
      trace('TASK', '扫描到 ' + tasks.length + ' 个任务点');
      traceTaskQueue();
    } catch (e) {
      console.error('[cx] 扫描任务点出错:', e);
    }
    return tasks;
  }

  // ========== 课程目录树 ==========
  function getTreeContainer() {
    return document.querySelector('#coursetree') ||
           document.querySelector('.coursetree') ||
           document.querySelector('[id*="coursetree"]') ||
           document.querySelector('[class*="coursetree"]');
  }

  function getDirectCells() {
    var tree = getTreeContainer();
    if (!tree) return [];
    var ul = null;
    for (var i = 0; i < tree.children.length; i++) {
      if (tree.children[i].tagName === 'UL') {
        ul = tree.children[i];
        break;
      }
    }
    if (!ul) ul = tree.querySelector('ul');
    if (!ul) return [];
    var cells = [];
    for (var i = 0; i < ul.children.length; i++) {
      if (ul.children[i].tagName === 'LI') {
        cells.push(ul.children[i]);
      }
    }
    return cells;
  }

  function findCurrentPosition() {
    var tree = getTreeContainer();
    if (!tree) return null;
    var cells = getDirectCells();
    if (cells.length === 0) return null;

    var currentCell = -1;
    var currentNCell = -1;
    var currentTitle = '';

    var nodeSelectors = [
      '.posCatalog_select:not(.firstLayer)',
      '.catalog_select:not(.firstLayer)',
      '.chapterItem:not(.firstLayer)',
      '.lessonItem',
      '.treeItem:not(.firstLayer)',
      'li[class*="Catalog"]:not(.firstLayer)',
      'li[class*="chapter"]',
      'li[class*="lesson"]'
    ];

    for (var i = 0; i < cells.length; i++) {
      var nCells = [];
      for (var selIdx = 0; selIdx < nodeSelectors.length && nCells.length === 0; selIdx++) {
        try {
          nCells = cells[i].querySelectorAll(nodeSelectors[selIdx]);
        } catch (e) {}
      }
      if (nCells.length === 0) {
        nCells = cells[i].querySelectorAll('li:not(.firstLayer)');
      }

      for (var j = 0; j < nCells.length; j++) {
        var isActive = nCells[j].classList.contains('posCatalog_active') ||
                       nCells[j].classList.contains('catalog_active') ||
                       nCells[j].classList.contains('active') ||
                       nCells[j].classList.contains('current') ||
                       nCells[j].classList.contains('selected');
        if (isActive) {
          currentCell = i;
          currentNCell = j;
          var titleSpan = nCells[j].querySelector('.posCatalog_name') ||
                          nCells[j].querySelector('.catalog_name') ||
                          nCells[j].querySelector('.chapterName') ||
                          nCells[j].querySelector('.lessonName') ||
                          nCells[j].querySelector('span');
          if (titleSpan) {
            currentTitle = titleSpan.getAttribute('title') || titleSpan.textContent || '';
          }
        }
      }
    }

    trace('CHAPTER', '目录树: ' + cells.length + '章, 当前: 第' + (currentCell + 1) + '章第' + (currentNCell + 1) + '节');
    return { cells: cells, currentCell: currentCell, currentNCell: currentNCell, title: currentTitle };
  }

  function clickVideoNode(node) {
    var clickTarget = node.querySelector('.posCatalog_name') ||
                      node.querySelector('.catalog_name') ||
                      node.querySelector('.chapterName') ||
                      node.querySelector('.lessonName') ||
                      node.querySelector('span') ||
                      node.querySelector('a');
    if (!clickTarget) clickTarget = node;

    var title = '';
    var titleSpan = node.querySelector('.posCatalog_name') ||
                    node.querySelector('.catalog_name') ||
                    node.querySelector('span');
    if (titleSpan) {
      title = titleSpan.getAttribute('title') || titleSpan.textContent || '未知';
    }

    trace('CHAPTER', '点击切换到: ' + title);
    window.__chaoxingStatus.title = title;

    clickTarget.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0
    }));
    return true;
  }

  function getChapterNodes(chapter) {
    var nodeSelectors = [
      '.posCatalog_select:not(.firstLayer)',
      '.catalog_select:not(.firstLayer)',
      '.chapterItem:not(.firstLayer)',
      '.lessonItem',
      '.treeItem:not(.firstLayer)',
      'li[class*="Catalog"]:not(.firstLayer)',
      'li[class*="chapter"]',
      'li[class*="lesson"]'
    ];
    for (var i = 0; i < nodeSelectors.length; i++) {
      try {
        var nodes = chapter.querySelectorAll(nodeSelectors[i]);
        if (nodes.length > 0) return nodes;
      } catch (e) {}
    }
    return chapter.querySelectorAll('li:not(.firstLayer)');
  }

  // ========== nextChapter：只有 pendingTasks.length === 0 时才允许 ==========
  function nextUnit() {
    trace('CHAPTER', '=== 准备切换到下一小节 ===');
    logTaskSummary('nextUnit-entry');

    // 防抖：5 秒内已经跳过章节，禁止再次跳
    var now = Date.now();
    if (now - lastChapterJumpTime < CONFIG.chapterJumpCooldown) {
      var remaining = Math.ceil((CONFIG.chapterJumpCooldown - (now - lastChapterJumpTime)) / 1000);
      trace('CHAPTER', '章节跳转冷却中，还需 ' + remaining + 's，不跳章节');
      updateStatus('章节跳转冷却中，等待 ' + remaining + 's...');
      setState(PlayerState.IDLE);
      setTimeout(function() { scanAndExecute(); }, CONFIG.chapterJumpCooldown);
      return false;
    }

    // 检查任务队列：只有 pendingTasks.length === 0 时才允许 nextChapter
    if (pendingTasks.length > 0) {
      trace('CHAPTER', '还有 ' + pendingTasks.length + ' 个待执行任务，不切换章节');
      updateStatus('还有 ' + pendingTasks.length + ' 个待执行任务');
      setTimeout(function() { executeNextTask(); }, 1000);
      return false;
    }

    // 检查 TaskSummary：必须 allTasksFinished 才允许跳
    var summary = getTaskSummary();
    if (!summary.allTasksFinished) {
      trace('CHAPTER', 'allTasksFinished=false，不跳章节 (scanSuccess=' + summary.scanSuccess + ', total=' + summary.totalTasks + ')');
      updateStatus('任务未全部完成，不跳章节');
      setState(PlayerState.IDLE);
      setTimeout(function() { scanAndExecute(); }, CONFIG.scanRetryDelay);
      return false;
    }

    trace('CHAPTER', '所有任务已完成（已验证），切换到下一章节');
    updateStatus('正在切换到下一小节...');
    setState(PlayerState.NEXT_CHAPTER);
    lastChapterJumpTime = Date.now();

    var pos = findCurrentPosition();

    if (!pos || pos.currentCell < 0) {
      console.warn('[CHAPTER] 未找到当前激活位置，尝试从头开始');
      updateStatus('未找到当前激活位置，尝试第一个视频');
      var tree = getTreeContainer();
      if (tree) {
        var firstNode = null;
        var selectors = [
          '.posCatalog_select:not(.firstLayer) .posCatalog_name',
          '.catalog_select:not(.firstLayer) .catalog_name',
          '.posCatalog_select:not(.firstLayer) span',
          '.catalog_select:not(.firstLayer) span',
          'li:not(.firstLayer) span'
        ];
        for (var selIdx = 0; selIdx < selectors.length && !firstNode; selIdx++) {
          try {
            firstNode = tree.querySelector(selectors[selIdx]);
          } catch (e) {}
        }
        if (firstNode) {
          firstNode.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0
          }));
          videoEl = null;
          isPlaying = false;
          // 章节切换后清空任务队列，重新扫描
          pendingTasks = [];
          runningTask = null;
          currentChapterSignature = getCurrentChapterSignature();
          setTimeout(function() { scanAndExecute(); }, 3000);
          return true;
        }
      }
      return false;
    }

    var cells = pos.cells;
    var currentCell = pos.currentCell;
    var currentNCell = pos.currentNCell;
    var currentChapterNCells = getChapterNodes(cells[currentCell]);

    trace('CHAPTER', '当前章节有 ' + currentChapterNCells.length + ' 个小节, 当前是第 ' + (currentNCell + 1) + ' 个');

    // 1. 同章节内还有下一个视频
    if (currentChapterNCells.length > currentNCell + 1) {
      var nextNIndex = currentNCell + 1;
      trace('CHAPTER', '切换到同章节下一个视频: ' + (nextNIndex + 1) + '/' + currentChapterNCells.length);
      updateStatus('切换到同章节第 ' + (nextNIndex + 1) + '/' + currentChapterNCells.length + ' 节');
      if (clickVideoNode(currentChapterNCells[nextNIndex])) {
        videoEl = null;
        isPlaying = false;
        // 章节切换后清空任务队列，重新扫描
        pendingTasks = [];
        runningTask = null;
        currentChapterSignature = getCurrentChapterSignature();
        setTimeout(function() { scanAndExecute(); }, 3000);
        return true;
      }
    } else {
      // 2. 切换到下一个有视频的章节
      for (var i = currentCell + 1; i < cells.length; i++) {
        var nCells = getChapterNodes(cells[i]);
        if (nCells.length > 0) {
          trace('CHAPTER', '切换到下一章节: ' + (i + 1) + '/' + cells.length);
          updateStatus('切换到第 ' + (i + 1) + ' 章');
          if (clickVideoNode(nCells[0])) {
            videoEl = null;
            isPlaying = false;
            // 章节切换后清空任务队列，重新扫描
            pendingTasks = [];
            runningTask = null;
            currentChapterSignature = getCurrentChapterSignature();
            setTimeout(function() { scanAndExecute(); }, 3000);
            return true;
          }
        }
      }
    }

    trace('CHAPTER', '已是最后一节，课程学习完成');
    updateStatus('课程学习完成');
    window.__chaoxingStatus.active = false;
    setState(PlayerState.FINISHED);
    return false;
  }

  // ========== 检测"学习目标"页面 ==========
  function advanceLearningStep() {
    var prevTitle = document.querySelector('.prev_title');
    var stepTitle = prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';
    if (stepTitle === '章节测验' || stepTitle === '视频') return false;

    var tabs = document.querySelectorAll('.prev_white');
    for (var i = 0; i < tabs.length; i++) {
      var text = (tabs[i].textContent || '').replace(/\\s+/g, '');
      if (text === '2视频' || text === '视频') {
        trace('TASK', '检测到"学习目标"页，点击"视频"页签');
        updateStatus('切换到视频页签...');
        tabs[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    return false;
  }

  // ========== 章节测验检测 ==========
  function detectQuizPage() {
    try {
      var nextBtn = document.querySelector('#prevNextFocusNext');
      if (nextBtn) {
        var body = document.body;
        if (body) {
          var text = body.innerText || '';
          var quizKeywords = ['章节测验', '随堂练习', '作业', 'questionLi', 'exam', 'test'];
          for (var i = 0; i < quizKeywords.length; i++) {
            if (text.indexOf(quizKeywords[i]) >= 0) {
              return true;
            }
          }
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // ========== 跳过章节测验（维护 skippedTasks 防止无限循环） ==========
  function skipQuiz() {
    var nextBtn = document.querySelector('#prevNextFocusNext');
    if (nextBtn) {
      var quizSignature = getCurrentChapterSignature() + '|quiz_0';

      // 检查是否已经跳过过，防止 scan→skip→scan→skip 无限循环
      if (skippedTasks.indexOf(quizSignature) >= 0) {
        trace('QUIZ', '该测验已跳过，不再重复跳过');
        return false;
      }

      trace('QUIZ', '检测到章节测验，自动跳过');
      updateStatus('跳过章节测验...');
      setState(PlayerState.QUIZ_SKIPPING);

      // 记录到 skippedTasks
      skippedTasks.push(quizSignature);
      trace('QUIZ', '已记录跳过签名: ' + quizSignature);
      traceTaskQueue();

      nextBtn.click();
      return true;
    }
    return false;
  }

  // ========== PPT/文档处理 ==========
  function findPptOrDocumentIframe() {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var doc = iframes[i].contentDocument;
          if (!doc) continue;

          var hasPptContent = doc.querySelector('.nextPage, .next-btn, .btn-next, #nextPage, .layui-laypage-next, .page-next');
          var hasDocContent = doc.querySelector('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer');

          if (!hasPptContent && !hasDocContent) {
            var innerIframes = doc.querySelectorAll('iframe');
            for (var j = 0; j < innerIframes.length; j++) {
              try {
                var innerDoc = innerIframes[j].contentDocument;
                if (!innerDoc) continue;
                hasPptContent = innerDoc.querySelector('.nextPage, .next-btn, .btn-next, #nextPage, .layui-laypage-next, .page-next');
                hasDocContent = innerDoc.querySelector('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer');
                if (hasPptContent || hasDocContent) {
                  return { iframe: innerIframes[j], doc: innerDoc };
                }
              } catch (e) {}
            }
          }

          if (hasPptContent || hasDocContent) {
            return { iframe: iframes[i], doc: doc };
          }

          var src = iframes[i].src || '';
          if (src.indexOf('document') >= 0 || src.indexOf('ppt') >= 0 || src.indexOf('reader') >= 0 || src.indexOf('office') >= 0) {
            return { iframe: iframes[i], doc: doc };
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error('[PPT] 查找 PPT/文档出错:', e);
    }
    return null;
  }

  function handlePptOrDocument() {
    if (isHandlingPpt) return false;

    var pptInfo = findPptOrDocumentIframe();
    if (!pptInfo) return false;

    var docIframeDoc = pptInfo.doc;
    trace('PPT', '检测到 PPT/文档页面，开始自动翻页');
    updateStatus('正在翻阅 PPT/文档...');
    setState(PlayerState.PPT_READING);
    isHandlingPpt = true;

    var flipCount = 0;
    var pptSignature = getCurrentChapterSignature() + '|ppt_0';

    function findNextButton() {
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
      try {
        var scrollContainers = docIframeDoc.querySelectorAll('.document-content, .ppt-content, .reader-container, .flipbook, .pdf-viewer, body');
        for (var i = 0; i < scrollContainers.length; i++) {
          var container = scrollContainers[i];
          if (container.scrollHeight > container.clientHeight) {
            container.scrollTop = container.scrollHeight;
            trace('PPT', '滚动文档到底部');
            return true;
          }
        }
      } catch (e) {}
      return false;
    }

    function getPageInfo() {
      try {
        var pageSelectors = ['.page-current', '.current-page', '[class*="current-page"]', '[class*="pageCurrent"]'];
        var totalSelectors = ['.page-total', '.total-page', '[class*="total-page"]', '[class*="pageCount"]'];
        var current = 0, total = 0;
        for (var i = 0; i < pageSelectors.length; i++) {
          var el = docIframeDoc.querySelector(pageSelectors[i]);
          if (el) {
            var text = el.textContent || el.getAttribute('data-page') || '0';
            current = parseInt(text.match(/\\d+/)?.[0] || '0');
            if (current > 0) break;
          }
        }
        for (var i = 0; i < totalSelectors.length; i++) {
          var el = docIframeDoc.querySelector(totalSelectors[i]);
          if (el) {
            var text = el.textContent || el.getAttribute('data-total') || '0';
            total = parseInt(text.match(/\\d+/)?.[0] || '0');
            if (total > 0) break;
          }
        }
        return { current: current, total: total };
      } catch (e) {
        return { current: 0, total: 0 };
      }
    }

    // PPT 翻到底后等待服务器同步成功
    function waitForServerSync(callback) {
      trace('PPT', 'PPT 翻完，等待服务器同步...');
      updateStatus('等待服务器同步...');

      var waitStart = Date.now();
      function checkSync() {
        if (window.__chaoxingAutoStop) {
          isHandlingPpt = false;
          return;
        }

        // 检测任务是否完成（多信号联合判断）
        if (detectTaskCompleted()) {
          trace('PPT', '服务器同步成功，任务完成');
          completedTasks.push(pptSignature);
          trace('PPT', '已记录完成签名: ' + pptSignature);
          traceTaskQueue();
          isHandlingPpt = false;
          callback();
          return;
        }

        if (Date.now() - waitStart >= CONFIG.pptCompleteWaitMs) {
          trace('PPT', '等待服务器同步超时，强制完成');
          completedTasks.push(pptSignature);
          trace('PPT', '已记录完成签名(超时): ' + pptSignature);
          traceTaskQueue();
          isHandlingPpt = false;
          callback();
          return;
        }

        setTimeout(checkSync, 1000);
      }
      checkSync();
    }

    function flipNext() {
      if (window.__chaoxingAutoStop) {
        isHandlingPpt = false;
        return;
      }

      if (flipCount >= CONFIG.pptMaxFlips) {
        trace('PPT', '翻页达到上限 (' + CONFIG.pptMaxFlips + ')，等待服务器同步');
        // 翻页达到上限，不立即 nextChapter，等待服务器同步
        waitForServerSync(function() {
          var nextBtn = document.querySelector('#prevNextFocusNext');
          if (nextBtn) nextBtn.click();
          setTimeout(function() { scanAndExecute(); }, 2000);
        });
        return;
      }

      var pageInfo = getPageInfo();
      if (pageInfo.total > 0 && pageInfo.current > 0) {
        trace('PPT', '当前页: ' + pageInfo.current + '/' + pageInfo.total);
        if (pageInfo.current >= pageInfo.total) {
          trace('PPT', '已翻到最后一页，等待服务器同步');
          // 不立即 nextChapter，等待服务器同步
          waitForServerSync(function() {
            var skipBtn = document.querySelector('#prevNextFocusNext');
            if (skipBtn) {
              skipBtn.click();
              setTimeout(function() { scanAndExecute(); }, 2000);
            } else {
              // 修复：不直接跳章节，重新扫描确认
              scanRetryCount = 0;
              setTimeout(function() { scanAndExecute(); }, CONFIG.pageStabilizeDelay);
            }
          });
          return;
        }
      }

      var nextBtn = findNextButton();
      if (nextBtn) {
        trace('PPT', '翻页 ' + (flipCount + 1));
        nextBtn.click();
        flipCount++;
        lastActivityTime = Date.now();
        setTimeout(flipNext, CONFIG.pptFlipInterval);
        return;
      }

      if (tryScrollDown()) {
        flipCount++;
        lastActivityTime = Date.now();
        setTimeout(flipNext, CONFIG.pptFlipInterval);
        return;
      }

      trace('PPT', 'PPT/文档已翻完 (' + flipCount + ' 页)，等待服务器同步');
      // 不立即 nextChapter，等待服务器同步
      waitForServerSync(function() {
        var skipBtn = document.querySelector('#prevNextFocusNext');
        if (skipBtn) {
          trace('PPT', '点击"下一节"按钮');
          skipBtn.click();
          setTimeout(function() { scanAndExecute(); }, 2000);
        } else {
          // 修复：不直接跳章节，重新扫描确认
          scanRetryCount = 0;
          setTimeout(function() { scanAndExecute(); }, CONFIG.pageStabilizeDelay);
        }
      });
    }

    setTimeout(flipNext, 1000);
    return true;
  }

  // ========== 视频事件绑定 ==========
  function setupVideoEvents(el) {
    if (videoEventMap.get(el)) return;
    videoEventMap.set(el, true);

    el.addEventListener('ended', function() {
      onVideoEnded();
    });

    el.addEventListener('play', function() {
      isPlaying = true;
      recoverAttempt = 0;
      guardLastTime = Number(videoEl.currentTime || 0);
      guardLastWallTs = Date.now();
      setState(PlayerState.PLAYING);
      updateStatus('正在播放: ' + (window.__chaoxingStatus.title || '当前视频'));
    });

    el.addEventListener('pause', function() {
      if (window.__chaoxingAutoStop) return;
      if (videoEl.ended) return;
      trace('VIDEO', '视频被暂停，尝试恢复');
      setTimeout(function() {
        if (!window.__chaoxingAutoStop && videoEl && !videoEl.ended && videoEl.paused) {
          videoEl.play().catch(function() {});
        }
      }, 500);
    });

    el.addEventListener('loadedmetadata', function() {
      var dur = Number(el.duration);
      if (Number.isFinite(dur) && dur > 0) {
        trace('VIDEO', '视频加载完成，时长: ' + Math.floor(dur) + '秒');
        window.__chaoxingStatus.duration = dur;
        setState(PlayerState.PLAYING);
      } else {
        console.warn('[VIDEO] 视频时长无效: ' + dur);
      }
    });

    el.addEventListener('error', function(e) {
      console.error('[VIDEO] 视频加载错误:', e);
      setState(PlayerState.ERROR);
      recover();
    });
  }

  // ========== 视频播放完成处理 ==========
  function onVideoEnded() {
    if (window.__chaoxingAutoStop) return;
    trace('VIDEO', 'ended 事件触发');
    isPlaying = false;

    // 多信号联合判断完成
    if (videoEl && playVideoComplete(videoEl)) {
      // 记录完成签名
      if (runningTask && runningTask.signature) {
        completedTasks.push(runningTask.signature);
        trace('VIDEO', '已记录完成签名: ' + runningTask.signature);
        traceTaskQueue();
      }
      runningTask = null;
    }

    updateStatus('视频播放完成，准备切换...');
    logTaskSummary('onVideoEnded');

    // 检查任务队列：还有待执行任务则继续执行
    if (pendingTasks.length > 0) {
      trace('VIDEO', '还有 ' + pendingTasks.length + ' 个待执行任务');
      setTimeout(function() { executeNextTask(); }, 1000);
    } else {
      // 关键修复：队列为空时不直接跳章节，先重新扫描确认
      trace('VIDEO', '待执行队列为空，重新扫描确认是否全部完成');
      scanRetryCount = 0;
      setTimeout(function() { scanAndExecute(); }, CONFIG.pageStabilizeDelay);
    }
  }

  // ========== 任务队列执行 ==========
  function scanAndExecute() {
    if (window.__chaoxingAutoStop) return;

    setState(PlayerState.SEARCHING_TASK);
    trace('TASK', '=== 扫描任务点 (重试 ' + scanRetryCount + '/' + CONFIG.maxScanRetries + ') ===');
    updateStatus('正在扫描任务点...');

    // 检测章节切换
    var newChapterSignature = getCurrentChapterSignature();
    if (newChapterSignature !== currentChapterSignature) {
      trace('CHAPTER', '检测到章节切换，清空任务队列');
      pendingTasks = [];
      runningTask = null;
      currentChapterSignature = newChapterSignature;
      scanRetryCount = 0;
    }

    var tasks = findAllTaskPoints();

    // 关键修复：扫描结果为 0 不代表全部完成，可能是 DOM/iframe 未加载
    if (tasks.length === 0) {
      scanRetryCount++;
      lastScanSuccess = false;
      trace('TASK', '扫描到 0 个任务点（可能 DOM 未加载），重试 ' + scanRetryCount + '/' + CONFIG.maxScanRetries);

      if (scanRetryCount <= CONFIG.maxScanRetries) {
        updateStatus('未检测到任务点，等待页面加载后重试...');
        setTimeout(function() { scanAndExecute(); }, CONFIG.scanRetryDelay);
        return;
      }

      // 重试次数用完，仍然没有任务点 —— 不跳章节，进入等待
      trace('TASK', '重试 ' + CONFIG.maxScanRetries + ' 次仍未检测到任务点，不跳章节，等待恢复');
      updateStatus('未检测到任务点，等待中...');
      setState(PlayerState.IDLE);
      setTimeout(function() {
        scanRetryCount = 0;
        scanAndExecute();
      }, CONFIG.chapterJumpCooldown);
      return;
    }

    // 扫描成功，找到任务点
    scanRetryCount = 0;
    lastScanSuccess = true;

    // 过滤出未完成的任务
    pendingTasks = [];
    for (var i = 0; i < tasks.length; i++) {
      if (!tasks[i].completed) {
        pendingTasks.push(tasks[i]);
      }
    }

    trace('TASK', '待执行任务: ' + pendingTasks.length + '/' + tasks.length);
    traceTaskQueue();

    if (pendingTasks.length === 0 && !runningTask) {
      // 所有任务已完成 —— 必须通过 TaskSummary 验证才能跳章节
      logTaskSummary('scanAndExecute-before-nextChapter');

      var summary = getTaskSummary();
      if (summary.allTasksFinished) {
        trace('TASK', '所有任务已完成（已验证），切换到下一章节');
        setTimeout(function() { nextUnit(); }, 1000);
        return;
      } else {
        trace('TASK', '任务队列为空但 allTasksFinished=false，不跳章节');
        updateStatus('等待任务完成验证...');
        setState(PlayerState.IDLE);
        setTimeout(function() { scanAndExecute(); }, CONFIG.scanRetryDelay);
        return;
      }
    }

    // 执行下一个任务
    executeNextTask();
  }

  // 执行下一个任务
  function executeNextTask() {
    if (window.__chaoxingAutoStop) return;

    if (pendingTasks.length === 0) {
      // 关键修复：队列为空时不直接跳章节，先重新扫描确认
      trace('TASK', '待执行队列为空，重新扫描确认是否全部完成');
      scanRetryCount = 0;
      setTimeout(function() { scanAndExecute(); }, CONFIG.pageStabilizeDelay);
      return;
    }

    runningTask = pendingTasks.shift();
    trace('TASK', '开始执行任务: ' + runningTask.id + ' (type=' + runningTask.type + ')');
    traceTaskQueue();
    window.__chaoxingStatus.taskIndex = (window.__chaoxingStatus.taskIndex || 0) + 1;

    if (runningTask.type === 'VIDEO') {
      playVideoTask(runningTask);
    } else if (runningTask.type === 'PPT') {
      handlePptTask(runningTask);
    } else if (runningTask.type === 'QUIZ') {
      handleQuizTask(runningTask);
    } else {
      trace('TASK', '未知任务类型，跳过');
      executeNextTask();
    }
  }

  // 播放视频任务
  function playVideoTask(task) {
    setState(PlayerState.SEARCHING_VIDEO);

    if (!videoEl || !videoEl.isConnected) {
      videoEl = findVideo();
      if (!videoEl) {
        // 没有视频，可能是"学习目标"页、测验页或 PPT 页
        if (advanceLearningStep()) {
          updateStatus('正在切换到视频页...');
          setTimeout(function() { playVideoTask(task); }, 2000);
          return;
        }

        if (skipQuiz()) {
          updateStatus('正在跳过测验...');
          setTimeout(function() { playVideoTask(task); }, 2000);
          return;
        }

        if (handlePptOrDocument()) {
          return;
        }

        updateStatus('未找到视频，等待中...');
        setState(PlayerState.IDLE);
        return;
      }
      setupVideoEvents(videoEl);
    }

    if (!videoEl.isConnected) {
      trace('VIDEO', 'video 元素已断开连接，重新查找');
      videoEl = null;
      isPlaying = false;
      setTimeout(function() { playVideoTask(task); }, 1000);
      return;
    }

    setState(PlayerState.WAIT_METADATA);
    isPlaying = true;
    videoEl.muted = true;
    videoEl.playbackRate = CONFIG.playbackRate;

    var pos = findCurrentPosition();
    if (pos && pos.title) {
      window.__chaoxingStatus.title = pos.title;
    }

    videoEl.play().then(function() {
      trace('VIDEO', '视频开始播放 ' + videoEl.playbackRate + 'x');
      recoverAttempt = 0;
      setState(PlayerState.PLAYING);
    }).catch(function(e) {
      console.error('[VIDEO] 播放失败:', e.message);
      videoEl.muted = true;
      videoEl.play().then(function() {
        trace('VIDEO', '静音播放成功');
        setState(PlayerState.PLAYING);
      }).catch(function(err) {
        console.error('[VIDEO] 静音播放也失败:', err.message);
        setState(PlayerState.ERROR);
        recover();
      });
    });
  }

  // 处理 PPT 任务
  function handlePptTask(task) {
    if (!handlePptOrDocument()) {
      // PPT 处理失败，标记完成
      if (task.signature) {
        completedTasks.push(task.signature);
        trace('PPT', 'PPT 任务处理失败，标记完成');
      }
      runningTask = null;
      setTimeout(function() { executeNextTask(); }, 1000);
    }
  }

  // 处理 Quiz 任务
  function handleQuizTask(task) {
    if (!skipQuiz()) {
      // 跳过失败，标记完成
      if (task.signature) {
        completedTasks.push(task.signature);
        trace('QUIZ', 'Quiz 跳过失败，标记完成');
      }
      runningTask = null;
      setTimeout(function() { executeNextTask(); }, 1000);
    } else {
      // 跳过成功，等待页面切换后继续
      setTimeout(function() {
        runningTask = null;
        scanAndExecute();
      }, CONFIG.quizSkipWaitMs);
    }
  }

  // ========== 指数退避恢复（带 RecoverLock + AbortController） ==========
  function recover() {
    if (window.__chaoxingAutoStop) return;

    // RecoverLock：保证同一时刻只有一个恢复器工作
    if (recoverLock) {
      trace('RECOVER', '已有恢复器在工作，跳过');
      return;
    }

    recoverLock = true;
    setState(PlayerState.RECOVERING);
    recoverAttempt++;

    // AbortController：用于取消正在进行的恢复
    if (recoverAbortController) {
      try { recoverAbortController.abort(); } catch (e) {}
    }
    recoverAbortController = new AbortController();

    var delay = Math.min(
      CONFIG.recoverBaseDelay * Math.pow(2, recoverAttempt - 1),
      CONFIG.recoverMaxDelay
    );

    trace('RECOVER', '第 ' + recoverAttempt + ' 次恢复，等待 ' + delay + 'ms');
    updateStatus('恢复中 (' + recoverAttempt + ')，等待 ' + Math.floor(delay / 1000) + 's');

    var abortSignal = recoverAbortController.signal;

    setTimeout(function() {
      if (window.__chaoxingAutoStop || abortSignal.aborted) {
        recoverLock = false;
        return;
      }

      // 重置状态
      videoEl = null;
      isPlaying = false;
      isHandlingPpt = false;
      isHandlingQuiz = false;
      runningTask = null;

      recoverLock = false;
      recoverAbortController = null;

      // 重新扫描并执行
      scanAndExecute();
    }, delay);
  }

  // ========== 视频状态检查 ==========
  function checkVideoStatus() {
    if (window.__chaoxingAutoStop) {
      clearInterval(checkTimer);
      if (watchdogTimer) clearInterval(watchdogTimer);
      window.__chaoxingAutoplayActive = false;
      window.__chaoxingStatus.active = false;
      window.__chaoxingStatus.message = '已停止';
      setState(PlayerState.IDLE);
      return;
    }

    try {
      if (videoEl && videoEl.isConnected) {
        var ct = Number(videoEl.currentTime);
        var dur = Number(videoEl.duration);
        window.__chaoxingStatus.currentTime = Number.isFinite(ct) ? ct : 0;
        window.__chaoxingStatus.duration = Number.isFinite(dur) ? dur : 0;
        window.__chaoxingStatus.playing = isPlaying;

        // 多信号联合判断完成
        if (isPlaying && playVideoComplete(videoEl)) {
          trace('VIDEO', '检测到视频完成（多信号判断）');
          isPlaying = false;
          onVideoEnded();
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
              lastActivityTime = now;
            } else if (!stalled) {
              guardLastWallTs = now;
              guardLastTime = current;
              lastActivityTime = now;
            }
          }
        }
      } else if (!isHandlingPpt && (!videoEl || !videoEl.isConnected)) {
        videoEl = null;
        isPlaying = false;
        if (currentState !== PlayerState.RECOVERING && !recoverLock) {
          scanAndExecute();
        }
      }
    } catch (e) {
      console.error('[cx] 监控出错:', e);
      setState(PlayerState.ERROR);
      recover();
    }
  }

  function tryResume(reason) {
    if (window.__chaoxingAutoStop) return;
    if (!videoEl || videoEl.ended) return;

    trace('RECOVER', '尝试恢复播放 (' + reason + ')');
    try {
      videoEl.muted = true;
      videoEl.playbackRate = CONFIG.playbackRate;
      videoEl.play().then(function() {
        trace('RECOVER', '恢复播放成功 (' + reason + ')');
        lastActivityTime = Date.now();
      }).catch(function(e) {
        console.error('[RECOVER] 恢复播放失败:', e.message);
      });
    } catch (e) {
      console.error('[RECOVER] 恢复播放异常:', e);
    }
  }

  // ========== WatchDog 监控 ==========
  function watchdog() {
    if (window.__chaoxingAutoStop) return;

    var now = Date.now();
    var idleMs = now - lastActivityTime;

    if (idleMs >= CONFIG.watchdogTimeoutMs) {
      trace('RECOVER', 'WatchDog: ' + Math.floor(idleMs / 1000) + 's 无活动，自动恢复');
      updateStatus('WatchDog 触发，重新扫描任务点...');
      lastActivityTime = now;

      // 重置状态，重新扫描
      videoEl = null;
      isPlaying = false;
      isHandlingPpt = false;
      isHandlingQuiz = false;
      runningTask = null;

      // 重新扫描任务点
      scanAndExecute();
    }
  }

  // ========== MutationObserver 监听 DOM 变化 ==========
  function setupMutationObserver() {
    if (mutationObserver) mutationObserver.disconnect();

    try {
      mutationObserver = new MutationObserver(function(mutations) {
        if (window.__chaoxingAutoStop) return;

        var hasVideoChange = false;
        for (var i = 0; i < mutations.length; i++) {
          var mutation = mutations[i];
          if (mutation.addedNodes) {
            for (var j = 0; j < mutation.addedNodes.length; j++) {
              var node = mutation.addedNodes[j];
              if (node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                hasVideoChange = true;
                trace('FRAME', '检测到新 ' + node.tagName + ' 元素');
                break;
              }
              if (node.querySelector) {
                if (node.querySelector('iframe, video')) {
                  hasVideoChange = true;
                  break;
                }
              }
            }
          }
        }

        if (hasVideoChange && (!videoEl || !videoEl.isConnected)) {
          trace('FRAME', 'DOM 变化，重新查找视频');
          videoEl = null;
          isPlaying = false;
          setTimeout(function() {
            if (!window.__chaoxingAutoStop && (!videoEl || !videoEl.isConnected)) {
              if (currentState !== PlayerState.RECOVERING && !recoverLock) {
                scanAndExecute();
              }
            }
          }, 1000);
        }
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      trace('FRAME', 'MutationObserver 已启动');
    } catch (e) {
      console.error('[FRAME] MutationObserver 启动失败:', e);
    }
  }

  // ========== 防止页面事件导致暂停 ==========
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

  // ========== 启动 ==========
  trace('SYSTEM', '=== 自动播放脚本启动（深度重构版 v2）===');
  setState(PlayerState.IDLE);
  updateStatus('脚本已启动，正在扫描任务点...');

  currentChapterSignature = getCurrentChapterSignature();
  setupMutationObserver();

  checkTimer = setInterval(checkVideoStatus, CONFIG.checkInterval);
  watchdogTimer = setInterval(watchdog, CONFIG.watchdogInterval);

  // 初始扫描任务点并执行
  scanAndExecute();
})();
`;
