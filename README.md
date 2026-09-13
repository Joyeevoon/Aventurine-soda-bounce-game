# 汽水弹跳 Soda Bounce

长按蓄力的竖版弹跳小游戏：金发夏日少年踩着横躺的汽水瓶一路向上弹。

![genre](https://img.shields.io/badge/genre-arcade%20%2F%20bouncer-orange) ![tech](https://img.shields.io/badge/tech-vanilla%20JS%20%2B%20Canvas-blue) ![license](https://img.shields.io/badge/code-MIT-green)

## 玩法

- **长按**任意处蓄力（最长 1 秒，蓄满闪烁），**松手**向右上弹出
- 落到**安全瓶**（黄瓶）+3 分，站在上面继续蓄力
- **碎瓶**一踩即碎、**尖刺瓶**碰上即扎——都是即死
- 跳空坠出屏底也是即死
- 破纪录时可以刻下名字，👑 记录者常驻右上角

分数越高，跳板间距越大、危险瓶出现率越高（100 分后开始爬坡）。

## 运行

纯静态页面，无构建步骤。任选其一：

```bash
# 本地起个静态服务器
python3 -m http.server 8080
# 或
npx serve .
```

打开 `http://localhost:8080` 即可。也可以直接双击 `index.html`（音频在 file:// 下部分浏览器会延迟首次播放，属正常现象）。

## 文件结构

```
soda-bounce/
├── index.html        # 页面骨架 + HUD/弹窗/蓄力条样式
├── game.js           # 全部游戏逻辑（物理、判定、生成、渲染、QA 钩子）
├── assets/
│   ├── character.png          # 玩家角色（夏日少年）
│   ├── platform-normal.png    # 安全跳板（整瓶汽水）
│   ├── platform-broken.png    # 碎裂跳板（踩中即死）
│   ├── platform-spike.png     # 尖刺跳板（踩中即死）
│   ├── decor-upright.png      # 背景漂浮立瓶装饰
│   ├── bgm-fluffing-duck.mp3  # BGM
│   ├── sfx-bounce.mp3         # 起跳音效
│   └── sfx-land.mp3           # 落地音效
├── LICENSE
└── README.md
```

## 技术要点

- **物理**：重力 2200 px/s²，蓄力 1s 封顶映射速度（vx 240→520、vy 600→840）
- **落点判定**：穿越检测（swept crossing）——上一帧脚底在板顶上方、本帧到/过板顶才算着陆，配 6px 边缘吸附；不用边界框重叠，杜绝站立穿板
- **板体等大**：三种瓶按"瓶身圆柱等高"缩放，碎渣/尖刺是额外伸出的部分
- **镜头**：右向跟随（玩家锁定屏宽 20%），快速下坠时锁 Y 轴防止"掉不出画面"
- **背景**：立瓶零重叠约束放置（AABB + 10px 间距，回收再生同样检测）
- **移动端**：触控与鼠标同源（Pointer 事件），`100dvh` + `env(safe-area-inset-*)` 适配刘海屏，桌面端瓶板自动缩至 85%
- **QA 钩子**：`?qa=1` 暴露 `window.__game`（状态快照、精确落板、固定随机序列），可跑无头回归

## 素材版权

- 游戏**美术素材**（角色与四种瓶子）由本作作者提供，仅授权于本项目使用
- **BGM**：*Fluffing a Duck* — Kevin MacLeod (incompetech.com)，[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)，页面内已附署名
- **音效**：ffmpeg 合成，无第三方版权

## License

代码以 [MIT](./LICENSE) 发布。BGM 依上游授权单独署名（CC-BY 4.0），美术素材不随 MIT 重新授权。
