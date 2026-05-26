# 让 Agent "等用户说话"——长任务里的 clarification / iterate 异步交互

> 本系列前几篇：
> 1. [《我做了一个会跟你唱反调的 AI 尽调 Agent——聊聊 Contritas 的架构与选型》](./01-architecture-and-stack.md)
> 2. [《怎么让 LLM 跟你唱反调》](./02-anti-flattery-prompt-design.md)
> 3. [《Phase 4 交叉验证：让 LLM 找证据矛盾》](./03-phase4-cross-validation.md)
> 4. [《如果你能用 Claude Code，为什么还要 Contritas？》](./04-vs-general-agent.md)
> 5. [《搜索降级链与"接受部分缺失"的工程纪律》](./05-search-fallback-and-evidence-discipline.md)
> 6. [《报告自检（Phase 5 self-check）》](./06-phase5-self-check.md)
> 7. [《为什么 Contritas 不做"实时浏览/深思考演示"？》](./07-no-thinking-stream.md)
> 8. [《多 Agent 是糖，状态机是骨》](./08-single-agent-vs-multi-agent.md)

---

## 一、对话式 Agent 不会教你的那种交互

绝大多数 AI 教程默认的交互范式只有一种：

> 用户输入 → Agent 输出 → 用户输入 → Agent 输出 → ……

ChatGPT 是这样，Cursor 是这样，几乎所有 demo 都是这样。每一轮都是**毫秒级、同步、阻塞用户**的——你打字，Agent 回，你继续打字。

但跑过长任务的人会发现一个尴尬：当一个任务要执行 10 分钟到 1 小时，**Agent 跑到第 3 分钟突然需要追问用户一个问题**，这个交互模式就崩了。

> 用户：帮我尽调一下 A 公司
>
> Agent：（开始拆假设、规划、搜索……跑到第 3 分钟）
>
> Agent：等等，你是想看它的财务健康度、还是 GTM 能力、还是技术壁垒？这三个方向证据完全不重合，我得先问你一下。
>
> 用户：……

这时候 Agent 应该做什么？

- **方案 A**：自己猜一个方向继续跑——错的概率 2/3，用户拿到一份方向错位的报告。
- **方案 B**：直接报错 "请提供更明确的问题"——浪费前 3 分钟的搜索结果，用户再来一次。
- **方案 C**：**停在那里，等用户回答，然后从停的地方继续**。

Contritas 选了 C。这篇讲清楚 C 在工程上到底意味着什么——以及它的"双胞胎"形态 iterate（用户看到报告后要求"再深挖一下 X 维度"）又是怎么实现的。

剧透：两者看起来都是"用户中途介入 Agent"，但底层机制**完全不同**——一个是真·暂停-恢复，一个是 fork 新任务。把这两件事区分清楚，是这套交互能跑起来的关键。

---

## 二、为什么这不是"加个 API"那么简单

我猜很多人第一反应是："不就再加个 `POST /respond` 接口吗，前端 dialog 弹出来用户填，提交后 Agent 继续。"

听起来确实简单。但落到 Contritas 的栈上——Hono HTTP + BullMQ Worker + XState 状态机 + Redis + Postgres——这个"继续"两个字至少要回答 5 个问题：

1. **Agent 跑在哪里？** 在 BullMQ Worker 进程里。HTTP 接口 `/respond` 跑在 API 进程里。**两个进程**，怎么把用户回复从 API 进程送到 Worker 进程？
2. **Agent 怎么"等"？** Worker 进程不能傻等——BullMQ 有 30 分钟的 stalled-job 检测，超时会把 job 当死掉重投，整个流程从头来。
3. **XState 怎么暂停？** 状态机是个推进式的东西，每个状态要么 invoke 一个 actor，要么 always 转移。"等待外部信号"在 XState 里要明确建模。
4. **API 接口怎么知道当前能不能接受回复？** 如果 Agent 没在等待，用户提交的回复应该被拒。
5. **前端怎么知道现在弹 dialog？** 报告还没出完，Agent 突然要追问——前端必须能切到"等待输入"形态，提交后又切回"继续跑"形态。

把这五个问题拆开看，会发现它本质上是一个**跨进程、跨技术栈的状态机问题**：API 层、Worker 层、XState、Redis、DB、前端 store——六个地方都要有"awaiting_input"这个状态的共识。

