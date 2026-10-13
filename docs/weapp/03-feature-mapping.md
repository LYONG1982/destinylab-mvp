# 用户功能与入口映射

| 功能 | 代码入口 | 处理 |
| --- | --- | --- |
| 报名码 | pages/registration/index | 姓名在前、昵称、性别、年月日、星座、城市和电话 |
| 邀请函 | RegistrationPage pass | 服务端六位凭证、活动时间地点、资料维护 |
| 地铁式档案 | RegistrationPage profile | 生活档案、期待、相册、预览；前三站保存，第四站只读 |
| 相册 | registration/upload、photo、delete-photo | 原生选择图片、授权私有下载、删除确认、最多6张 |
| 现场互动码 | pages/encounter/index | 未报名引导，未签到展示凭证，已签到幂等入场 |
| 十题至相遇 | pages/index/index | 复用已有题库、推荐、邀约和相遇流程；仍在现有状态页内切换，未重写算法 |
| 头像 | AvatarEditor | 虚拟头像与相册裁剪；新选择照片默认允许上屏，可在保存前调整 |
| 同舟 | ServiceForm / 相册站服务选项 | 资料服务继续可编辑，表单不再展示“撤回授权”按钮，保留删除资料处理 |
| 分享 | 两个入口页分享钩子 | 活动标识与入口路径，无手机号、生日、凭证、令牌 |
| 双码运营 | LiveOperatorPanel | 分别生成、查看、下载；需真实 AppID 与对应版本已上传 |
| 热启动 | app.componentDidShow | 扫到另一 scene 时重新路由；返回相册不重复导航 |
| 隐私 | pages/privacy/index | 报名说明、正式构建注入主体/联系渠道、打开微信隐私指引 |
| Web 后台与大屏 | 原有路径 | 保留 Web；不打包进微信端 |

`pages/index/index` 同时兼容旧入口；未入场会跳到互动校验页。两个入口不会创建两个身份，也不会因登录提前计入现场人数。
