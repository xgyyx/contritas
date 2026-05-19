# @contritas/workflow

XState v5 研究流程状态机，定义完整的 6 Phase 研究管道。

## 状态机

`createResearchMachine()` 创建完整的研究状态机，支持：

- 6 个顺序 Phase（Phase 3 内部多维度并行）
- 条件转换（需要追问时暂停）
- 上下文序列化与恢复（崩溃后可从断点继续）
- 事件驱动进度通知

## Actor 列表

| Actor | Phase | 职责 |
|-------|-------|------|
| `validateInput` | 0 | 验证命题可调查性、检测边缘输入 |
| `decompose` | 1 | 拆解核心假设、分配权重 |
| `plan` | 2 | 制定搜索策略、确定复杂度等级 |
| `searchDimensions` | 3 | 多维度并行检索（调用 @contritas/search） |
| `crossValidate` | 4 | 交叉验证、矛盾检测（4 类原因） |
| `synthesizeReport` | 5 | 综合报告生成、加权评分、自检 |

## Guard 条件

状态机转换的守卫条件（如是否需要追问、证据是否充分等），定义在 `guards.ts`。

## 使用

```typescript
import { createResearchMachine } from "@contritas/workflow";
import { createActor } from "xstate";

const machine = createResearchMachine({ providers, emitter });
const actor = createActor(machine, { input: { proposition, language } });
actor.start();
```

## 开发

```bash
pnpm typecheck
pnpm test
```