---

## 三、机制：让 BullMQ Job 活着不动，靠 Redis Pub/Sub 唤醒

先说结论，再讲为什么这么选。

**核心做法**：当 XState 进入 `awaitingClarification` 状态，BullMQ job **不结束**，在代码里 `await` 一个 Promise——这个 Promise 由 Redis Pub/Sub 的消息（或 30 分钟超时）来 resolve。Job 进程同时每 15 秒主动 `extendLock`，告诉 BullMQ "我还活着"。

整条链路如下：

```
前端 ClarificationDialog.handleSubmit()
  → POST /api/research/:id/respond
    → [409 守卫] session.status !== "awaiting_input" → 拒绝
    → redis.publish(`research:${sessionId}:response`, response)

[同时，BullMQ Worker 进程内]
XState actor → "awaitingClarification" 状态
  → handleAwaitingClarification() [await Promise，每 15s extendLock]
    → subscriber.on("message") 接收 publish 的信号
      → updateSessionStatus("in_progress")
      → controller.sendUserResponse(response)
        → actor.send({ type: "USER_RESPONSE", response })
          → XState 转移到 "inputValidation"，工作流继续
```

为什么这么选？因为另外几个看起来"更标准"的方案，落到长任务 Agent 上都有致命问题：

### 方案 X：序列化 XState snapshot 到 DB，结束 job，新 job 从 snapshot 恢复

听起来很优雅，"持久化状态机"嘛。但 XState 的 context 里塞着 LLM provider 实例、search deps 闭包、subscribe 回调——这些都**不可序列化**。要做这件事，得先把整个 workflow context 拆成"可持久化数据 + 运行时依赖"两部分，重构成本巨大。

而且 BullMQ job 重启意味着所有内存状态丢失：搜索缓存、in-flight 的 retry 计数、actor 内部的中间结果。**为了节省一个挂起的进程内存，付出的代价是把整套流程都改造一遍**。

### 方案 Y：用 BullMQ delayed job，把"恢复"做成新 job

每次进入等待，就把当前 phase + 中间数据扔进一个 delayed job，job 结束。`/respond` 接口把回复写 DB，然后立即 `add` 一个新 job 接着跑。

问题同上：中间数据怎么定义？XState 的 context 有十几个字段，每个 phase 还会向里塞东西。要把它做成"job 之间的传值参数"，等于把状态机的内部状态全外露——而且每次新加一个 phase 都要改 job 的 payload schema。

### 方案 Z：HTTP 长轮询 / WebSocket，用户回复直接走 HTTP

让 `/respond` 接口直接 await Worker 进程里的某个 Promise——但 API 进程和 Worker 进程是分开的，根本拿不到同一个 Promise 引用。要么塞进共享内存（违背微服务原则），要么走 Redis ——绕了一圈回到 Pub/Sub。

### 方案 C（最终）：Job 阻塞 + Pub/Sub 唤醒 + extendLock 保活

代价：**Worker 进程内存里挂着一个等待的协程**，最多挂 30 分钟。

收益：

- XState 不需要做任何序列化改造，状态机内部状态原封不动
- API 层和 Worker 层之间只通过 Redis 解耦，进程边界清晰
- 唯一的"工程债"是 lock 续租，写 30 行代码搞定

这就是为什么 Contritas 选了看起来"最笨"的方案——它的复杂度都集中在一个函数里，其他层不动。

---

## 四、关键代码：`handleAwaitingClarification`

把核心函数贴出来（[`apps/api/src/jobs/research.job.ts:144-224`](../../apps/api/src/jobs/research.job.ts)）：

