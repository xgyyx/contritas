# @contritas/shared

Contritas 项目的共享基础包，提供所有其他 package 和 app 依赖的类型定义、Zod schema、常量和工具函数。

## 导出

| 模块 | 说明 |
|------|------|
| `types/` | 全部领域类型（Session、Assumption、Dimension、Evidence、Report 等）、API 请求/响应类型、SSE 事件类型 |
| `constants` | Phase ID、状态枚举、可信度等级、评分档位等常量 |
| `utils/validation` | Zod schema 校验工具（`createResearchSchema`、`iterateSchema` 等） |
| `utils/id` | ULID 生成器（`generateId()`） |

## 使用

```typescript
import { generateId, SessionStatus, type Evidence } from "@contritas/shared";
```

## 开发

```bash
pnpm typecheck   # 类型检查
pnpm test        # 运行测试
```
