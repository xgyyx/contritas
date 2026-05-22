# Blog

对外宣传与技术科普文章，可直接发公众号、知乎、Dev.to 等渠道。

与 `docs/architecture/` 的区别：
- `docs/architecture/` — 工程内部参考文档，面向开发者，强调准确与查得到
- `docs/blog/` — 面向潜在用户与同行，强调"为什么"和"怎么想到的"

## 文章列表

| 序号 | 标题 | 主题 |
|------|------|------|
| 01 | [我做了一个会跟你唱反调的 AI 尽调 Agent](./01-architecture-and-stack.md) | 技术架构与选型背后的思考 |
| 02 | [怎么让 LLM 跟你唱反调——Contritas 是怎么把"反驳"写进 Prompt 的](./02-anti-flattery-prompt-design.md) | 反讨好式 Prompt 工程：四道防线把"反驳"焊死在系统里 |
| 03 | [Phase 4 交叉验证：让 LLM 找证据矛盾，而不是顺着事实线挑顺耳的写](./03-phase4-cross-validation.md) | 五道关把"看看证据"变成结构化工程问题 |
| 04 | [如果你能用 Claude Code，为什么还要 Contritas？](./04-vs-general-agent.md) | 诚实对比通用 Agent：差距在哪、长期护城河怎么立 |
| 05 | [搜索降级链与"接受部分缺失"的工程纪律](./05-search-fallback-and-evidence-discipline.md) | 两层降级 + 缓存边界，"证据不足"是合法尽调结果 |
| 06 | [报告自检（Phase 5 self-check）—— 让 LLM 给自己挑刺](./06-phase5-self-check.md) | 四道纯代码硬约束 + 回退状态机，能用规则查的不让 LLM 评 |
| 07 | [为什么 Contritas 不做"实时浏览/深思考演示"？](./07-no-thinking-stream.md) | 反 Devin/Manus 演示流：审计口径 vs 表演口径的产品哲学 |

## 待写选题

后续选题、排期与素材准备情况见 [`backlog.md`](./backlog.md)。

## 写作约定

- 文件名：`NN-kebab-case-title.md`，序号方便排序
- 风格：公众号 / 技术博客口吻，可有"我"、可有故事，但技术细节须准确
- 引用：涉及代码 / 文档时，优先链接到仓库内文件而非外部