```ts
export async function handleAwaitingClarification(
  sessionId: string,
  controller: ReturnType<typeof createWorkflowController>,
  job: Job,
  log: Logger
): Promise<void> {
  const token = job.token;
  if (!token) {
    throw new Error(`[Worker] Missing job token for session ${sessionId}`);
  }

  // 1. 更新 DB 状态 → "awaiting_input"，API 层 409 守卫依赖此字段
  await sessionService.updateSessionStatus(sessionId, "awaiting_input");

  const subscriber = createRedisConnection();
  const channel = `research:${sessionId}:response`;

  let timeout: NodeJS.Timeout | undefined;
  let lockExtender: NodeJS.Timeout | undefined;
  let settled = false;

  try {
    const outcome = await new Promise<Outcome>((resolve, reject) => {
      const settle = (cb: () => void) => {
        if (settled) return; // 只允许第一个信号生效
        settled = true;
        cb();
      };

      // 30 分钟超时：取消整个 session
      timeout = setTimeout(() => {
        settle(() => resolve({ kind: "timeout" }));
      }, CLARIFICATION_TIMEOUT_MS);

      // Redis Pub/Sub：等待用户回复
      subscriber.on("message", (_ch, message) => {
        settle(() => resolve({ kind: "response", message }));
      });
      subscriber.subscribe(channel).catch((err) => {
        settle(() => reject(err));
      });

      // 关键：每 15s 主动续租 BullMQ job lock
      lockExtender = setInterval(() => {
        job.extendLock(token, LOCK_EXTEND_DURATION_MS).catch((err) => {
          settle(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
      }, LOCK_EXTEND_INTERVAL_MS);
    });

    if (outcome.kind === "timeout") {
      controller.cancel();
      throw new Error(`Clarification timeout for session ${sessionId}`);
    }

    // 恢复：更新 DB 状态，把回复发给 XState
    await sessionService.updateSessionStatus(sessionId, "in_progress");
    controller.sendUserResponse(outcome.message);
  } finally {
    // 无论成功/超时/异常，都释放 timer 和 Redis 连接
    if (timeout) clearTimeout(timeout);
    if (lockExtender) clearInterval(lockExtender);
    try { await subscriber.unsubscribe(channel); } catch { /* ignore */ }
    try { await subscriber.quit(); } catch { subscriber.disconnect(); }
  }
}
```

这函数写起来不长，但里面藏着四个**踩过坑才知道**的细节，每一个都让我们前后改了不止一次：

### 4.1 `settled` 防止重复 resolve

Promise resolve 多次是个静默错误——TypeScript 不会警告，运行时也不报错，只是后面的 resolve 全被丢弃。但如果你在第一次 resolve 后还有副作用（比如往 actor 发事件），就会出现"用户回复一次、状态机收到两次"的奇怪行为。

更阴险的场景：用户回复消息**和** `extendLock` 失败**同时**发生。哪个先到？无所谓——只要保证只有第一个能生效。`settled` 标志位就是为此存在的。

### 4.2 `extendLock` 不是可选项，是强制项

BullMQ 默认的 stalled-job 检测周期是 30 秒——也就是说，如果一个 active job 30 秒内没有更新它的 lock，BullMQ 会认为它"卡住了"，把它从 active 队列移回 wait 队列，**让另一个 worker 重新执行**。

对一个等用户回复的 job 来说，这意味着：用户慢慢思考的 2 分钟里，job 已经被重新调度过好几次，每次都从头跑——而且 XState 状态已经丢了。

我们选 `LOCK_EXTEND_INTERVAL_MS = 15s`，`LOCK_EXTEND_DURATION_MS = 60s`——续租间隔小于一半的有效期，留出足够的缓冲应对网络抖动。

### 4.3 用 Redis Pub/Sub 而不是 Redis Stream

`/respond` 接口的 publish 和 Worker 里的 subscribe 用的是 **Redis Pub/Sub**（`redis.publish` / `subscriber.on("message")`），不是 Redis Stream。

为什么？Pub/Sub 是"广播式 + 一次性"的：消息发出去时没人订阅就丢失。这听起来像缺点，**但对这个场景反而是优点**——如果用户在 Agent 还没进入等待状态时就提交了回复（不可能，但假设有 bug），我们希望那个回复**直接丢失**，而不是被消费一次触发一个"幽灵恢复"。

而 SSE 进度事件走的是 Redis Stream（`XADD` + `PUBLISH`）——那是另一码事，进度事件需要持久化、支持断线重连后 replay。**两个通道用两种语义**，这是有意识的设计。

### 4.4 `finally` 不能省

Redis 连接是稀缺资源。每个 clarification 都 new 一个 subscriber，如果不 quit，连接数会随会话数线性增长，最后撞到 Redis 的 `maxclients` 上。

