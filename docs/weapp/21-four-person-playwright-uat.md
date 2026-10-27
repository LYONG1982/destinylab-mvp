# 四人 Playwright 联合验收

2026-10-27，本地候选 build `gIjuysg2KnarD40wl3QCa`，分支 `codex/weapp-release-20261013`。最终运行 **2/2 用例通过，退出码 0**，约 1.2 分钟。每场四名参与者各用独立 BrowserContext，均为虚构测试人物；所有参与者的资料、六题、邀请、确认认识、出发、到达和见面确认均通过真实 H5 页面操作。

## 两个场景的实际结果

| 场景 | 配对 | 男生码 | 女生码 | 合计 | 自动地点 |
|---|---|---:|---:|---:|---|
| 独立点位 | 山风 / 小满 | 191 | 329 | 520 | Meet01，合成UAT·东侧相遇区 |
| 独立点位 | 远舟 / 清禾 | 258 | 262 | 520 | Meet02，合成UAT·西侧相遇区 |
| 同点容量2 | 山风 / 小满 | 155 | 365 | 520 | Meet01，合成UAT·共用相遇区 |
| 同点容量2 | 远舟 / 清禾 | 124 | 396 | 520 | Meet01，合成UAT·共用相遇区 |

两场各有四个不同的 actor、两男两女、两条相遇任务；每场四个码均不同。同点位两对使用独立数对，交叉组合不等于520。地点名称/位置均明确为合成 UAT 配置，不代表实际场地。

## 可复核结果

- [独立点位：四人名单](http://192.168.43.70:3246/admin/participants?activity=four520-separate-c683594f42c5) / [两条任务](http://192.168.43.70:3246/admin/encounters?activity=four520-separate-c683594f42c5) / [大屏](http://192.168.43.70:3246/screen?activity=four520-separate-c683594f42c5)
- [同点容量2：四人名单](http://192.168.43.70:3246/admin/participants?activity=four520-shared-f993c0690379) / [两条任务](http://192.168.43.70:3246/admin/encounters?activity=four520-shared-f993c0690379) / [大屏](http://192.168.43.70:3246/screen?activity=four520-shared-f993c0690379)

后台沿用 `operator` 和原受保护凭据文件；报告不包含密码、Cookie或会话令牌。用户主手工活动 `meet-uat-520-v2` 保留，本次只创建唯一 `four520-*` 测试活动。

## 覆盖断言

1. 四个人真实入场、各选系统头像、愿意见面，逐个完成六题；每人在配对前看到两位异性候选。后台真实列表显示四人、性别各二。
2. 单方发送邀请时尚无相遇码；对方确认认识后才生成码。两条任务关联人物正确，四个码全局不重复，各对相加520。
3. 默认每点容量1时分配两个不同点；仅启用Meet01且容量2时两对均在Meet01。页面显示与后台配置一致的合成现场位置。
4. 四人的私有快照各只有本人任务和本人码；刷新后身份、码、点位保持。大屏投影无私有码字段及原始 actor ID。
5. 双向认识即有两对公开关系，初始实际见面次数仍0；大屏无活动入口二维码、扫码提示及独立展示授权入口。
6. 每对分别确认出发、到达、见面。计数顺序为 **0 → 0 → 1 → 1 → 2**：单方确认不增加，两人均确认只增加一次，刷新后仍2。
7. 最终直接断言大屏 DOM `data-meetings=2`、可见数字“2次相遇”和两个“已确认见面”标签，再截图。两个占用仍保留，未因见面确认就自动认定场地空闲。

## 准备与真实 UI 的边界

数据库只创建空白活动和初始点位启停配置；管理员用受保护测试凭据建立会话。随后现场位置与容量由后台表单实际保存；四名参与者及所有业务状态均由用户页面产生，没有直接注入参与者、答案或相遇状态。API快照用于交叉核对结果，不作为用户点击操作。

同点场景初始仅启用 Meet01，其余29点停用，后台把Meet01容量设置为2，避免系统优先空点的策略把第二对分配到其他地点。四个上下文同场在线，操作按步骤执行；这不是四人同一时刻提交或100人的容量测试。

首轮两用例已通过业务断言，但人工复核发现最终截图早于大屏最后一次同步，仍显示1次。保留首轮日志、截图和活动，补充最终DOM/标签等待断言后，以新活动重跑2/2通过。未发现需修改产品代码的问题；首轮截图不作为最终画面通过依据。

## 证据与复现

本机忽略目录 `docs/verification/2026-10-27-four-person/` 保存 `playwright.log`、`final-results.json`、每场脱敏结果JSON和四人/后台/大屏截图。带最终DOM断言的活动是上方两个链接；早期运行证据仍保留。原始认证 trace 不作为交付文件。

同点容量2场景的实际截图：[山风](../verification/2026-10-27-four-person/four520-shared-f993c0690379-user-1-山风.png)、[远舟](../verification/2026-10-27-four-person/four520-shared-f993c0690379-user-2-远舟.png)、[小满](../verification/2026-10-27-four-person/four520-shared-f993c0690379-user-3-小满.png)、[清禾](../verification/2026-10-27-four-person/four520-shared-f993c0690379-user-4-清禾.png)、[后台四人名单](../verification/2026-10-27-four-person/four520-shared-f993c0690379-four-participants.png)、[最终大屏2次相遇](../verification/2026-10-27-four-person/four520-shared-f993c0690379-two-confirmed-public-pairs.png)。参与者截图保留双向认识后的本人码，最终大屏图对应两对均完成见面确认之后。

测试：`tests/live/520-four-person.spec.ts`；配置：`playwright.520-four.config.ts`。使用受保护本机LAN环境运行：

```sh
node <<'NODE'
const { spawnSync } = require('node:child_process');
process.loadEnvFile('/Users/lvyong198201/.local/share/destinylab/uat-520-20261026/lan-20261027.env');
const result = spawnSync(process.execPath, [
  'node_modules/@playwright/test/cli.js', 'test',
  '--config=playwright.520-four.config.ts', '--reporter=line'
], { env: process.env, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
NODE
```

环境守卫仅允许本机 `destinylab_520_uat_test` 与 `192.168.43.70:3246`，IP变化时先核对配置。新测试ESLint、根TypeScript及差异检查通过。测试完成后关闭测试浏览器，UAT服务与测试数据保留。

本轮只新增测试/配置及验收文档，未改产品行为；没有执行小程序验证、GitHub发布或线上操作。此前长时高压写入退化与100浏览器容量未通过结论仍保留，见 [UAT总记录](12-six-question-520-uat.md)。
