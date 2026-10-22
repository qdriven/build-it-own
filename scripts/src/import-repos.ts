#!/usr/bin/env bun
/**
 * import-repos — 把一批仓库导入（链接）到 GitHub Project (V2)
 *
 * 默认把仓库 link 到 Project（与 UI 里 "Link repository" 相同，可重复对多个仓库执行）；
 * 加 --draft-items 可额外为每个仓库创建一条 Draft item，方便在看板里作为条目跟踪。
 *
 * 用法:
 *   bun run src/import-repos.ts -p 8 innate-feeds innate-daily build-it-own tutorials-maker
 *   bun run src/import-repos.ts -p 8 -o fluent-qa --repos qa-vibe,qgops
 *   bun run src/import-repos.ts -p 8 -r variableway/innate-feeds --draft-items
 *
 * 仓库写法: "repo"（默认当前账号为 owner）或 "owner/repo"。
 *
 * Token 来源（二选一）:
 *   1. 环境变量 GITHUB_TOKEN / GH_TOKEN（需要 project scope）
 *   2. 回退执行 `gh auth token`，复用 gh CLI 的登录态
 */

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

interface Args {
  projectNumber: number | undefined;
  owner: string | undefined;
  repos: string[];
  draftItems: boolean;
  help: boolean;
}

const HELP = `import-repos — 把仓库导入（链接）到 GitHub Project (V2)

用法:
  bun run src/import-repos.ts -p <number> [flags] <repo>...

参数:
  -p, --project <number>   目标 Project 编号（必填）
  -o, --owner <login>      Project 所属用户或组织（默认当前登录账号）
  -r, --repos <a,b,...>    逗号分隔的仓库列表（也可用位置参数传入，可叠加）
      --draft-items        额外为每个仓库创建一条 Draft item
  -h, --help               显示本帮助

仓库写法:
  repo                 owner 默认为当前登录账号
  owner/repo           显式指定 owner（用户或组织）

环境变量:
  GITHUB_TOKEN / GH_TOKEN  GitHub Token（缺省回退 gh auth token）`;

function parseArgs(argv: string[]): Args {
  const args: Args = { projectNumber: undefined, owner: undefined, repos: [], draftItems: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--project":
      case "-p": {
        const raw = argv[++i];
        const num = raw ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isFinite(num) || num <= 0) {
          throw new Error("--project 需要一个正整数编号");
        }
        args.projectNumber = num;
        break;
      }
      case "--owner":
      case "-o":
        args.owner = argv[++i];
        if (!args.owner) {
          throw new Error("--owner 需要一个登录名参数");
        }
        break;
      case "--repos":
      case "-r": {
        const raw = argv[++i];
        if (!raw) {
          throw new Error("--repos 需要逗号分隔的仓库列表");
        }
        args.repos.push(...raw.split(",").map((s) => s.trim()).filter(Boolean));
        break;
      }
      case "--draft-items":
        args.draftItems = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
        }
        args.repos.push(arg);
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
      "user-agent": "build-it-own/import-repos",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) {
    throw new Error("GitHub API 返回了空的 data");
  }
  return body.data;
}

interface ProjectRef {
  id: string;
  title: string;
  ownerLogin: string;
}

/** 定位目标 Project，返回其 node id */
async function resolveProject(number: number, owner: string | undefined): Promise<ProjectRef> {
  if (!owner) {
    const data = await gql<{
      viewer: { login: string; projectV2: { id: string; title: string } | null };
    }>(
      `query ($number: Int!) {
        viewer { login projectV2(number: $number) { id title } }
      }`,
      { number },
    );
    if (!data.viewer.projectV2) throw new Error(`当前账号名下不存在 Project #${number}`);
    return { id: data.viewer.projectV2.id, title: data.viewer.projectV2.title, ownerLogin: data.viewer.login };
  }

  // user() 与 organization() 不能同查询，顺序尝试（同 clean-projects 的经验）
  for (const root of ["user", "organization"] as const) {
    try {
      const data = await gql<{
        [k: string]: { login: string; projectV2: { id: string; title: string } | null } | null;
      }>(
        `query ($login: String!, $number: Int!) {
          ${root}(login: $login) { login projectV2(number: $number) { id title } }
        }`,
        { login: owner, number },
      );
      const actor = data[root];
      if (actor?.projectV2) {
        return { id: actor.projectV2.id, title: actor.projectV2.title, ownerLogin: actor.login };
      }
    } catch {
      // 不是该类型，继续尝试
    }
  }
  throw new Error(`在 ${owner} 名下找不到 Project #${number}`);
}