`unsubscribe` 之前如果 channel 还没 subscribe 成功（race condition）会抛错，所以套了 `try/catch` 吞掉——这是个小 ugly，但比连接泄漏好。

---

## 五、状态共识：六个地方都要认识 "awaiting_input"

前面铺垫过：这套机制本质上是"awaiting_input"这个状态要在六个地方达成共识。看看每个地方分别在哪：

### 5.1 DB：`research_sessions.status`

[`apps/api/src/drizzle/schema.ts:16-39`](../../apps/api/src/drizzle/schema.ts)

```ts
status: text("status").notNull(),
// 有效值: 'awaiting_input' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
```

DB 是"权威状态"。所有跨进程、跨请求的状态判断都查这里。

### 5.2 API 守卫：409 拒绝

[`apps/api/src/routes/research.ts:251-253`](../../apps/api/src/routes/research.ts)

```ts
if (session.status !== "awaiting_input") {
  return c.json({ error: "Session is not awaiting input" }, 409);
}
```

如果 Agent 没在等待，用户提交回复——拒绝。这避免了竞态：用户在前一次回复刚好被消费、Agent 正在重启 phase 的瞬间又点了一次提交。

### 5.3 XState：`awaitingClarification` 节点

[`packages/workflow/src/machine.ts:183-201`](../../packages/workflow/src/machine.ts)

```ts
awaitingClarification: {
  on: {
    USER_RESPONSE: {
      target: "inputValidation",
      actions: assign({
        clarificationHistory: ({ context, event }) => [
          ...context.clarificationHistory,
          {
            questions: [],
            userResponse: event.response,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    },
    CANCEL: { target: "cancelled" },
  },
},
```

这是一个**纯等待状态**——没有 `invoke`，没有 `entry` action，没有 `always`。它就是个静态节点，只响应两个事件。所有"等"的逻辑都不在状态机里，而在 job 层。

这种分工很重要：**XState 描述"状态间的合法转换"，不描述"等待的实现细节"**。把超时、续租、Pub/Sub 这些工程细节塞进状态机，状态机就不再是个清爽的业务模型了。

### 5.4 Worker：边沿检测进入等待

[`apps/api/src/jobs/research.job.ts:114-133`](../../apps/api/src/jobs/research.job.ts)

```ts
actor.subscribe((snapshot) => {
  const state = snapshot.value;
  // 边沿检测：只在第一次进入 awaitingClarification 时触发
  if (state === "awaitingClarification" && prevState !== "awaitingClarification") {
    if (!clarificationInFlight) {
      clarificationInFlight = handleAwaitingClarification(sessionId, controller, job, log)
        .catch((err) => { /* ... */ })
        .finally(() => { clarificationInFlight = null; });
    }
  }
  prevState = state;
});
```

`prevState !== "awaitingClarification"` 是**边沿触发**（edge trigger）——只在"从其他状态进入等待"时启动一次。XState 的 `subscribe` 在每次 context 变化时都会触发，如果不做边沿检测，就会创建一堆并行的 subscriber 监听 Pub/Sub，第一个消息进来会触发多次 `sendUserResponse`。

`clarificationInFlight` 是双保险，连续进入等待时也只会有一个 in-flight handler。

### 5.5 SSE：`clarification` 事件类型

[`packages/shared/src/types/events.ts:64-69`](../../packages/shared/src/types/events.ts)

```ts
export interface ClarificationEvent {
  type: "clarification";
  questions: string[];
  suggestedDirections?: string[];
  timestamp: string;
}
```

XState 在转入 `awaitingClarification` 时，通过 `emitEvent` 把 ClarificationEvent 写进 Redis Stream，SSE 通道把它推给前端。

### 5.6 前端 Store

[`apps/web/src/stores/research-store.ts:210-216`](../../apps/web/src/stores/research-store.ts)

```ts
case "clarification": {
  set({
    status: "awaiting_input",
    clarificationQuestions: event.questions,
    suggestedDirections: event.suggestedDirections ?? [],
  });
  break;
}
```

Store 切到 `awaiting_input`，UI 层的 `ClarificationDialog` 看到 `clarificationQuestions.length > 0` 就弹出来，并且**禁止 outside click 关闭**——用户必须回答。

---

## 六、iterate：看起来像 clarification，其实完全不同

