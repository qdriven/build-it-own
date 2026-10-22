#!/usr/bin/env bun
/**
 * clean-projects — 清理 GitHub 账号名下所有 Projects (V2)
 *
 * 默认 dry-run 仅预览，不删除任何内容；只有显式传 --confirm 才会执行删除（不可逆）。
 *
 * 用法:
 *   bun run src/clean-projects.ts                     # 预览当前账号的所有 Project
 *   bun run src/clean-projects.ts --confirm           # 删除当前账号的所有 Project
 *   bun run src/clean-projects.ts --owner <login>     # 指定用户或组织
 *   bun run src/clean-projects.ts --confirm -o my-org # 删除指定组织的所有 Project
 *
 * Token 来源（二选一）:
 *   1. 环境变量 GITHUB_TOKEN / GH_TOKEN（需要 project scope）
 *   2. 回退执行 `gh auth token`，复用 gh CLI 的登录态
 */

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const PAGE_SIZE = 100;

interface Project {
  id: string;
  number: number;
  title: string;
  closed: boolean;
  url: string;
}

interface Args {
  confirm: boolean;
  owner: string | undefined;
  keep: Set<number>;
  help: boolean;
}

const HELP = `clean-projects — 清理 GitHub 账号名下所有 Projects (V2)

用法:
  bun run src/clean-projects.ts [flags]

参数:
  --confirm, -y             实际执行删除（默认 dry-run 仅预览）
  --owner,  -o <login>      目标用户或组织登录名（默认当前登录账号）
  --keep,   -k <num,num...>  跳过指定编号的 Project 不删除，可多次传
  --help,   -h              显示本帮助

环境变量:
  GITHUB_TOKEN / GH_TOKEN  GitHub Token（缺省回退 gh auth token）`;

function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false, owner: undefined, keep: new Set<number>(), help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--confirm":
      case "-y":
        args.confirm = true;
        break;
      case "--owner":
      case "-o":
        args.owner = argv[++i];
        if (!args.owner) {
          throw new Error("--owner 需要一个登录名参数");
        }
        break;
      case "--keep":
      case "-k": {
        const raw = argv[++i];
        if (!raw) {
          throw new Error("--keep 需要逗号分隔的编号，例如 --keep 8 或 --keep 1,2,3");
        }
        for (const part of raw.split(",")) {
          const num = Number.parseInt(part.trim(), 10);
          if (!Number.isFinite(num) || num <= 0) {
            throw new Error(`--keep 含无效编号: ${part.trim()}`);
          }
          args.keep.add(num);
        }
        break;
      }
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
    }
  }
  return args;
}

let token = "";

