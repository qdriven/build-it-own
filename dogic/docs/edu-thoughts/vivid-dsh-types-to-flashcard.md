# vivid-dsh types.ts 到 Flashcard 的内容模型分析

> 分析日期: 2026-10-20 · 分析对象: `dsh-tutorials/vivid-dsh/src/tutorial/types.ts` + 20 节课堂数据
> 结论先行: **可行, 且成本主要在内容裁剪而非代码。** 建议新建 `Flashcard` 类型, 复用 vivid-dsh 的四个核心类型, terminal 先做回放式假终端。

## 1. 背景与要回答的问题

vivid-dsh 的 `types.ts` 设计得不错, 但它描述的是一节 **8 分钟精读课** (`Lesson`), 不是一张 **30~60 秒的闪卡**。直接拿 `Lesson` 装闪卡内容, 会偏多、不适合教学。

本文要回答: 闪卡的内容模型应该长什么样; vivid-dsh 里哪些零件可以搬; terminal (右侧代码面板) 怎么做; 以及四种闪卡的布局示意。

期望的闪卡内容构成 (来自需求):

1. oneLine 问题
2. 答案
3. 概念拆解
4. 概念之间的相互关系, 通过图例说明
5. 实际代码例子展示在右侧, 可以通过 terminal 操作查看代码

## 2. types.ts 现状评估: 好在哪

这套 `Lesson` 设计有真功夫, 值得继承的点:

| 设计 | 为什么好 |
|---|---|
| **纯数据驱动** ("新增一节课 = 新增一个数据文件") | 渲染器和内容解耦, 同一套工作台复用 |
| `StageNode/StageEdge` 的 `col/row` 网格 + `kind` 配色 | 关系图是声明式的, 不用写 SVG |
| `CodeBlock.source` + 体检真的打开文件核对行号 | 内容和真实源码**强绑定**, 不会烂掉 |
| `LessonStep` 的 `activeNodes/activeEdges` 分帧动画 | 把"关系"变成时间序列, 教学价值极高 |
| `QuizItem.wrongExplains` 每个错项专属反驳 | "答错那一刻是唯一能确诊的时机"——认知科学正确 |
| 字段注释里的**写作判据** (删除测试、角色对齐) | 类型即写作规范 |

## 3. 问题: 粒度错了, 不是设计错了

一套 `Lesson` 的量级 (实测):

- 平均 **320 行/节**, 20 节共 6668 行
- 一节 = positioning + 4~8 个 concept + 7 节点关系图 + 5~8 个 step + quiz + misconceptions + takeaways
- 定位是 **8 分钟精读**, 读者是"坐在工位前学完一个框架"的人

而 flashcard 的本质是**单次检索练习 (retrieval practice)**, 一张卡的认知预算是 **30~60 秒**、一个可提取的记忆点。用 `Lesson` 的结构装 flashcard, 等于把一章教材塞进一张便利贴:

- `stage.nodes` 有 7 个节点时, 读者根本来不及在脑内重放
- `steps` 的 5~8 帧动画在卡片场景里变成了干扰
- 关键区别不是内容多少, 是**交互契约**: Lesson 是"你跟着我走一遍", flashcard 是"你先想, 再翻开对答案"。`LessonStep.detail` 是讲授式文本, flashcard 需要的是 question → 停顿 → answer 的两段式

## 4. 可行性: 高, 零件全在

vivid-dsh 里最有价值的类型可以**原样搬运**:

| vivid-dsh 零件 | 搬进 flashcard 后的角色 |
|---|---|
| `StageNode/StageEdge` (缩小规模) | 概念关系图, 一张卡 3~5 节点 |
| `CodeBlock` (source + highlight + note) | 右侧代码面板, 保持源码可核对 |
| `ConceptRow` | 概念拆解, 一张卡限 2~3 行 |
| `Misconception` (wrong/right) | 独立成一种"辨析卡" |
| `oneLiner` | 卡片正面的问题句 |

需要新建的只有两块: **卡片的二段式结构** (front/back) 和**右侧 terminal**。

