# UAT 全部入口清单

核对日期：2026-10-13。当前本地 UAT 业务代码为 `d42f156`，已完成迁移 012–014，包含双入口统一同舟档案。Mac 地址为 http://192.168.43.70:3216，活动为 `meet`，手机与 Mac 须连接同一局域网且 Mac 保持运行。公网用户不能通过这些局域网链接访问。

本次重新核验下列静态入口全部 HTTP 200；上一轮部署还验证了手机报名/活动页面和同舟后台来源列、详情。HTTP 200 不代表已登录或完成业务流程，不代替实体手机验收。

## 优先使用的三个入口

| 入口 | 用途 | 当前地址 |
| --- | --- | --- |
| 报名入口 | 填写报名资料、六位凭证、邀请函、四站档案及照片 | [手机报名](http://192.168.43.70:3216/mobile/register?activity=meet) |
| 活动遇见入口 | 现场答题、匹配、邀请及见面流程 | [活动遇见](http://192.168.43.70:3216/mobile/01-start?activity=meet) |
| 同舟机构后台 | 统一档案、来源标识、跟进备注、签约/服务、相册及宣传页 | [同舟后台](http://192.168.43.70:3216/agency/tongzhou?activity=meet) |

后台沿用现有服务端账号；不在 GitHub 文档中放账号密码。报名/活动分别授权同舟服务后才纳入机构档案。同一人通过服务端报名—参与者关联管理为一份档案，列表标注两个来源；未关联身份不按电话自动合并。验证关联时，在同一浏览器完成报名，由运营人员签到后，从报名凭证进入活动。

## GitHub 与部署范围

- 最新代码：[候选分支](https://github.com/LYONG1982/destinylab-mvp/tree/codex/weapp-release-20261013)；[草稿 PR #1](https://github.com/LYONG1982/destinylab-mvp/pull/1) 尚未合并默认分支 `codex/cloud-uat`。
- 本地 UAT：已部署统一档案代码与迁移 014；具体部署过程见 [统一档案说明](13-unified-agency.md)。
- [rc.1 预发布包](https://github.com/LYONG1982/destinylab-mvp/releases/tag/weapp-v1.4.0-rc.1)：历史镜像仅包含至 013，不含统一档案优化。需从候选分支构建新版应用和迁移镜像；不能混用本地最新验证结果。
- GitHub 托管源代码和发布附件，没有替代腾讯云/本机运行后端；当前提供并验证的业务地址均为局域网 UAT 入口。

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
| 现场总览 | [现场总览](http://192.168.43.70:3216/admin/dashboard?activity=meet) | 200 |
| 邀请相遇 | [邀请相遇](http://192.168.43.70:3216/admin/encounters?activity=meet) | 200 |
| 参与用户 | [参与用户](http://192.168.43.70:3216/admin/participants?activity=meet) | 200 |
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
