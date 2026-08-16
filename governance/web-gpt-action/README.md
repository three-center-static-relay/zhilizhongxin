# 网页 GPT Action 唯一最新版

本目录是治理中心保存网页 GPTs Action Schema 的唯一权威位置。

## 唯一可复制文件

- `LATEST.openapi.json`：当前唯一允许复制到网页 GPT「Actions / Schema」里的版本。
- `manifest.json`：记录这份 Schema 的来源、必备 operationId 和更新规则。

不要从旧聊天记录、旧分支、旧 PR、`admin/openapi.json` 或历史截图复制 Action 代码。

## 当前阶段

当前为 **Phase 2：candidate control-plane acceptance**。

除原有治理辅助、runtime、最终验证、文献生产自检和 3 个只读 Admin Action 外，新增：

- `createCandidateVersion`：只创建当前四中心生产 runtime/source digest 的不可变候选快照；只写治理元数据，不部署代码。
- `validateCandidate`：只做控制面一致性验收，包括候选 digest、四中心 health、空闲状态、runtime version 和 source digest 身份一致性。
- `getAcceptanceResult`：按 `run_id` 查询已保存的验收 receipt。

本阶段明确 **不包含** `promoteCandidate` 或 `rollbackProduction`。`validateCandidate` 返回的 PASS 只代表 `control-plane-consistency-v1`，且必须同时声明 `fresh_business_e2e=false`、`promotion_eligible=false`，不得冒充完整生产业务 E2E。

## 更新规则

1. 任何会改变 `governance-worker /openapi.json`、Action 路径、operationId、请求参数、认证声明或响应契约的修改，必须同步更新 `LATEST.openapi.json`。
2. `tests/web-gpt-action-snapshot.mjs` 会把 `LATEST.openapi.json` 与真实部署入口 `src/admin-entry.js` 动态生成的 Action Schema 做结构比对；不一致即失败，禁止把过期 Action Schema 当成最新版。
3. 本目录不保存多个“latest”或历史副本，避免误选旧代码。历史版本由 Git 提交记录负责。
4. API Token/Key 永远不写入 Schema 文件；`ADMIN_GPT_TOKEN` 只在 GPT 编辑器的认证配置和 Cloudflare Secret 中设置。
5. 线上运行时 `/openapi.json` 是动态来源；`LATEST.openapi.json` 是治理中心保留的可复制、可恢复、可审计快照。两者必须保持一致。

## 网页 GPT 配置基线

- Schema：复制 `LATEST.openapi.json` 全文。
- Authentication：API Key。
- Auth Type：Bearer。
- Secret：使用当前 `ADMIN_GPT_TOKEN`，不得提交到 GitHub。
- 生产服务：`governance-worker`。

## 设计目标

`LATEST.openapi.json` 始终满足：单一权威、可直接复制、无密钥、可回滚、可审计、与生产入口自动防漂移。
