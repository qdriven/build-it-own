# build-it-own scripts

`build-it-own` 仓库的自动化运维脚本集合，基于 **Bun + TypeScript 7 beta**，零运行时依赖，通过 GitHub GraphQL API 操作 Projects (V2)。

## 环境要求

- [Bun](https://bun.sh) >= 1.4
- [gh CLI](https://cli.github.com) 已登录（token 需含 `project` scope）：

  ```bash
  gh auth login
  gh auth refresh -h github.com -s project
  ```

- Token 优先取环境变量 `GITHUB_TOKEN` / `GH_TOKEN`，未设置时自动回退执行 `gh auth token`

## 安装与构建

```bash
bun install        # 安装 devDependencies（typescript 7.1.0-beta + bun-types）
bun run typecheck  # tsc --noEmit 类型检查
bun run build      # 构建到 dist/（clean-projects.js、import-repos.js）
```

## clean-projects — 清理 Projects

删除指定 owner（默认当前账号）名下**所有** Projects (V2)，含 open 与 closed。默认 **dry-run 只预览**，加 `--confirm` 才真正删除（不可逆）。

```bash
bun run clean:projects                          # 预览当前账号所有 Project
bun run clean:projects:force                    # 删除当前账号所有 Project
bun dist/clean-projects.js --owner fluent-qa --confirm   # 删除组织所有 Project
bun dist/clean-projects.js --confirm --keep 8   # 删除其余，保留 #8
```

| 参数 | 说明 |
| ---- | ---- |
| `--confirm`, `-y` | 实际执行删除（默认 dry-run） |
| `--owner`, `-o <login>` | 目标用户或组织登录名，默认当前账号 |
| `--keep`, `-k <num,num>` | 跳过指定编号的 Project，可多次传 |
| `--help`, `-h` | 帮助 |

## import-repos — 导入仓库到 Project

把一批仓库导入（链接）到指定 Project (V2)。受 GitHub 平台限制，**只能链接与 Project 同一 owner 的仓库**；跨 owner 的仓库在加 `--draft-items` 时会自动降级为创建 Draft item 放入看板。

```bash
bun run import:repos -- -p 8 innate-feeds innate-daily                # owner/repo 均可
bun dist/import-repos.js -p 8 -o fluent-qa --repos qa-vibe,qgops     # 指定 Project owner
bun dist/import-repos.js -p 8 variableway/innate-feeds --draft-items # 跨 owner → Draft item
```

| 参数 | 说明 |
| ---- | ---- |
| `-p`, `--project <number>` | 目标 Project 编号（必填） |
| `-o`, `--owner <login>` | Project 所属用户或组织，默认当前账号 |
| `-r`, `--repos <a,b,...>` | 逗号分隔仓库列表，也可用位置参数，可叠加 |
| `--draft-items` | 每个仓库额外创建一条 Draft item |
| `-h`, `--help` | 帮助 |

幂等可重跑：已链接的仓库会标记跳过；`--draft-items` 每次都会新建条目。

## 实现备注（踩坑记录）

- Projects (V2) 链接仓库必须用 `linkProjectV2ToRepository`；`linkRepositoryToProject` 是经典版 V1 的 mutation，对 V2 的 `PVT_` id 会报 `Could not resolve to Project node`
- GraphQL 里 `user(login:)` 与 `organization(login:)` 不能放同一查询，任一解析失败会整条报错，需顺序尝试
- 查询变量声明只能有一组括号，多来源变量需合并为 `($a: T, $b: U)`
- `gh project list` 默认只列 open 项目，需加 `--closed` 才含已关闭项目；本脚本两种状态都会列出

## 技术栈

| 组件 | 版本 |
| ---- | ---- |
| Bun | >= 1.4 |
| TypeScript | 7.1.0-beta（npm `beta` tag） |
| bun-types | 1.4.3 |
