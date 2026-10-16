# 缘分实验室：本地全服务端到端验证

验证日期：2026-10-12（北京时间）。当前工程 package 版本为 1.0.0，验证包含已实施的 V1.2 地铁式档案和 V1.3 电子邀请函，没有回退代码版本。

## 结论

本地统一 Web 服务及 PostgreSQL 可用，主要端到端链路通过。11 组现有验证中，10 组成功；live 组为 5 条通过、1 条失败。失败定位到旧用例的登录按钮文字与当前界面不一致，因此本轮不能标记为“全部用例通过”。此外，主 UAT 尚未配置线下相遇点，微信小程序真机与真实微信登录仍待验证。

本轮没有修改产品代码或测试代码。主 UAT 仅做登录、读取和页面导航；业务写入、并发、失败恢复和发布使用隔离测试数据库。验证前后主 UAT 的 3 条报名记录逐行散列一致。

## 运行环境

| 项目 | 当前状态 |
| --- | --- |
| 统一服务 | http://192.168.43.70:3216，活动 meet |
| 健康与数据库就绪 | /api/health/live、/api/health/ready 均 HTTP 200 |
| 构建 | y924VOMndHk5x5TOC15K1；.next-registration-pass-v13 |
| 数据库 | destiny_lan_uat_20261011；容器 destinylab-live-20261010；本机回环端口 55464 |
| 主 UAT 功能 | 报名、互动、大屏、卡牌墙、运营、同舟机构、照片统一服务开启 |
| 小程序功能 | 主 UAT 开关关闭；隔离环境完成服务端接口验证 |
| 测试服务清理 | 本轮启动的 3212、3217、3215、3241 已停止；3216 主 UAT 保持运行 |

手机连接与 Mac 相同的局域网后访问以下地址。Mac 需保持运行；更换网络导致 IP 改变时需要更新链接及二维码。本轮未进行实体手机网络连通性验收。

## 全部主要入口