### 4.1 Terminal 的三个方案

| 方案 | 成本 | 效果 |
|---|---|---|
| **A. 回放式假终端** (推荐先做) | 低 | 数据里已经有 `LogLine`, 按序回放 `npm run demo` 的输出 + 高亮对应行。零后端 |
| B. WebContainers (StackBlitz) | 中 | 浏览器里跑真 Node, 能真的 `cat loop.ts`。但 demo 依赖 pnpm workspace, 迁进去麻烦 |
| C. node-pty + WebSocket | 高 | 真终端, 需要常驻服务 |

方案 A 完全够: 卡片教学场景里读者要的是"看到这一行真的存在于源码/运行记录里", 不是任意命令。可以在 `CodeBlock.source` 基础上加一个 `replay` 字段, terminal 逐行打出 log, 最后 `cat demo/mini-harness/loop.ts | sed -n '39,46p'` 式地展示代码——仪式感和证据感都有。

## 5. 建议的卡片类型设计

```ts
/** 一张卡 = 一个可检索的记忆点。30~60 秒内完成一次 front→back。 */
export interface Flashcard {
  id: string;
  /** 卡片种类, 决定渲染布局 */
  kind: "concept" | "relation" | "misconception" | "code";
  front: {
    /** 一句话问题 (对应需求里的 oneLine) */
    question: string;
    /** 可选: 先给上下文再提问 */
    setup?: string;
  };
  back: {
    /** 答案, 一句话 */
    answer: string;
    /** 概念拆解, 最多 3 行 */
    breakdown?: ConceptRow[];          // 复用 vivid-dsh
    /** 概念关系图, 最多 5 节点 */
    diagram?: { nodes: StageNode[]; edges: StageEdge[] };  // 复用, 缩小规模
  };
  /** 右侧终端区: 源码 + 可回放的运行记录 */
  terminal?: {
    code: CodeBlock;                   // 复用, source 可被体检核对
    replay?: LogLine[];                // 假终端逐行回放
  };
  /** 下一张卡 (可组成 3~5 张的微 deck) */
  next?: string;
}
```

设计要点:

- `kind` 决定布局而不是内容——同一个渲染器, 四种模板。
- `breakdown` 和 `diagram` 都是**可选**的: 辨析卡不需要图, 关系卡不需要拆解。强制每张卡四件齐全就会退回到"内容偏多"的老问题。
- 上限写进类型注释 (3 行拆解、5 节点图) 并让体检强制执行——vivid-dsh 已有体检机制 (`scripts/` 里的体检会真的打开 `CodeBlock.source` 核对行号), 直接加规则。

## 6. 示意图: 四种卡片的布局

### 6.1 概念卡 (最常见——左问右码)

```
┌─────────────────────────────┬──────────────────────────────┐
│  ◆ 概念卡                    │  $ demo/mini-harness          │
│                             │                              │
│  Q: 模型说「删掉它」的        │  session/append {type=user}  │
│     那一刻, 文件删了吗?       │  model/request {round=1}     │
│                             │  model/reply: 我要调 rm_file  │
│  [ 翻开答案 ]                │  ⏸ approval/pending …        │
│                             │                              │
│  ── 翻开后 ──────────────    │  $ cat loop.ts | sed -n      │
│  A: 没删。模型只输出了        │      '39,46p'                │
│     「我要删」这句话,         │  39  async function runTurn(  │
│     动手的是 harness         │  45    session.append(       │
│     里的工具。               │  46      'turn/start', …     │
│                             │  ▲ 高亮行 = 答案的证据        │
│  拆解:                       │                              │
│  · 会话记录 → 记在外面       │  [ ⏵ 重新回放 ]              │
│  · 工具     → 真正动手       │                              │
│  · 循环     → 每次要工具     │                              │
│      就多问一次              │                              │
└─────────────────────────────┴──────────────────────────────┘
```

### 6.2 关系卡 (考"谁连谁"——图是主角)

