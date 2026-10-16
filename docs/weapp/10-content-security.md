# 微信公开内容检测与配置

公开互动昵称在入场、修改互动资料、授权卡牌墙时经过文本检测。私人姓名、电话、完整生日不发送到该接口。原生报名相册保持私人，机构公开主页沿用工作人员选择字段、预览后发布的既有人工流程；本轮没有把该 H5 管理流程替换成微信自动审核。

自定义头像先私有上传，再请求异步图片检测；只有有效的 `pass` 结果允许更新头像。`review`、`risky`、错误、超时、缺失结果均不放行。重新点击保存查询同一素材的结果，不重复上传。检测失败可以重试提交，超过 35 分钟无结果可重新提交；通过前继续使用原头像。

服务端通过带随机短期凭据的 PNG 链接提供检测文件，链接只在 pending 状态、有效期内可用。图片原始上传永远不进入 public 目录。反向代理访问日志只记录 `$uri`，不能记录该路径的 query、Authorization 或 Cookie。

## 上线配置

- 应用迁移执行至 `013-mini-content-review.sql`。
- `DESTINY_MINI_MODERATION=wechat`（默认）；配置真实服务端 AppID/AppSecret。
- `DESTINY_WECHAT_CALLBACK_TOKEN`：16–32 位随机字母数字。
- `DESTINY_WECHAT_CALLBACK_AES_KEY`：微信消息推送配置产生的 43 位 EncodingAESKey。
- 微信后台消息推送 URL：`https://实际服务域名/api/wechat/content/callback`，**安全模式、JSON 格式**。
- 媒体 URL 由固定服务根地址生成，不接受客户端 URL；域名必须可由微信下载，凭据有效期两小时。
- 回调核验签名、时间、AES 填充、消息长度、接收 AppID、业务 AppID/版本及 trace。事件入库幂等，冲突结果拒绝；回调早于提交响应时先存入收件记录，并以 trace 锁避免并发丢失。

仅独立回环 `_test` 数据库、回环服务地址与全零测试 AppID 同时满足时，允许 `local-test` 模式；不能用于真实账号或公网。测试开关不生成“微信已通过”的记录。生产启动和 readiness 均检查配置；缺失时拒绝开放。

## 证据与边界

已运行真实 PostgreSQL 与 API 路由测试，网络 provider 用测试函数替代：文本仅 pass 放行、私有下载令牌、未审核阻止使用、签名/时效/AppID 检查、重复及冲突回调、提前回调、错误结果不放行和测试模式边界。测试不代表实际微信平台已成功调用。

账号尚未确定，真实登录、内容检测及安全模式回调必须在配置后验收；出现平台权限或配额错误时保持关闭，不通过本地状态模拟通过。

接口依据：[文本内容安全识别](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html)、[多媒体内容安全识别](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_mediacheckasync.html)、[安全模式消息推送](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)。这些官方页面已于 2026-10-13 直接获取核对；旧 OpenApiDoc URL 会重定向到目录。