interface RepoRef {
  id: string;
  nameWithOwner: string;
}

async function resolveRepo(ref: string, defaultOwner: string): Promise<RepoRef> {
  const [owner, name] = ref.includes("/")
    ? (ref.split("/", 2) as [string, string])
    : [defaultOwner, ref];

  const data = await gql<{ repository: { id: string; nameWithOwner: string } | null }>(
    `query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { id nameWithOwner }
    }`,
    { owner, name },
  );

  if (!data.repository) {
    throw new Error(`仓库不存在或无权访问: ${owner}/${name}`);
  }
  return data.repository;
}

async function linkRepo(projectId: string, repositoryId: string): Promise<"linked" | "already"> {
  try {
    // 注意：linkRepositoryToProject 是经典版 Project (V1) 的 mutation，
    // Projects (V2) 必须用 linkProjectV2ToRepository，否则报 "Could not resolve to Project node"
    await gql(
      `mutation ($projectId: ID!, $repositoryId: ID!) {
        linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
          repository { nameWithOwner }
        }
      }`,
      { projectId, repositoryId },
    );
    return "linked";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already/i.test(msg)) return "already";
    throw err;
  }
}

async function addDraftItem(projectId: string, repo: RepoRef): Promise<void> {
  await gql(
    `mutation ($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
        projectItem { id }
      }
    }`,
    { projectId, title: repo.nameWithOwner, body: `https://github.com/${repo.nameWithOwner}` },
  );
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (!args.projectNumber) {
    throw new Error("必须用 -p/--project 指定目标 Project 编号（使用 --help 查看用法）");
  }
  if (args.repos.length === 0) {
    throw new Error("必须提供至少一个仓库（位置参数或 --repos，使用 --help 查看用法）");
  }

  token = resolveToken();
  const project = await resolveProject(args.projectNumber, args.owner);

  console.log(`\n目标 Project: ${project.title} (#${args.projectNumber}, owner: ${project.ownerLogin})`);
  console.log(`待导入仓库 ${args.repos.length} 个:${args.draftItems ? "（含 Draft item）" : ""}`);

  let ok = 0;
  let failed = 0;

  for (const ref of args.repos) {
    try {
      const repo = await resolveRepo(ref, project.ownerLogin);

      // link 结果三态：linked=新链接 / already=之前已链 / skipped=无法链接（如跨 owner）
      let linkResult: "linked" | "already" | "skipped" = "skipped";
      try {
        linkResult = await linkRepo(project.id, repo.id);
      } catch (linkErr) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        if (/same owner/i.test(msg)) {
          console.log(`  ⚠ ${repo.nameWithOwner}: GitHub 限制跨 owner 链接（Project owner=${project.ownerLogin}）`);
        } else {
          throw linkErr;
        }
      }

      if (linkResult === "linked") {
        console.log(`  ✓ 已链接 ${repo.nameWithOwner}`);
      } else if (linkResult === "already") {
        console.log(`  ○ ${repo.nameWithOwner} 之前已链接，跳过`);
      }

      if (args.draftItems) {
        await addDraftItem(project.id, repo);
        console.log(`    + Draft item「${repo.nameWithOwner}」已创建`);
      }

      if (linkResult === "skipped" && !args.draftItems) {
        failed++;
        console.error(`  ✗ ${repo.nameWithOwner} 导入失败（链接不可用且未开启 --draft-items）`);
        continue;
      }
      ok++;
    } catch (err) {
      failed++;
      console.error(`  ✗ 导入失败 ${ref}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n完成：成功 ${ok} 个，失败 ${failed} 个`);
  if (failed > 0) process.exit(1);
}

await main();

export {};
