# 素材清单与生成来源

## 2026-10-11 · 用户相册头像

新增真实服务照片路径 `/api/avatar/<asset-uuid>`，大屏用途使用 `?screen=1` 并逐次检查许可。照片由本人主动选择，客户端裁剪后服务端再次解码、去元数据并输出 512×512 WebP（不超过 200 KiB），不存原相册文件、不存 Base64。静态系统头像目录与编号保持。

支持 JPG／PNG／WebP，输入最多 10 MiB 和 2400 万像素，拒绝动画及无效图片。HEIC 能否由系统相册转换须真机验证，不能转换时显示格式提示。新增直接依赖 sharp，用于服务器验证与重编码；不进入公开 Next image 优化缓存。


## ACT03 V2三对图的使用（2026-10-09）

参考来源为资料目录`第三幕设计.png`与`Destiny_Field_ACT03_三对相遇_Codex实施提示词_V2.0.md`，只借鉴三组横向独立关系场和克制秋日质感。没有将参考图导入public作为背景，没有复制其中二维码、Logo、地点日期、建筑或额外文案。

沿用`ambient-act12-v2.png`、20张虚拟头像白名单与原WorldQR。新素材/新依赖均为0。三组轨迹由共享缓冲生成，头像请求失败用CSS中性轮廓和原昵称，不生成或替换另一张人脸。背景仍为1672×941图像，4K文字头像与QR由DOM清晰绘制，不宣称背景为原生4K素材。


2026-10-05 使用 Codex 内置 imagegen 工具生成项目素材，没有使用 CLI 或外部 API key。

| 本地文件 | 用途 | 生成输出 |
| --- | --- | --- |
| public/assets/gulou-autumn.png | 无字鼓楼秋景背景 | exec-e7fcba65-30df-4b43-9f36-05b626bb35aa.png |
| public/assets/avatar-male.png | 系统男性虚拟插画头像 | exec-7b65bb40-f703-4cdb-ab40-c46f842e8da6.png |
| public/assets/avatar-female.png | 系统女性虚拟插画头像 | exec-82b17bda-d60c-403d-86bf-61b8b31d64b0.png |

原始生成输出位于 `.codex/generated_images/01a10a5b-5149-76b3-abba-bcb04ee674de`，已复制到独立项目中。运行不依赖原输出目录。三张图均已目视检查；建筑是依据文字生成的场景插画式照片，不作为实际场地测绘；人物为虚构系统头像。

## 最终提示词：场景

Create a single premium editorial background photograph for a Chinese mobile web app Destiny Lab. Asset only, absolutely NO UI, no text, no captions, no logos, no borders, no phone screen. Portrait 1024x1536. Realistic Yinchuan Gulou (Chinese drum tower) on an autumn pedestrian street at warm late afternoon. Elegant traditional three-tier Chinese pavilion tower on a stone gate, at lower center-right, gold maple leaves framing upper right, golden trees along cobbled street, tiny anonymous pedestrians in distance only. Creamy light sky in upper third for overlay text. Soft natural sun, muted warm gold, deep wine-red architectural detail. Sophisticated nostalgic film photography, paper-like subtle grain, realistic architectural proportions. Composition inspired by the supplied Destiny Lab mobile references: warm cream and burgundy atmosphere, romantic but restrained urban encounter. This is one reusable scenic photo, not a collage. No foreground portrait, no writing on signs.

## 最终提示词：男生头像

Single square virtual avatar illustration for an elegant Chinese urban social app, East Asian adult man age late twenties, chest-up centered, short softly tousled dark brown hair, cream crewneck and dark brown casual jacket, calm friendly expression, looking slightly right. Premium hand-painted contemporary manga editorial illustration, subtle paper texture, refined natural proportions, warm beige solid background, muted autumn cream and burgundy palette. NO text, NO frames, NO UI, no photorealism. 1024 square, full head and shoulders with generous margins, designed to crop as a circular avatar. This is clearly a generic fictional system illustration, not a real person's photograph.

## 最终提示词：女生头像

Single square virtual avatar illustration for an elegant Chinese urban social app, East Asian adult woman age late twenties, chest-up centered, long softly flowing dark brown hair, cream coat with muted burgundy scarf, calm friendly smile, looking slightly left. Premium hand-painted contemporary manga editorial illustration, subtle paper texture, refined natural proportions, warm beige solid background, muted autumn cream and burgundy palette. NO text, NO frames, NO UI, no photorealism. 1024 square, full head and shoulders with generous margins, designed to crop as a circular avatar. This is clearly a generic fictional system illustration, not a real person's photograph.

## 替换方法

场景图可按原路径维护；新头像必须通过 src/config/avatars.ts 的固定 ID 白名单接入，并检查所有手机页、卡片与大屏，不根据性别或刷新临时随机替换。文字由 HTML 渲染，不需要写入图片。Logo 是 `src/components/ui.tsx` 中的原生矢量品牌标识；正式品牌源文件提供后可替换。二维码在 `/demo` 配置 URL，重新打开大屏生效。

## 用户提供的 20 张虚拟头像（2026-10-05）

来源：同目录资料仓的《缘分实验室_女生头像_10张.zip》《缘分实验室_男生头像_10张.zip》，各 10 张 1254×1254 RGBA PNG。按 female-01→female_01、male-01→male_01 的原顺序重命名，存于 public/assets/avatars/{female,male}。20 张共 35,498,743 字节，原包与原图未改；每个源/目标 SHA256 一致，清单见 verification/avatars/source-manifest.json。

页面通过 Next Image 请求本机缩略图，不访问第三方头像 API，不生成新人脸；Canvas 与页面读取同一配置和图片源。原有两张系统插画仍保留，不再作为实际参与者头像选择来源。


## Destiny Field 双幕背景（2026-10-08）

- 工作区资产：`public/assets/destiny-field/ambient-act12-v2.png`，1672×941 PNG；在16:9舞台cover显示。背景景深素材不含UI，4K清晰文字、二维码与人物由独立DOM渲染，未宣称背景原生4K。
- 工具：内置imagegen；源文件保留在`/Users/lvyong198201/.codex/generated_images/01a10a5b-5149-76b3-abba-bcb04ee674de/exec-3050138b-4d16-4ad5-b7ff-daeef95fd8a6.png`。没有外部付费CLI、后备模型或旧素材覆盖。
- 提示词：见本轮`verification/destiny-field-act12-v2/background-prompt.txt`。生成后检查无文字/人物/数字/QR/建筑地标；渲染层另绘三场弧线、实时头像和字幕。

## 第三幕资产复用（2026-10-09）

本轮没有新增生成素材。背景沿用`public/assets/destiny-field/ambient-act12-v2.png`；左右人物直接读取用户选择的现有男/女虚拟头像白名单，CSS圆形裁切不改原图。Connection为Three固定缓冲/池化点效果，失败时使用静态SVG曲线；文字和昵称均为DOM，二维码沿用现有生成组件及载荷。


## 2026-10-11 宣传页隐藏编号与女生 UAT 样例

新增 assets/uat/tongzhou-20261011/ 的 8 张 AI 合成人像，仅作 UAT 虚构测试。每人一张人物照、一张保持身份的生活照；生成来源与提示词规格见该目录 README.md。上传时复用原相册 WebP/缩略图处理；原图不放 public、不随生产镜像包含。

## 2026-10-12 报名视觉

public/assets/registration/city-dusk.png 为本轮基于用户海报视觉语言生成的无文字城市氛围图，1024×1536。用于报名首页，不复制原海报政府标志、主承办方信息或原二维码。docs/design/registration保存用户确认的七屏高保真参考。
