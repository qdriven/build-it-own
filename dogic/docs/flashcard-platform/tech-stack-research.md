# Flashcard MVP vs vivid-dsh 技术选型调研报告

> 对应 issue: qdriven/build-it-own#1
> 调研日期: 2026-10-20 · 调研方式: 两个项目都在本地实际启动 + 生产构建, 数据均为实测

## 1. 背景与要回答的问题

仓库里有两个"教学类"前端应用, 交付的是同一份教学内容的不同形态:

| | flashcard-mvp | vivid-dsh |
|---|---|---|
| 位置 | `apps/edu/flashcard-mvp` | `dsh-tutorials/vivid-dsh` |
| 形态 | 闪卡 (flashcard) 滑动卡组 | 交互式教程工作台 (分步动画 + 节点图 + 日志 + 测验) |
| 内容 | `content/decks/*.md` (markdown) | `src/lessons/*.ts` (强类型 TS 数据) |

证据: flashcard-mvp 的 `content/decks/01-harness-basics.md` 正是 vivid-dsh 第 01 课《模型只会说话，谁去动手》的闪卡化改写; `FlashcardDeck.tsx:86` 注释直说"沿用 vivid-dsh useLessonPlayer 的约定"。**所以这不是两个孤立项目的对比, 而是同一教学内容的两种内容管线 + 两套技术底座的对比。**

issue 要回答: 后续做闪卡/教学应用, 采用哪边的技术更合适。

## 2. 技术栈对比 (实测)

### 2.1 工具链

| 项 | flashcard-mvp | vivid-dsh | 谁优 |
|---|---|---|---|
| Vite | 7.3.0 (Rollup) | 8.3.4 (Rolldown) | vivid-dsh |
| Tailwind | 3.4 + postcss/autoprefixer | 4.3 (`@tailwindcss/vite` 插件, 无 postcss 链) | vivid-dsh |
| TypeScript | 5.9 | 7.0 | vivid-dsh (新) |
| React | 19.2 | 19.3 | 持平 |
| 字体 | 系统字体 | fontsource 自托管 (Geist / JetBrains Mono) | 看需求 |

### 2.2 依赖规模

| 项 | flashcard-mvp | vivid-dsh |
|---|---|---|
| 运行时依赖 | **53 个** | **6 个** (react/react-dom/framer-motion/phosphor-icons/两个 fontsource) |
| devDependencies | 20 个 | 7 个 |
| node_modules 顶层包数 | **354 个** | **11 个** |
| 底座来源 | shadcn/ui 模板全量生成 (template-info.md: 一次性生成 40+ UI 组件) | 手写最小组件集 |

flashcard-mvp 的 53 个运行时依赖几乎全部来自 shadcn 全量模板: 24 个 radix 包、react-hook-form、zod、recharts、react-router、date-fns…… 而实际业务代码只有约 370 行, 用到的 shadcn 组件只有 button / progress 等少数几个。

### 2.3 构建与启动 (本机实测, Windows 11)

| 指标 | flashcard-mvp | vivid-dsh | 倍差 |
|---|---|---|---|
| dev server ready | 5253 ms | **406 ms** | ~13× |
| 生产构建总耗时 (含 tsc) | 18.2 s | **2.3 s** | ~8× |
| 其中 vite/rolldown 打包 | 4.96 s (2036 modules) | 0.47 s (5001 modules) | ~10× |
| 产物 JS | **535 KB (gzip 170 KB)** | 737 KB (gzip 228 KB) | flashcard 小 |
| 产物 CSS | 102.9 KB (gzip 16.3 KB) | **48.6 KB (gzip 12.8 KB)** | vivid-dsh 减半 |

解读:
- vivid-dsh 的工具链 (Vite 8 + Rolldown + Tailwind 4) 在启动和构建上全面碾压, 即使它要转换的 module 数反而更多 (framer-motion 拆得碎)。
- flashcard-mvp 产物 JS 更小, 但代价是 53 个依赖的维护面; vivid-dsh 的 JS 大头是 framer-motion (gzip 200KB+ 级别), 对闪卡场景并非必需——翻转/滑动用 CSS transition 即可。
- vivid-dsh 的 CSS 产物只有一半, 是 Tailwind 4 的收益。

## 3. 架构对比: 内容管线 (本次调研最核心的差异)

### 3.1 flashcard-mvp: markdown → 结构化数据 → 渲染器注册表

```
content/decks/*.md
  → import.meta.glob(raw) 构建时收集 (decks.ts, 新增卡组=丢一个 md 文件)
  → unified/remark 管线 (frontmatter + gfm + directive) 解析成 Card[] (cards.ts, 172 行)
  → 卡类型 → 渲染器注册表 (components/cards/registry.ts)
  → 少量渲染器: MarkdownCard / FlipCard / QuizCard (共 192 行)
```

亮点: `cards.ts` 注释明确写了架构意图——**"不把 md 直接转成 HTML, 而是转成结构化 Card 数据, 保留内容可以被体检脚本校验的架构红利"**。`:::quiz` / `:::ref` 这类 directive 让非程序员作者也能写卡, git diff 友好。

短板: 那个体检脚本**目前不存在**。md 写错了 (quiz 答案越界、`:::ref` 指向不存在的文件、directive 属性拼错) 只能在运行时靠肉眼发现。

### 3.2 vivid-dsh: 强类型 TS 数据 → 单一工作台 → 体检脚本