```
┌─────────────────────────────┬──────────────────────────────┐
│  ◈ 关系卡                    │  $ npm run demo (会话 s1)     │
│                             │                              │
│  Q: 把图里缺的那条边         │  状态回放…                    │
│     补上:                   │                              │
│                             │                              │
│   [用户] ──► [循环] ──► ???  │  $ cat plugins/session.ts    │
│               │    ▲        │  21  append(type, data) {     │
│               ▼    │        │  23    this.logs.push(…)     │
│          [会话记录]──┘       │                              │
│                             │                              │
│  [ 翻开答案 ]                │  ▲ derive() 每步重念全部记录  │
│  ─────────────────────      │                              │
│  A: 循环 ──整包发过去──►     │                              │
│     [大模型]                 │                              │
│  关键: 模型不记得上一句,      │                              │
│  每一步都从头带一遍           │                              │
└─────────────────────────────┴──────────────────────────────┘
```

### 6.3 辨析卡 (复用 `Misconception`, 最轻, 可无图无码)

```
┌────────────────────────────────────────────┐
│  ⚡ 辨析卡                                   │
│                                            │
│  Q: 「harness 是一个组件」这句话对吗?         │
│                                            │
│  [ 翻开答案 ]                               │
│  ──────────────────────────────────────    │
│  ✗ harness 是某一个部件, 像插件那样可装卸     │
│  ✓ harness 是模型以外所有东西的**总称**:      │
│    会话记录、工具、循环、权限确认都是它的一块  │
│                                            │
│  ::ref  demo/mini-harness/ 目录下           │
│          loop.ts / plugins/* 每个文件       │
│          都是 harness 的一块                │
└────────────────────────────────────────────┘
```

### 6.4 代码卡 (考读码——terminal 是主角)

```
┌─────────────────────────────┬──────────────────────────────┐
│  ⌨ 代码卡                    │  $ cat loop.ts | sed -n      │
│                             │      '51,56p'                │
│  Q: 下面这段每次调用 model   │                              │
│     时, messages 里装的是    │  51   const reply = await     │
│     什么?                    │  52     model.ask({           │
│                             │  53       system: SYSTEM,     │
│  提示: 模型不记得上一句       │  54       tools: tools.list() │
│                             │  55       messages: session    │
│  [ 翻开答案 ]                │  56         .derive(),  ◀──── │
│  ─────────────────────      │                              │
│  A: derive() 拼出的         │  $ ⏵ 回放运行记录             │
│     **整段对话**——           │  session/append {seq=2,       │
│     系统提示 + 工具清单       │    type=step/start}          │
│     + 到目前为止的每一条。    │  model/request {round=1,     │
│     每一步都从头带一遍。      │    messageCount=1} ◀ 对上了  │
└─────────────────────────────┴──────────────────────────────┘
```

## 7. 结论与建议路径

**可行, 且成本主要在内容裁剪而非代码。** 分三步:

1. **先定契约**: 新建 `Flashcard` 类型 (第 5 节草案), 把"一卡一点、拆解 ≤ 3 行、图 ≤ 5 节点"写进体检。
2. **搬运复用**: `StageNode/StageEdge/CodeBlock/LogLine/ConceptRow` 直接从 vivid-dsh 拷过来 (或抽成共享包); flashcard-mvp 已有 `src/components/stage/` 和 `use-stage-player.ts`, stage 渲染器改造成本低。
3. **terminal 用回放式假终端**: 先做逐行回放 + `cat|sed` 展示源码的仪式感, 等真有需求再评估 WebContainers。

内容来源也有天然路径: 20 节课每节能切出 3~5 张卡——

| Lesson 字段 | → 卡片 |
|---|---|
| `oneLiner` | 问题 (front.question) |
| `concepts` | 概念卡 / 拆解 (back.breakdown) |
| `stage` | 关系卡 (back.diagram) |
| `misconceptions` | 辨析卡 |
| `steps[i].code` | 代码卡 (terminal.code) |

第一版 deck 可以直接从现有 Lesson 数据半自动生成。
