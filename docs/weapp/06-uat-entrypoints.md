# UAT 全部入口清单

核对日期：2026-10-16。本地 UAT 使用卡牌墙后台 UX 业务版本 `a4d4a38`（交付基线 `5bda10a`），迁移为 **015**，原数据库和账号保持不变。此前验收地址为 http://192.168.43.70:3216，活动为 `meet`。正式发布复核时Mac已换到192.168.130.201，旧地址不可达；服务仍在运行且回环就绪检查通过。下表保留验收时的地址与结果，使用新网络前需同步运行时origin并复验，勿将旧链接发给手机用户。

最新卡牌墙迭代已验证13个主要入口、登录页及模拟预览；下表其余子路由的HTTP结果沿用10月15日27入口核验，不表示全部页面已于今天重做端到端验收。交互测试使用隔离库和合成活动，没有清理原 meet 活动。发布交接见 [v1.4.0](../releases/v1.4.0.md)。

## 优先使用的三个入口

| 入口 | 用途 | 当前地址 |
| --- | --- | --- |
| 报名入口 | 填写报名资料、六位凭证、邀请函、四站档案及照片 | [手机报名](http://192.168.43.70:3216/mobile/register?activity=meet) |
| 活动遇见入口 | 现场答题、匹配、邀请及见面流程 | [活动遇见](http://192.168.43.70:3216/mobile/01-start?activity=meet) |
| 同舟机构后台 | 统一档案、来源标识、跟进备注、签约/服务、相册及宣传页 | [同舟后台](http://192.168.43.70:3216/agency/tongzhou?activity=meet) |

后台沿用现有服务端账号；不在 GitHub 文档中放账号密码。报名/活动分别授权同舟服务后才纳入机构档案。同一人通过服务端报名—参与者关联管理为一份档案，列表标注两个来源；未关联身份不按电话自动合并。H5验证关联可在同一浏览器从报名凭证主动进入活动，无需先签到；原生小程序按同一已验证微信身份关联。独立现场入口无需报名。

## GitHub 与部署范围

- 正式源码交付分支：[`codex/cloud-uat`](https://github.com/LYONG1982/destinylab-mvp/tree/codex/cloud-uat)，固定版本见 [v1.4.0 Release](https://github.com/LYONG1982/destinylab-mvp/releases/tag/v1.4.0)，合并记录见 [PR #1](https://github.com/LYONG1982/destinylab-mvp/pull/1)。
- 本地 UAT 已包含活动管理、现场维护、LAN兼容修复和卡牌墙后台UX；数据库015，本轮无新增迁移。
- [rc.1预发布包](https://github.com/LYONG1982/destinylab-mvp/releases/tag/weapp-v1.4.0-rc.1) 是历史镜像，仅到013。本版发布源码，部署须按v1.4.0标签重建统一应用及迁移镜像。
- GitHub托管源码，没有替代运行后端。本次不部署公网，亦不代表微信体验版或真机验收完成。

## 手机用户端（H5）

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 独立报名 | [独立报名](http://192.168.43.70:3216/mobile/register?activity=meet) | 200 |
| 开始遇见 | [开始遇见](http://192.168.43.70:3216/mobile/01-start?activity=meet) | 200 |
| 首题结果 | [首题结果](http://192.168.43.70:3216/mobile/02-result?activity=meet) | 200 |
| 互动资料 | [互动资料](http://192.168.43.70:3216/mobile/03-profile?activity=meet) | 200 |
| 互动答题 | [互动答题](http://192.168.43.70:3216/mobile/04-question?activity=meet) | 200 |
| 发现同频的人 | [发现同频的人](http://192.168.43.70:3216/mobile/05-discover?activity=meet) | 200 |
| 共同答案详情 | [共同答案详情](http://192.168.43.70:3216/mobile/06-common?activity=meet) | 200 |
| 相遇邀请 | [相遇邀请](http://192.168.43.70:3216/mobile/07-invitation?activity=meet) | 200 |
| 双向确认 | [双向确认](http://192.168.43.70:3216/mobile/08-mutual?activity=meet) | 200 |
| 现场见面 | [现场见面](http://192.168.43.70:3216/mobile/09-meet?activity=meet) | 200 |
| 下一站 | [下一站](http://192.168.43.70:3216/mobile/10-next-step?activity=meet) | 200 |
| 同舟专业服务 | [同舟专业服务](http://192.168.43.70:3216/mobile/tongzhou?activity=meet) | 200 |
| 我的遇见卡牌/展示许可 | [我的遇见卡牌/展示许可](http://192.168.43.70:3216/mobile/member-wall-consent?activity=meet) | 200 |

## 运营后台

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 报名管理与签到 | [报名管理与签到](http://192.168.43.70:3216/admin/registrations?activity=meet) | 200 |
| 活动管理、二维码与现场清零 | [活动管理](http://192.168.43.70:3216/admin/activities?activity=meet) | 200 |
| 现场总览 | [现场总览](http://192.168.43.70:3216/admin/dashboard?activity=meet) | 200 |
| 邀请相遇 | [邀请相遇](http://192.168.43.70:3216/admin/encounters?activity=meet) | 200 |
| 现场参与者及批量操作 | [现场参与者](http://192.168.43.70:3216/admin/participants?activity=meet) | 200 |
| 相遇伙伴 | [相遇伙伴](http://192.168.43.70:3216/admin/partners?activity=meet) | 200 |
| 遇见卡牌墙配置 | [遇见卡牌墙配置](http://192.168.43.70:3216/admin/member-wall?activity=meet) | 200 |

## 同舟机构后台

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 机构登录/会员管理 | [机构登录/会员管理](http://192.168.43.70:3216/agency/tongzhou?activity=meet) | 200 |

## 现场大屏

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 主大屏 | [主大屏](http://192.168.43.70:3216/screen?activity=meet) | 200 |
| 卡牌墙 | [卡牌墙](http://192.168.43.70:3216/display/member-wall?activity=meet) | 200 |
| 题目展示 | [题目展示](http://192.168.43.70:3216/screen/question?activity=meet) | 200 |
| 在场展示 | [在场展示](http://192.168.43.70:3216/screen/presence?activity=meet) | 200 |
| 双向相遇展示 | [双向相遇展示](http://192.168.43.70:3216/screen/mutual?activity=meet) | 200 |
| 真实见面展示 | [真实见面展示](http://192.168.43.70:3216/screen/real-meet?activity=meet) | 200 |

## 辅助/演示页面（非真实报名入口）

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 根入口 | [根入口](http://192.168.43.70:3216/?activity=meet) | 200 |
| 演示导航 | [演示导航](http://192.168.43.70:3216/demo?activity=meet) | 200 |
| 大屏演示 | [大屏演示](http://192.168.43.70:3216/screen/demo?activity=meet) | 200 |
| 卡牌布局预览 | [卡牌布局预览](http://192.168.43.70:3216/display/member-wall/preview?activity=meet) | 200 |

## 健康检查

| 入口 | 地址 | 当前HTTP |
| --- | --- | --- |
| 应用存活 | [应用存活](http://192.168.43.70:3216/api/health/live?activity=meet) | 200 |
| 服务就绪 | [服务就绪](http://192.168.43.70:3216/api/health/ready?activity=meet) | 200 |

## 个人专属主页

路由格式 `/tongzhou/p/<slug>`，由机构后台实际发布后生成。必须使用对应会员发布返回的链接；不虚构slug，也不在入口清单收集私人会员链接。

## 微信小程序

- 导入目录：仓库中的 `miniapp/`（当前交付目录为 `DestinyLab-weapp-delivery`）。
- 原生双入口：`pages/registration/index`（报名）、`pages/encounter/index`（现场互动）；`pages/index/index` 为兼容入口，`pages/privacy/index` 为隐私说明。活动参数 `activity=meet`。
- 构建目录：`miniapp/dist`（导入前按对应环境重建，不能把历史产物当作已更新版本）。
- 当前项目配置仍为`touristappid`；未交付可用的体验版小程序码或小程序分享链接。
- 代码及增量迁移已按确认计划完成；开发者工具导入/微信真实登录/真机预览另列验收。不能用上述H5链接代替微信小程序码。

## 验收说明

报名先从独立报名入口开始；互动中间页依赖本人参与状态，不宜跳页作为业务验证。运营与机构使用已有账号。二维码应基于当前主机地址和活动参数生成；旧截图中的二维码可能失效。详细报名测试步骤见 [报名验收](../REGISTRATION_UAT.md)。

实际微信账号、合法域名及体验版配置到位后，另行补充真实小程序码和真机验收；当前保留 H5 入口用于本地兼容验证。