function resolveToken(): string {
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (envToken) return envToken;

  try {
    const gh = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
    const ghToken = gh.stdout.toString().trim();
    if (gh.success && ghToken) return ghToken;
  } catch {
    // gh CLI 不可用，走下方的统一报错
  }

  console.error("✗ 未获取到 GitHub Token：请设置 GITHUB_TOKEN 环境变量，或先运行 `gh auth login`");
  process.exit(1);
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "build-it-own/clean-projects",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(`GraphQL 错误: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) {
    throw new Error("GitHub API 返回了空的 data");
  }
  return body.data;
}

type OwnerRoot = "viewer" | "user" | "organization";

interface OwnerPage {
  viewer?: { login: string; projectsV2: ProjectsConnection } | null;
  user?: { login: string; projectsV2: ProjectsConnection } | null;
  organization?: { login: string; projectsV2: ProjectsConnection } | null;
}

interface ProjectsConnection {
  nodes: Project[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const PROJECT_FIELDS = `
  nodes { id number title closed url }
  pageInfo { hasNextPage endCursor }
`;

/** 确定目标 owner 的类型与登录名 */
async function resolveOwner(owner: string | undefined): Promise<{ root: OwnerRoot; login: string }> {
  if (!owner) {
    const data = await gql<{ viewer: { login: string } }>(`query { viewer { login } }`);
    return { root: "viewer", login: data.viewer.login };
  }

  // 注意：user() 与 organization() 不能放在同一个查询里，
  // 任一字段解析失败都会让整条 GraphQL 请求报错，因此顺序尝试。
  try {
    const data = await gql<{ user: { login: string } | null }>(
      `query ($login: String!) { user(login: $login) { login } }`,
      { login: owner },
    );
    if (data.user) return { root: "user", login: data.user.login };
  } catch {
    // 不是用户，继续尝试组织
  }

  try {
    const data = await gql<{ organization: { login: string } | null }>(
      `query ($login: String!) { organization(login: $login) { login } }`,
      { login: owner },
    );
    if (data.organization) return { root: "organization", login: data.organization.login };
  } catch {
    // 也不是组织，走下方的统一报错
  }

  throw new Error(`找不到用户或组织: ${owner}`);
}

/** 分页拉取 owner 名下的全部 Projects (V2) */
async function listAllProjects(root: OwnerRoot, login: string): Promise<Project[]> {
  // 注意：变量声明只能有一组括号，viewer 与 user/organization 的变量要合在一起声明
  const withLogin = root !== "viewer";
  const varDecls = withLogin ? "($login: String!, $after: String)" : "($after: String)";
  const query = `query ${varDecls} {
    ${root === "viewer" ? "viewer" : `${root}(login: $login)`} {
      login
      projectsV2(first: ${PAGE_SIZE}, after: $after) { ${PROJECT_FIELDS} }
    }
  }`;

  const projects: Project[] = [];
  let cursor: string | null = null;

  for (;;) {
    const variables: Record<string, unknown> = { after: cursor };
    if (withLogin) variables.login = login;

    const data = await gql<OwnerPage>(query, variables);
    const actor = data.viewer ?? data.user ?? data.organization;
    if (!actor) throw new Error(`查询 ${login} 的 Project 失败：owner 为空`);

    projects.push(...actor.projectsV2.nodes);
    const { hasNextPage, endCursor } = actor.projectsV2.pageInfo;
    if (!hasNextPage || !endCursor) break;
    cursor = endCursor;
  }

  return projects;
}

async function deleteProject(projectId: string): Promise<void> {
  await gql(
    `mutation ($projectId: ID!) {
      deleteProjectV2(input: { projectId: $projectId }) { clientMutationId }
    }`,
    { projectId },
  );
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  token = resolveToken();
  const { root, login } = await resolveOwner(args.owner);
  const projects = await listAllProjects(root, login);

  if (projects.length === 0) {
    console.log(`✓ ${login} 名下没有可清理的 Project`);
    return;
  }

  console.log(`\n${login} 名下共 ${projects.length} 个 Project:`);
  for (const p of projects) {
    const keptMark = args.keep.has(p.number) ? "（保留）" : "";
    console.log(`  #${String(p.number).padEnd(5)} ${p.title}${p.closed ? " [closed]" : ""}${keptMark}`);
    console.log(`         ${p.url}`);
  }

  const targets = projects.filter((p) => !args.keep.has(p.number));

  if (targets.length === 0) {
    console.log(`\n✓ 没有需要删除的 Project（全部被 --keep 排除）`);
    return;
  }

  if (!args.confirm) {
    console.log(
      `\n△ dry-run 预览模式，未删除任何内容。将删除 ${targets.length} 个（排除 ${projects.length - targets.length} 个）。确认无误后追加 --confirm 执行删除。`,
    );
    return;
  }

  console.log(`\n开始删除 ${targets.length} 个 Project（保留 ${projects.length - targets.length} 个）...`);
  let ok = 0;
  let failed = 0;

  for (const p of targets) {
    try {
      await deleteProject(p.id);
      ok++;
      console.log(`  ✓ 已删除 #${p.number} ${p.title}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ 删除失败 #${p.number} ${p.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n完成：成功删除 ${ok} 个，失败 ${failed} 个`);
  if (failed > 0) process.exit(1);
}

await main();

export {};