讲完 clarification 再讲 iterate，因为它们看起来是"同一类用户介入"，但底层是另一回事。

**iterate** 是用户拿到报告后说："这份报告还行，但我想让你**针对 X 维度再深挖**"或者"**再加一个 Y 维度**"。前端有个 IteratePanel，提交后调用 `POST /api/research/:id/iterate`。

直觉做法：在原 session 上"重启"一次 phase 3 retrieval，复用之前的搜索结果。

**Contritas 没这么做**。我们的做法是 **fork**：创建一个新的 child session，新的 BullMQ job，新的 XState 实例，DB 里用 `parentSessionId` 链回去。

[`apps/api/src/routes/research.ts:313-358`](../../apps/api/src/routes/research.ts)：

```ts
researchRouter.post("/:id/iterate", createLimiter, async (c) => {
  // iterate 要求父 session 必须是 completed
  if (session.status !== "completed") {
    return c.json({ error: "Session must be completed before iterating" }, 409);
  }

  const childSessionId = generateId();
  await sessionService.createSession({
    id: childSessionId,
    input: { /* ... */ },
    config: session.config,
    parentSessionId: id,
    ownerTokenHash: c.get("authTokenHash"),
  });

  const queue = getResearchQueue();
  await queue.add("research", {
    sessionId: childSessionId,
    parentSessionId: id,
    iterationType: parsed.data.type,       // "deep_dive" | "add_dimension"
    target: parsed.data.target,
    details: parsed.data.details,
    requestId: c.get("requestId"),
  }, { jobId: childSessionId });

  return c.json({ sessionId: childSessionId, status: "in_progress" }, 202);
});
```

为什么要 fork 而不是续跑？三个理由：

### 6.1 原报告是不可变审计产物

尽调报告一旦完成就不应该再被修改。如果 iterate 在原 session 上跑，要么报告被改写（破坏审计性），要么报告版本化（数据模型复杂度爆炸）。fork 出新 session，原报告原封不动，新 session 跑出新报告。

### 6.2 完成态的 Job 已经结束，没有 lock 可续

clarification 之所以能用"job 阻塞 + extendLock"，是因为 job 还活着。报告完成后 job 已经 `return`，BullMQ 已经把它移到 completed 队列——没有进程在内存里挂着 XState 实例了。

要"恢复"已完成的 session，必须从 DB 重建——这就是 [`createIterateContext`](../../apps/api/src/jobs/research.job.ts) 在做的事：把 assumptions / dimensions / evidence / report 从 DB 读回来，拼成一个 XState context，然后用自定义 `initialState` 启动新机器。

### 6.3 用户心智模型也支持 fork

iterate 是一个**显式动作**（点按钮、填表单、跳新页面），用户预期得到的是"一个新的研究"，不是"前一个研究改一改"。前端跳转到新 sessionId 的页面是符合直觉的——用户随时可以回头看原报告。

### clarification vs iterate 对比

| 维度 | clarification（暂停-恢复） | iterate（fork 子任务） |
|------|-------------------------|----------------------|
| 触发时机 | session 进行中，LLM 发现信息不足 | session 已 completed |
| 实现机制 | Job 保持活跃 + Pub/Sub 阻塞等待 | 创建新 child session + 新 BullMQ job |
| XState | 进入 `awaitingClarification` 等待态 | 以自定义 `initialState` 启动新机器实例 |
| 状态持久化 | 不序列化 snapshot，靠 job 进程保存 | 从 DB 重建 context |
| 超时处理 | 30 分钟后 cancel session | 无超时（新 job 独立） |
| 前端行为 | 弹出 Dialog，同一页面继续 | 跳转到新 sessionId 的页面 |

**两种"用户介入"用两套机制**——这不是过度设计，是两个机制各自服务的场景本来就不同。强行用一套，要么 clarification 被改造成"完成-fork"模式（用户等几分钟之后被弹到新页面，体验很糟），要么 iterate 被塞进"暂停-恢复"模式（破坏原报告的审计性）。

---

## 七、测试这种异步链路有多难

最后讲一下测试。这套机制涉及 Redis Pub/Sub、`setTimeout`/`setInterval`、跨进程消息——传统单元测试根本测不动。

[`apps/api/src/__tests__/research.job.test.ts`](../../apps/api/src/__tests__/research.job.test.ts) 用两个工具组合解决：

