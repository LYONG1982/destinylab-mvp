# 报名电子凭证与地铁式档案 V1.2 · 实施与 UAT 交付

> 后续更新：第四站已改为纯预览与维护，取消再次保存。当前构建和验收入口以 [第四站UAT报告](REGISTRATION_PREVIEW_UAT.md) 为准；下文保留V1.2首次实施的历史记录。

日期：2026-10-12。首次本机局域网已更新，构建 `zH84kaKB_htrpDg0hLAOK`，目录 `.next-registration-metro-final`。当前仅 H5/微信内浏览器入口，不代表公网或正式小程序发布。

## 验证入口

手机与 Mac 接入同一 Wi-Fi，Mac 保持开机：

- 手机报名/我的报名凭证：<http://192.168.43.70:3216/mobile/register?activity=meet>
- 本人遇见档案：<http://192.168.43.70:3216/mobile/register?activity=meet&view=details>（须在原报名浏览器持有有效会话）
- 运营报名管理：<http://192.168.43.70:3216/admin/registrations?activity=meet>
- 同舟机构后台：<http://192.168.43.70:3216/agency/tongzhou?activity=meet>
- 现场卡牌墙：<http://192.168.43.70:3216/display/member-wall?activity=meet>
- 报名二维码：`verification/registration/uat-registration-qr.png`。

## 审查结论与实现

实际页面原为一个组件中的成功页和三个Tab，全字段快照保存，没有服务端步骤记录。本轮沿用 `/mobile/register`、原Cookie、共享PostgreSQL、报名字段及相册存储，增量拆分档案编辑；没有新建项目、没有新增技术栈。

电子凭证仅首次提交成功展示对勾动画，后续访问为“我的报名凭证”；动态读取活动信息、本人昵称、原六位遇见码。右上角状态按钮刷新签到，失败保留上次状态并给出错误；活动重置后有效状态显示待签到。已签到继续进入原互动流程。移除成功页英文装饰和底部爱心，凭证与档案容器最大440px，保留报名首页既有视觉。

`MetroStepper` 为“生活/期待/相册/完成”四站，区分当前、已保存、未保存；选填可直接跳站。资料、相册和机构服务选择均走真实服务端。预览三张卡片，仅本人可见；编辑返回对应站，保存直接回预览，刷新保留编辑来源。首次确认“确认并保存档案”，后续“保存修改”，完成提示“档案已保存”。

`useProfileEditor` 将服务端快照/版本、文字草稿、服务选择、保存/上传状态、待确认冲突及未确认响应的请求分离；700ms防抖保存有效修改。串行写入和提交锁防止重复操作，网络结果不明复用同一幂等键；服务器409后做三方合并，不同字段更新自动保留，同字段冲突明确选择草稿或最新内容。上传/删除仅更新相册和版本，不覆盖文字草稿。

sessionStorage仅作当前报名身份下的临时文字草稿容错，活动与报名ID隔离，不保存登录令牌或照片二进制；成功同步或会话失效清理。服务端仍是事实来源。关闭浏览器、清除缓存且未同步的内容无法保证恢复；同一浏览器有效Cookie可恢复服务器保存资料，换设备仍需工作人员核验。

实际模型没有结构化择偶年龄/身高范围，本轮保留原期待描述、家庭介绍、联系时段，不凭空增加字段。保留现有同舟服务选项，不新增撤回入口、不更改机构管理员发布与大屏许可。

## API 与数据变更

- 新增 `POST /api/registration/profile?activity=…`，字段：`section`、`intent`（save/visit/confirm）、`next`、`fields`局部patch、`version`，相册/预览可附带现有机构服务选择及授权版本。
- 服务端绑定报名会话，校验活动、版本、步骤、白名单与合并后的完整资料；省略字段不清空，显式空字符串清除选填值；取消报名不能修改。沿用Origin检查、请求大小限制、幂等账本与锁顺序。
- 只有实际资料或服务选择变化才触发同舟同步及原有公开页失效；仅浏览步骤、无变化保存或确认不使已发布主页下线。
- 旧`save`及照片接口保留，读取DTO追加`profileProgress`、`profileConfirmedAt`、`effectiveStatus`，不改变原`status`数据库状态机和六码规则。
- 增量010增加`dl_registrations.profile_progress jsonb NOT NULL DEFAULT '{}'`和`profile_confirmed_at timestamptz NULL`。旧记录默认生活站并回填原资料，不自动认定档案已确认。

## 改动文件

