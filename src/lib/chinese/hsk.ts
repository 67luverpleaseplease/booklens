/**
 * HSK banding.
 *
 * A full HSK word list runs to several thousand entries and is mostly noise for
 * our purpose — the badge only has to answer "is this a beginner word or not".
 * So this is a compact character-frequency heuristic over the HSK 1–3 core.
 *
 * Anything outside those bands returns undefined and shows no badge at all,
 * which is more honest than guessing a level we don't know.
 */

const HSK1_CHARS =
  '我你他她们的是不了在有人这那个好会说看想来去吃喝上下中大小多少很太都也和' +
  '一二三四五六七八九十百千万年月日天时分点家学生老师同朋友爸妈儿女名字' +
  '国语汉什么谁哪里几怎样请谢对起再见喂呢吗吧现昨今明早晚前后面边开关买' +
  '卖做住坐站走跑回出进到给能可以要爱冷热高长新旧水菜饭茶书车电话医院';

const HSK2_CHARS =
  '因为所但还就才已经正刚每些从向往离跟比被让把得着过完始结束帮助找等送' +
  '拿放觉认识知道白希望打算准备应该必须许当然其实特别非真差不一定马上突' +
  '忽终于果竟难题左右外内旁间旅游机场票房间宾馆运动球唱歌跳舞画';

const HSK3_CHARS =
  '影响决提供表示认需关系情况问办法方经验力会条件环境社文化历史世界政府' +
  '公司工作活感心性格习惯兴趣梦标计划原变发展步成失败困简单复杂重主般普' +
  '通殊清楚显解释研究调查参加举办安排联络交流讨论建议接受拒绝坚持努实现';

const HSK1 = new Set(HSK1_CHARS);
const HSK2 = new Set(HSK2_CHARS);
const HSK3 = new Set(HSK3_CHARS);

function charLevel(ch: string): number | undefined {
  if (HSK1.has(ch)) return 1;
  if (HSK2.has(ch)) return 2;
  if (HSK3.has(ch)) return 3;
  return undefined;
}

/**
 * Level for a word, banded by its hardest character — that's the one that makes
 * it hard to read. Returns undefined when any character falls outside HSK 1–3,
 * since we have no basis for a number beyond that.
 */
export function hskLevel(word: string): number | undefined {
  if (!word) return undefined;

  let worst = 0;
  for (const ch of word) {
    const level = charLevel(ch);
    if (level === undefined) return undefined;
    worst = Math.max(worst, level);
  }
  return worst || undefined;
}