```
src/lessons/*.ts (20 课, 每课一份纯数据, Lesson 接口 230 行、字段全部带文档注释)
  → 单一工作台 LessonView 渲染 (529 行), 新增一课 = 新增一个数据文件, 不写新组件
  → scripts/check-lessons.ts (443 行) 内容体检, npm run check
```

体检脚本查的是类型系统管不到的东西: 动画点亮的节点/连线是否真的存在于图里、答案下标是否越界、布局是否溢出网格、中文标签按"字宽"估算是否画得下, 甚至 **CodeBlock.source 标注的源码路径+行号会被真的打开文件核对** (还有 `partial` 标记豁免机制)。配套的 `demo/mini-harness` (`npm run demo`) 让教程引用的代码全部真实可跑。

短板: 作者必须会 TS, 内容和代码混在一个仓库形态里; 交互 (分步动画、节点图、播放器) 与"闪卡"这种轻形态相比重得多, LessonView 529 行不易复用到别的形态。

### 3.3 对比结论

| 维度 | md 管线 (flashcard-mvp) | TS 数据 (vivid-dsh) |
|---|---|---|
| 作者门槛 | 低, 会 markdown 即可 | 要会 TS |
| 类型安全 | 无 (靠将来的体检脚本) | 编辑器内即时校验 |
| 内容校验 | ❌ 缺失 | ✅ 443 行体检脚本 |
| IDE 体验 (写内容时) | 无补全 | 字段补全 + 文档注释 |
| git diff / review | ✅ 天然友好 | 可接受 |
| 一份内容多形态渲染 | ✅ registry 模式, 加渲染器即可 | 单一工作台, 换形态要改大组件 |

## 4. 建议

"用哪边的技术"其实是三层选择, 拆开答:

1. **工具链 → 选 vivid-dsh 的**: Vite 8 (Rolldown) + Tailwind 4 + `@tailwindcss/vite`。启动 13× 、构建 8× 的差距是白拿的, 且 flashcard-mvp 迁移成本极低 (它实际用的 Tailwind 特性很少)。
2. **UI 组件 → 反对 flashcard-mvp 的"模板全量"做法**: 53 个依赖里 90% 没被用到。按需手写/按需 shadcn add; framer-motion 对闪卡场景可省 (CSS 足够), 除非要 vivid 那种节点点亮动画。
3. **内容管线 → 保留 flashcard-mvp 的 md→结构化 Card 方向, 补上 vivid-dsh 的体检思想**:
   - md 管线对 dogic 的平台愿景 (见 `dogic/README.md`: 组装式、面向更广作者) 更对——作者门槛低、内容即数据、registry 可扩展多形态。
   - 但必须补一个 `npm run check`: 校验 quiz 答案下标、directive 类型是否在注册表里、`:::ref` 引用的源码文件/行是否存在 (直接抄 vivid-dsh check-lessons.ts 的思路, 它连"中文字宽估算"这种细节都解决了)。
   - 顺带把 `cards.ts:4` 引用的 `dogic/docs/flashcard-platform/0-research.md` 补回仓库——代码引用了一份不存在的研究文档。

一句话: **底座抄 vivid-dsh, 内容管线留 flashcard-mvp, 校验抄 vivid-dsh, 组件按需。**

## 5. 附: worktree 下 gitignore 目录问题 (issue 第 2 点)

`.gitignore` 忽略了 `apps/`、`dsh-tutorials/`、`examples/`, 所以本 worktree 里本来没有这两个项目。本次调研的解决方式 (可复用):

```bash
# 1. 从主 checkout 拷贝源码 (排除 node_modules / dist)
robocopy 'D:\innate-workspace\build-it-own\apps\edu\flashcard-mvp' 'apps\edu\flashcard-mvp' /E /XD node_modules dist .cache
robocopy 'D:\innate-workspace\build-it-own\dsh-tutorials\vivid-dsh' 'dsh-tutorials\vivid-dsh' /E /XD node_modules dist .cache

# 2. node_modules 用 junction 复用主 checkout 的安装, 免重装
cmd //c "mklink /J apps\edu\flashcard-mvp\node_modules D:\innate-workspace\build-it-own\apps\edu\flashcard-mvp\node_modules"
cmd //c "mklink /J dsh-tutorials\vivid-dsh\node_modules D:\innate-workspace\build-it-own\dsh-tutorials\vivid-dsh\node_modules"
```

实测结果: 两个 dev server (5173 / 5174) 和两次生产构建全部一次跑通, 无需 npm install。

注意与长期建议:
- junction 指向主 checkout, 主 checkout 里 `npm install` 升级/删除包会直接影响 worktree (这是共享, 不是拷贝)。依赖不同步时需删掉 junction 重装。
- 更稳的长期方案三选一: (a) 把 `apps/`、`dsh-tutorials/` 纳入 git 管理 (推荐——源码本就该进版本库, ignore 只留 `node_modules/`、`dist/`); (b) 写一个 `scripts/sync-ignored.sh` 把上述拷贝+junction 固化; (c) 若项目多了, 转 pnpm workspace 共享依赖。

## 6. 实测环境备注

- 两个项目均从本 worktree 启动: flashcard-mvp → http://localhost:5173, vivid-dsh → http://localhost:5174, 均返回 200 且模块转换正常。
- 构建命令均为各自 `npm run build` (= `tsc -b && vite build`), 计时含 TypeScript 编译。
- 本机: Windows 11, Node 20+。数据为单次实测, 量级差距 (13×/8×) 远大于抖动, 结论可靠。