- `src/features/registration/RegistrationApp.tsx`：电子凭证、页面恢复、原报名保存幂等重试、编辑器入口。
- `src/features/registration/MetroStepper.tsx`：四站组件。
- `src/features/registration/RegistrationProfileEditor.tsx`：分站表单、私有预览、编辑回流、相册与导航。
- `src/features/registration/useProfileEditor.ts`：草稿、保存、上传、恢复及冲突协调。
- `src/features/registration/client.ts`：可复用幂等键和HTTP状态错误。
- `src/features/registration/registration.css`：V1.2局部视觉、响应式、对比度、安全区及reduced-motion。
- `src/domain/registration-profile.ts`、`src/domain/registration.ts`：步骤、字段白名单、三方合并及DTO。
- `src/server/registration-service.ts`、`src/app/api/registration/[...path]/route.ts`：真实分站更新与有效签到状态读取。
- `database/010-registration-profile-progress.sql`、`scripts/migrate-registration-profile.ts`、`scripts/live-init.ts`、`src/app/api/health/ready/route.ts`：兼容迁移、初始化与就绪探测。
- `tests/domain/registration-profile.test.ts`、`tests/registration/service.test.ts`、`tests/registration/metro-browser.mjs`：合并、接口集成及新流程验收。
- 需求/设计/数据/旅程/验收/变更和本报告同步更新。Next构建自动更新类型引用配置。

## 验收结果

| 附件序号 | 状态 | 证据与边界 |
|---|---|---|
| 1 凭证与签到状态 | 通过 | 动态活动/六码；更新、未变化、请求失败保留状态；签到后进入原活动 |
| 2 再次访问 | 通过 | 刷新读取会话与服务器记录，后续无成功动画；跨设备恢复未新增 |
| 3 四站线路 | 通过 | 当前站、保存标记、直接跳转和返回 |
| 4 分站与选填校验 | 通过 | 身高非法值被拒绝；四站全部空白选填可确认；分站更新保留其他字段 |
| 5 草稿与重试 | 通过 | 断网、刷新恢复、冲突两份内容、非重叠合并、提交成功响应丢失后幂等重试 |
| 6 相册与权限 | 通过 | 增删持久化、非法文件拒绝后可上传有效图片、匿名照片拒绝；机构选择沿用原规则 |
| 7 预览编辑回流 | 通过 | 三卡片真实内容、分区编辑、保存直接回预览；编辑页刷新保留回流方式 |
| 8 首次与再次确认 | 通过 | 确认时间持久化、后续保存修改；接口幂等和UI提交锁；无重复报名 |
| 9 移动端与微信 | 待人工验证 | 自动化320/375/390/430/1440宽度、440px容器、底部字段不遮挡通过；实体微信选图/软键盘/返回仍需用户验证 |
| 10 兼容回归 | 通过 | 服务生命周期、基本报名修改、六码/旧码、机构同步、签到、重置与原身份关联；编辑中被运营取消后返回已取消凭证；UAT原有数据保留 |
| 11 可访问性 | 通过 | 字段明确标签、站点键盘操作、当前站语义、reduced-motion；抽查文字对比度最低5.64:1；不等同于完整第三方无障碍认证 |

验证结果与截图：`docs/verification/registration/metro-v12/`，包括首次/再次凭证、四站、冲突、五种宽度、`browser-result.json`、`contrast.json`和`uat-result.json`。截图中的参与者与相册属于隔离测试库；完整长截图会记录sticky按钮的视口位置，底部字段另有实际滚动可见性断言。

- 131项领域测试通过。
- PostgreSQL完整服务生命周期及新增分站、跨字段保护、幂等、非法/过期请求、机构发布状态不受纯导航影响等检查通过。
- Chrome浏览器自动化通过上述流程；真实微信与实体手机没有在本机自动化中冒充验证。
- 涉及模块ESLint、Next生产构建（含TypeScript）通过。
- 本机UAT健康、报名、原互动、运营、机构、大屏入口200；匿名报名查询/分站更新401。
- 升级时3条原报名、3个原六码；28张表原有数据摘要一致。010只追加兼容默认列，没有植入UAT演示数据。

## 部署与回退

当前保护目录：`~/.config/destinylab/2026-10-12-registration-metro/`，含`uat.env`、`uat.pid`、`uat.log`、`before-metro.dump`、`before-tables.json`、`migration-result.json`。目录和配置不可进入交付包。备份目录已使用pg_restore文件方式校验可读；本轮未执行全库恢复演练。第一次管道校验中断时自动恢复旧服务，随后重新备份并完成文件校验及升级。

部署顺序：停止写入→备份→加载受保护环境→执行以下命令→启动新构建→检查ready与入口。

```sh
DESTINY_MIGRATE_DATABASE=目标数据库名 node --conditions=react-server --import tsx scripts/migrate-registration-profile.ts
```

脚本要求目标名与DATABASE_URL一致。首次初始化脚本已包含010。迁移可重复执行，保留原字段/数据。

应用回退使用`.next-registration-receipt`与`~/.config/destinylab/2026-10-12-receipt-six/uat.env`重启，保留新增列和所有新资料。不要删除表/列，不用全库备份覆盖升级后新增报名。恢复旧应用后原资料、照片、凭证照常读取，四站进度仅由新版解释。

## 手机人工验证路径

1. 同一Wi-Fi用原报名浏览器打开入口；应显示我的凭证与六码，新用户才出现首次报名成功。
2. 进入档案，生活→期待→相册→预览；试选填跳过、输入法/键盘、手机选图、图片预览及返回。
3. 在预览点击任意编辑，保存直接回预览；确认后退出并再次打开，资料应仍在。
4. 运营核验手机六码，手机点击状态区域刷新，进入原活动。照片不因填写而自动公开。
