# UAT 全部入口清单

核对日期：2026-10-12。当前Mac地址为 http://192.168.43.70:3216，活动为 `meet`。手机与Mac连接同一局域网。以下HTTP检查只验证路由可响应，不代替业务流程、账号权限及实体手机验收。

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

- 导入目录：`/Users/lvyong198201/Desktop/Game 2026/DestinyLab-MVP/miniapp`。
- 原生双入口：`pages/registration/index`（报名）、`pages/encounter/index`（现场互动）；`pages/index/index` 为兼容入口，`pages/privacy/index` 为隐私说明。活动参数 `activity=meet`。
- 构建目录：`miniapp/dist`（导入前按对应环境重建，不能把历史产物当作已更新版本）。
- 当前项目配置仍为`touristappid`；未交付可用的体验版小程序码或小程序分享链接。
- 代码及增量迁移已按确认计划完成；开发者工具导入/微信真实登录/真机预览另列验收。不能用上述H5链接代替微信小程序码。

## 验收说明

报名先从独立报名入口开始；互动中间页依赖本人参与状态，不宜跳页作为业务验证。运营与机构使用已有账号。报名二维码位于 `docs/verification/registration/uat-registration-qr.png`；详细报名测试步骤见 `docs/REGISTRATION_UAT.md`。

后续小程序迁移完成时，必须更新此表的真实页面路径、运行状态、实际测试结果及可用二维码；保留原H5入口用于兼容验收。