- **`ioredis-mock`**：在内存里模拟 Redis Pub/Sub，subscribe / publish 行为和真实 Redis 一致，但不需要起 Redis 进程
- **Vitest fake timers**：`vi.advanceTimersByTime(15_000)` 精确推进时间，不用真等

五个测试用例覆盖了所有关键路径：

```ts
describe("handleAwaitingClarification", () => {
  it("throws when job has no token", async () => { /* ... */ });

  it("resolves with user response and resumes workflow", async () => {
    subscriber.publish(`research:${sessionId}:response`, "用户回复");
    await handleAwaitingClarification(sessionId, controller, job, log);
    expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "awaiting_input");
    expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "in_progress");
    expect(controller.sendUserResponse).toHaveBeenCalledWith("用户回复");
  });

  it("calls extendLock with real token every 15s", async () => {
    vi.advanceTimersByTime(LOCK_EXTEND_INTERVAL_MS);
    expect(job.extendLock).toHaveBeenCalledWith(token, LOCK_EXTEND_DURATION_MS);
  });

  it("cancels and throws on clarification timeout", async () => {
    vi.advanceTimersByTime(CLARIFICATION_TIMEOUT_MS);
    await expect(promise).rejects.toThrow(`Clarification timeout`);
    expect(controller.cancel).toHaveBeenCalled();
  });

  it("propagates extendLock errors as job failure", async () => {
    job.extendLock.mockRejectedValue(new Error("lock lost"));
    vi.advanceTimersByTime(LOCK_EXTEND_INTERVAL_MS);
    await expect(promise).rejects.toThrow("lock lost");
  });
});
```

这五个测试是 Phase 6.3 / 6.7 加固时补的——之前我们手动跑过 happy path，但 lock 续租失败、超时这两个分支从来没真实验证过。第一次写完测试，发现 `settled` 标志位的边界条件有 bug——超时和 publish 同时到达时会触发两次状态更新。**异步链路的隐藏 bug 几乎都藏在并发分支里**，没有 fake timers 真的找不出来。

---

## 八、可以抄走的几个原则

把这套机制抽象出来，做长任务 Agent 异步交互时，这几个原则是普适的：

### 1. 区分"暂停-恢复"和"fork 子任务"

不要试图用一个机制覆盖两个场景。中途追问 = 暂停-恢复，事后深挖 = fork。它们的状态保存、超时语义、UI 跳转都不一样。

### 2. 状态共识要写在 DB 里

不要靠"Worker 进程内存"判断当前能不能接受用户输入——API 进程拿不到。一个 `status` 字段 + API 层 409 守卫，比任何分布式协调都简单可靠。

### 3. 异步等待要主动续租 lock

凡是用 BullMQ / SQS / 类似有 visibility timeout 机制的队列做长任务，一旦在 job 里 await 外部信号，就必须主动续租，否则会被静默重投。

### 4. 用 Pub/Sub 还是 Stream，看你要的语义

需要持久化 + replay（如进度事件）→ Stream。需要一次性触发 + 没人订阅就丢（如恢复信号）→ Pub/Sub。两个通道并存不是浪费，是有意识的语义分离。

### 5. 状态机只描述"合法转换"，不描述"等待实现"

XState 的 `awaitingClarification` 是个空节点，所有 Pub/Sub / 超时 / 续租都在 job 层。这样状态机本身仍然清爽，可以被新人读懂。

### 6. fake timers + 内存 Redis = 异步逻辑测试套件

异步代码的 bug 几乎都在并发分支里。能用 `vi.advanceTimersByTime` 精确推进时间，能用 `ioredis-mock` 模拟 Pub/Sub，复杂异步逻辑才能写出真正有覆盖度的测试。

---

## 九、下一篇预告

到这篇为止，反讨好系列 + 工程系列已经讲完了 Contritas 的核心机制。下一篇打算讲**部署**——一个带 Postgres + Redis + Worker + Web 的 Agent 栈，怎么在 Oracle Cloud ARM Always Free 上每月零成本跑起来。

（小预告：HEALTHCHECK、auto-migration、4 核 24G ARM 的内存预算分配，这些在 Vercel + Supabase 教程里学不到的东西。）
