import { getLearningPage } from '../launcher.js';
import { logger } from '../../utils/logger.js';
import { TimingConfig } from '../../utils/TimingConfig.js';

interface CourseTreeData {
  cells: any[];
  currentCellIndex: number;
  currentNCellIndex: number;
  nCellsPerCell: any[][];
}

/**
 * 章节管理器
 * 负责章节进入、章节切换（统一的 nextChapter 实现）、课程目录树数据获取
 */
export class ChapterManager {
  /**
   * 获取课程目录树数据
   * 解析 #coursetree 中的章节和视频节点，定位当前激活位置
   */
  async getCourseTreeData(): Promise<CourseTreeData | null> {
    try {
      const page = getLearningPage();

      const courseTree = await page.$('#coursetree');
      if (!courseTree) {
        logger.debug('未找到课程目录树 #coursetree');
        return null;
      }

      const cells = await courseTree.$$('ul > li');
      if (cells.length === 0) {
        logger.debug('课程目录树中没有章节 li');
        return null;
      }

      // 收集每个章节的视频节点，并找到当前激活的节点
      const nCellsPerCell: any[][] = [];
      let currentCellIndex = 0;
      let currentNCellIndex = 0;
      let foundCurrent = false;

      for (let i = 0; i < cells.length; i++) {
        const nCells = await cells[i].$$('.posCatalog_select:not(.firstLayer)');
        nCellsPerCell.push(nCells);

        for (let j = 0; j < nCells.length; j++) {
          const className = (await nCells[j].getAttribute('class')) || '';
          if (className.includes('posCatalog_active')) {
            currentCellIndex = i;
            currentNCellIndex = j;
            foundCurrent = true;
          }
        }
      }

      if (!foundCurrent) {
        logger.warning('未找到当前激活的视频节点（.posCatalog_active）');
      }

      logger.debug(
        `课程信息: ${cells.length}章, 共${nCellsPerCell.flat().length}节, 当前: 第${currentCellIndex + 1}章第${currentNCellIndex + 1}节`
      );

      return {
        cells,
        currentCellIndex,
        currentNCellIndex,
        nCellsPerCell,
      };
    } catch (error) {
      logger.debug(`获取课程目录树数据失败: ${String(error)}`);
      return null;
    }
  }

  /**
   * 进入章节
   * 点击指定章节的指定节点并等待加载
   */
  async enterChapter(chapterIndex: number, nodeIndex: number = 0): Promise<boolean> {
    const page = getLearningPage();

    try {
      const treeData = await this.getCourseTreeData();
      if (!treeData) {
        logger.warning('无法获取课程目录树');
        return false;
      }

      const { nCellsPerCell } = treeData;
      const chapterNodes = nCellsPerCell[chapterIndex] || [];

      if (chapterNodes.length === 0) {
        logger.warning(`第 ${chapterIndex + 1} 章没有可进入的节点`);
        return false;
      }

      const targetIndex = Math.min(nodeIndex, chapterNodes.length - 1);
      const clicked = await this.clickVideoNode(chapterNodes[targetIndex]);
      if (!clicked) return false;

      await page
        .waitForSelector('iframe, video', { timeout: TimingConfig.METADATA_TIMEOUT })
        .catch(() => {
          logger.warning('进入章节后未检测到 iframe 或 video');
        });

      logger.success(`已进入第 ${chapterIndex + 1} 章第 ${targetIndex + 1} 节`);
      return true;
    } catch (error) {
      logger.error(`进入章节失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 切换到下一小节（全项目唯一的 nextChapter 实现）
   * 1. 同章节内还有下一个视频 → 切换到同章节下一个
   * 2. 同章节已是最后 → 切换到下一个有视频的章节
   * 3. 已是最后一节 → 返回 false 表示课程完成
   */
  async nextChapter(): Promise<boolean> {
    const page = getLearningPage();

    try {
      logger.info('尝试切换到下一小节...');

      const treeData = await this.getCourseTreeData();
      if (!treeData) {
        return false;
      }

      const { cells, currentCellIndex, currentNCellIndex, nCellsPerCell } = treeData;
      const currentChapterNCells = nCellsPerCell[currentCellIndex] || [];

      // 1. 同章节内还有下一个视频
      if (currentChapterNCells.length > currentNCellIndex + 1) {
        const nextNIndex = currentNCellIndex + 1;
        logger.info(
          `切换到同章节下一个视频: ${nextNIndex + 1}/${currentChapterNCells.length}`
        );
        const clicked = await this.clickVideoNode(currentChapterNCells[nextNIndex]);
        if (!clicked) return false;
      } else {
        // 2. 切换到下一个有视频的章节
        let foundNextChapter = false;
        for (let i = currentCellIndex + 1; i < cells.length; i++) {
          const nextChapterNCells = nCellsPerCell[i] || [];
          if (nextChapterNCells.length > 0) {
            logger.info(`切换到下一个章节: ${i + 1}/${cells.length}`);
            const clicked = await this.clickVideoNode(nextChapterNCells[0]);
            if (!clicked) return false;
            foundNextChapter = true;
            break;
          }
        }

        // 3. 已是最后一节
        if (!foundNextChapter) {
          logger.success('已经是最后一节，本课程学习完成');
          return false;
        }
      }

      // 等待 iframe 或 video 更新
      await page
        .waitForSelector('iframe, video', { timeout: TimingConfig.METADATA_TIMEOUT })
        .catch(() => {
          logger.warning('切换后未检测到 iframe 或 video');
        });

      logger.success('已切换到下一小节');
      return true;
    } catch (error) {
      logger.error(`切换下一小节失败: ${String(error)}`);
      return false;
    }
  }

  /**
   * 点击视频节点并等待加载
   */
  private async clickVideoNode(nCell: any): Promise<boolean> {
    try {
      const page = getLearningPage();

      const clickableSpan = await nCell.$('.posCatalog_name');
      if (!clickableSpan) {
        logger.error('找不到可点击的课程节点 .posCatalog_name');
        return false;
      }

      const title =
        (await clickableSpan.getAttribute('title')) ||
        (await clickableSpan.textContent()) ||
        '未知标题';
      logger.info(`点击切换到: ${title.trim()}`);

      await clickableSpan.click();

      // 等待页面加载
      await page.waitForTimeout(TimingConfig.NEXT_CHAPTER_DELAY);
      await page.waitForLoadState('domcontentloaded').catch(() => {});

      return true;
    } catch (error) {
      logger.error(`点击视频节点失败: ${String(error)}`);
      return false;
    }
  }
}
