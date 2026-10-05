# 大屏关系场本地验证 · 2026-10-05

项目 DestinyLab-MVP；本地生产构建 localhost:3210。本记录对应已确认大屏计划及头像展示补充，不包括待确认的十题扩展。

## 已完成的现场展示边界

- 用户选择的虚拟头像经白名单投影进入 Canvas；使用临时代号，不公开昵称、持久身份 ID、个人答案、地点、辨认码或具体配对。
- JOIN/ANSWER/ACTIVE 由实际快照差异产生；mutual MATCH 由原业务规则消费至少三对关系产生，confirmed MATCH 由实际真实见面数增长产生。效果不修改任何计数。
- 保留 12/8/8 秒主轮播、6 秒匿名聚合插播、原有 QR 配置与扫码像素。所有场景共用背景和三层 Canvas。

## 几何和扫码

before-layout.json 与 after-layout.json 记录 1920×1080 问题态：品牌、标题、统计条、QR 卡片、QR 图片、页脚六处边界完全一致。四态、切换中及 4K 均从实际渲染像素解码为原入口；图像 src、transform=none、opacity=1 与二维码边界保持不变。后续定向测试同时检查 Canvas 在 QR 安全区内的像素透明度。

当前 question/presence/mutual/real-meet PNG、question-4k.png 为浏览器截图。mock-join/answer/match PNG 与 video/*.webm 为独立开发预览，仅虚构效果；mock-check.json 记录演示前后 localStorage 业务快照完全一致。

## 连续运行和性能样本

soak-result.json：1920×1080、Chrome 无头本地，200 人、120 次模拟快照变更，实际运行 606 秒。11 次样本，3 个 Canvas、1 个 QR，物理节点最大 24；余量真实聚类。DOM 随轮播在 66–108 之间变化，无累计堆积。页面异常 0。

采样 GC 后 JS 堆 4,411,544–4,881,908 字节，结束 4,570,124；后半程稳定在约 4.52–4.57 MB，未见持续增长。这是 JS 堆样本，不是 GPU/进程总内存。并行构建/浏览器回归期间触发 30fps 降级，后续样本维持约 30fps；不声称现场设备已达到 60fps。

此持续运行样本覆盖正常动效逻辑；随后对减少动画的即时出生、尺寸变化最终位置及 CSS token 接线补充了定向验证。这些调整不改变正常 Canvas 连续循环。数小时现场大屏、微信或中端手机实机、远距离扫码仍待用户/现场验收。

## 证据入口

- verify.log：lint、类型、领域测试和生产构建。
- e2e.log：完整原旅程及大屏/头像浏览器回归。
- soak-result.json / soak.log：持续运行样本。
- ../avatars/source-manifest.json / thumbnail-delivery.json：素材不变与缩略交付。

开发预览启动方式：`npx next dev --hostname localhost --port 3211`，访问 `/screen` 左下“虚构动效预览”。关闭临时预览服务后，本地生产演示仍在 3210。未部署、未建立跨设备实时服务。

## 最终检查结果

lint、TypeScript、25 项领域测试及生产构建通过；完整 27 项 Playwright 测试通过（2.1 分钟）。包括二维码安全区三层 Canvas 的透明像素断言、减少动画下新头像与 4K 调整；详细日志以 verify.log / e2e.log 为准。未进行发布或用户体验代验收。