| 入口 | 地址 |
| --- | --- |
| 手机报名 / 恢复已有凭证 | [打开报名](http://192.168.43.70:3216/mobile/register?activity=meet) |
| 电子遇见邀请函 | [打开邀请函](http://192.168.43.70:3216/mobile/register?activity=meet&view=success) |
| 第四站：已保存档案 | [打开档案](http://192.168.43.70:3216/mobile/register?activity=meet&view=details&step=preview) |
| 手机互动主流程 | [开始互动](http://192.168.43.70:3216/mobile/01-start?activity=meet) |
| 同舟专业服务填报 | [填写服务资料](http://192.168.43.70:3216/mobile/tongzhou?activity=meet) |
| 遇见卡牌墙参与设置 | [打开设置](http://192.168.43.70:3216/mobile/member-wall-consent?activity=meet) |
| 主大屏 | [打开大屏](http://192.168.43.70:3216/screen?activity=meet) |
| 大屏：在场 | [打开](http://192.168.43.70:3216/screen/presence?activity=meet) |
| 大屏：问题 | [打开](http://192.168.43.70:3216/screen/question?activity=meet) |
| 大屏：双向回应 | [打开](http://192.168.43.70:3216/screen/mutual?activity=meet) |
| 大屏：线下相遇 | [打开](http://192.168.43.70:3216/screen/real-meet?activity=meet) |
| 遇见卡牌墙 | [打开卡牌墙](http://192.168.43.70:3216/display/member-wall?activity=meet) |
| 运营看板 / 相遇点配置 | [打开运营后台](http://192.168.43.70:3216/admin/dashboard?activity=meet) |
| 报名管理 / 签到 | [打开报名管理](http://192.168.43.70:3216/admin/registrations?activity=meet) |
| 参与者管理 | [打开](http://192.168.43.70:3216/admin/participants?activity=meet) |
| 相遇管理 | [打开](http://192.168.43.70:3216/admin/encounters?activity=meet) |
| 机构管理 | [打开](http://192.168.43.70:3216/admin/partners?activity=meet) |
| 卡牌墙管理 | [打开](http://192.168.43.70:3216/admin/member-wall?activity=meet) |
| 同舟机构后台 | [打开同舟后台](http://192.168.43.70:3216/agency/tongzhou?activity=meet) |

邀请函和档案需在拥有报名会话的原浏览器打开；新浏览器需先报名。个人宣传页由机构后台发布后生成唯一链接，路由为 `/tongzhou/p/<slug>`，应使用实际生成的链接。后台使用现有账号，本报告不保存密码。

报名二维码：[PNG](verification/registration/uat-registration-qr.png)。

## 实测结果

| 验证组 | 结果 | 已覆盖内容 |
| --- | --- | --- |
| 主 UAT 页面与鉴权 | 通过 | 所列页面 200；匿名访问受保护 API 为 401；运营与机构登录及授权读取 200 |
| 报名服务 registration-service | 通过 | PostgreSQL 报名生命周期、六位凭证、幂等、签到、资料修改、机构映射、照片权限 |
| 报名浏览器 registration-browser | 通过 | 报名→邀请函→四站档案→签到→互动；首次填写、返回修改、保存失败重试、重复进入、返回凭证五种场景 |
| 第四站保存语义 | 通过 | 第三站已落库；第四站只有返回凭证主按钮；重复进入零写入；服务器回读失败不误显示保存；编辑成功直返第四站 |
| 互动 live | 5 通过 / 1 失败 | 独立手机会话→选择→后台/大屏同步；100 人并发答题；邀请竞争与相遇点事务；照片裁剪、持久化、权限及首次上传流程 |
| 机构服务 agency-service | 通过 | 公开字段过滤、工作流程、并发、分页、授权变化与发布失效 |
| 机构浏览器 agency-browser | 通过 | 登录、密码显隐、列表统计、抽屉、备注、公开字段、预览、发布及唯一链接，手机与桌面页面 |
| 机构相册 agency-gallery | 通过 | 独立相册、访问范围、格式、并发、发布快照与照片删除 |
| 宣传页 agency-public-edge | 通过 | 空资料、长文本、匿名隐私边界、稳定链接与不可用状态 |
| 小程序服务 mini | 通过（接口范围） | 注入测试身份；多用户、并发答题、邀请与相遇、Web/小程序身份隔离、媒体权限 |
| 卡牌墙 wall-service | 通过 | 参与范围、公平轮播、主屏租约、重放/过期清理、男女分栏 |
| 卡牌墙 wall-window | 通过 | 10 种横屏尺寸的正反面，共 20 组无裁切检查；手机窄屏保护符合现有设计 |
| 卡牌墙 wall-linkage | 通过 | 手机真实 HTTP 提交；答案及年龄经服务端事件刷新到大屏；四答案、空答案、长昵称与无 MW 编号 |
| 服务重启持久化 | 通过（隔离环境） | 同一构建重启后身份、参与者和邀请数据保持一致 |

主 UAT 浏览器补充检查：原报名会话能恢复邀请函并进入已保存档案；主大屏与运营数据一致（参与者 1）；同舟后台可显示既有 6 条记录及统计。本轮未添加主 UAT 演示资料或发布真实用户主页。

## 未通过及待验收项

1. **旧同舟端到端用例失败。** `tests/live/private-services.spec.ts:198` 仍查找“登录机构后台”，当前 `src/features/tongzhou/TongzhouAgencyLive.tsx:279` 的按钮是“登录”；同一用例第 274 行也使用旧名称。定向诊断重跑再次停在该定位器。新版机构浏览器用例及实际 UAT 登录通过，说明不是已证实的登录功能故障，但不能将旧用例后续步骤算作通过。修订旧定位器后需完整重跑该用例。
2. **主 UAT 相遇点为 0。** 现有报名、答题、后台和大屏可验证；正式进行线下相遇全流程前，需运营配置真实相遇点。隔离测试中相遇点事务链路已通过，不代表主 UAT 已完成业务配置。
3. **真实微信尚未验收。** 本轮小程序结果仅证明服务端接口和测试身份下的业务链路；不等同于真实微信登录、小程序真机、微信内转发或相册授权通过。主 UAT 小程序开关仍关闭。
4. **实体手机待验收。** 同网手机扫码、微信内页面展示和真实相册选择需要实际设备验收；浏览器移动尺寸测试不能替代这些结果。

## 证据

- [主 UAT 路由、鉴权和计数](verification/full-uat-20261012/uat-audit.json)
- [11 组执行退出码](verification/full-uat-20261012/suites.json)
- [报名、邀请函与档案浏览器结果](verification/registration/encounter-pass-v13/browser-result.json)
- [卡牌墙实时联动](verification/full-uat-20261012/wall-linkage/integration.json)
- [卡牌墙尺寸检查](verification/full-uat-20261012/wall-window/browser.json)
- [服务重启验证](verification/full-uat-20261012/restart.json)
- [主 UAT 报名数据保持检查](verification/full-uat-20261012/data-preservation.json)
- [隔离服务清理与主 UAT 就绪](verification/full-uat-20261012/cleanup.json)

原始执行日志保存在本机受保护运行目录，可能包含测试登录信息，因此不复制进项目文档。此前的构建、静态检查结果不计为本轮重新执行结果。
