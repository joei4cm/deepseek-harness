<!--
状态：草稿，未发布。
用途：Discussion #14326 的回复正文，供作者过目后决定是否发布。
说明：区分现有实现与需要维护者决定的公共扩展接口；未审查或验证提交的分支。
-->

# English reply (for posting to Discussion #14326)

Thanks for sharing the branch and the two-protocol example. The current code gives us a useful distinction, though I cannot speak for the maintainers on the preferred design:

- `dsh-llm-pi-ai` builds its shipped catalog from pi-ai's installed built-in providers. Its catalog lookups and provider directory are package-owned; I did not find a public registration API through which a community bundle can add a catalog provider. Your supplement would therefore extend the package's own catalog, and whether to accept that or introduce a registration API is a maintainer decision.
- A deployment can already declare a route and its models in `config.providers` through its Cordis configuration. That avoids a package patch, but leaves each deployment responsible for carrying the provider and model declarations—the repetition your proposal aims to remove.

The per-model protocol and endpoint distinction is relevant to either design. It would be useful for maintainers to review how the generated catalog is refreshed, how model metadata stays current, and how account-specific RBAC limitations are communicated. I have not reviewed or run the branch, so this is not a validation of its implementation or real-API tests.

For handover, yes: with external PRs paused and Issues disabled, a Discussion with a public branch and comparison link is the documented route for proposing the change. This post already supplies those. Acceptance and the choice of extension surface remain with the maintainers.

# 中文对照（供审阅）

感谢分享分支和双协议示例。现有代码可以区分几种做法，但我不能代表维护者决定首选设计：

- `dsh-llm-pi-ai` 的内置目录来自已安装的 pi-ai 内置 provider。目录查询和 provider 列表由该包维护；我没有找到社区 bundle 可用来添加目录 provider 的公开注册 API。因此，你的补充方案会扩展包自身的目录；接受这种方式还是新增注册 API，需要维护者决定。
- 部署方已经可以通过 Cordis 配置的 `config.providers` 声明路由和模型，无需修改包，但每个部署仍需维护 provider 和模型声明；这正是该提案希望减少的重复工作。

每个模型的协议和端点区别对两种设计都很重要。维护者还可以评估生成目录的更新方式、模型元数据的时效，以及如何说明账号级 RBAC 的限制。我尚未审查或运行该分支，因此这里不代表验证过实现或真实 API 测试。

关于交接：是的，外部 PR 暂停且 Issue 已关闭时，通过 Discussion 提供公开分支和比较链接符合项目文档所述的提议方式；当前帖子已经提供了这些信息。是否接受以及采用哪种扩展接口仍由维护者决定。
