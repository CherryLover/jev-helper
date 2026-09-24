# jev-helper · 王二火大 WannaFire

Chrome / Edge Manifest V3 扩展。配置 JEV 密钥、API 地址和游戏页快捷键，即可一键接管正在运行的对局。无需 Node 代理、控制台代码或重新构建游戏。

官网：[《王二火大》](https://wangerhuoda.com/) · [WannaFire official website](https://wannafire.com/)。扩展弹窗底部和使用说明的官网入口随语言切换：中文显示「王二火大」并打开 wangerhuoda.com，英文显示「wannafire」并打开 wannafire.com，均使用新标签页。

## 安装与使用

1. 将发布 ZIP 解压到固定目录。在 Chrome 的 `chrome://extensions`（Edge 为 `edge://extensions`）打开「开发者模式」，点击「加载已解压的扩展程序」，选择含 `manifest.json` 的目录。本地开发可直接选择本项目的 `dist/`。
2. 打开扩展弹窗，填写密钥，也可选择「从本地 .env 配置导入」读取已有的 `JEV_API_KEY`、`JEV_BASE_URL`、`JEV_MODEL`。其他字段不会保存或发送。API 默认 `https://api.typesafe.ai/v1`，也接受完整 `/systemone` 地址；自定义服务必须实现 Jev 的候选 Choice 协议，不是普通 Chat Completions 接口。保存时只申请所填 API 域名的访问权限。
3. 点快捷键输入框，按下组合键并保存。默认 `Alt+Shift+J`，作用于游戏页面；浏览器地址栏或聊天输入框中不触发。「测试 Jev 连接」只发送一次无游戏动作的候选选择请求，可能产生少量模型费用；成功后再开局。
4. 在 `https://ra2web.github.io/` 正常进入对局，点击「开启托管」。再次点击「停止」或按快捷键即可接手。关闭弹窗仍继续运行。已打开的游戏页建议在安装扩展后刷新一次，确保快捷键监听器加载；工具栏按钮可直接注入当前页面。

也预先支持 `wangerhuoda.com`、`www.wangerhuoda.com` 和 `staging.wangerhuoda.com`。localhost / 127.0.0.1 调试页可通过点击扩展注入；首次点击前不注册这些调试页的快捷键。页面必须暴露兼容的 `window.werhd` 玩家 API。

密钥保存在本机浏览器扩展存储，不同步、不注入游戏页面、不记录到日志。它不是系统钥匙串加密存储。可在弹窗清除。更换服务域名需重新输入相应密钥。模型请求由扩展后台发出，拒绝重定向，网页不能指定请求 URL 或读取密钥。

HTTP 401/402/403 会显示具体状态并立即停止托管；服务恢复或修改配置后手动开启。每局默认 2000 次请求上限，达到后停止，不等于游戏结算或费用上限。不会自动接管下一场比赛。

## 0.4.0：两种模型来源（Jev 云端 / 本地 Laya）

扩展「设置」顶部新增「模型来源」开关，两套配置各自保存，随时切换：

- **Jev 云端**：原有方式。TypeSafe 托管的 Jev 模型，需要 JEV 密钥，按请求计费。
- **本地 Laya**：在本机 Apple 芯片上用 MLX 运行的 Laya 决策模型（来自 [laya-vs-jev](https://github.com/virajbhartiya/laya-vs-jev) 仓库）。不需要密钥，不产生 API 费用，单次回答通常几十到两百毫秒。

本地来源的使用步骤：

1. 把 `laya-vs-jev` 仓库放在本仓库旁边（或用 `LAYA_REPO=/path/to/laya-vs-jev` 指定），在其中完成 `uv sync` 并下载 `aac6fef/laya-multilingual-mlx` 检查点到 `models/hub/laya-multilingual-mlx`。
2. 在本仓库运行 `npm run laya`。它用 laya-vs-jev 的 Python 环境启动 `tools/laya-server.py`，默认只监听 `127.0.0.1:8742`，加载模型后打印监听地址。要让局域网内其他电脑使用，运行 `npm run laya -- --lan`：服务改为监听所有网卡，启动时打印局域网地址和访问令牌；令牌首次自动生成并保存在 `~/.laya-server-token`，之后每次启动都相同，删除该文件即可更换。其他可选参数：`--port`、`--model <检查点目录>`、`--token <令牌>`、`--raw-state`。
3. 在扩展设置中选择「本地 Laya」，本地服务地址默认 `http://127.0.0.1:8742/v1`；局域网使用时填服务打印的地址（例如 `http://10.0.25.215:8742/v1`）并填入访问令牌。点「保存设置」并授权该地址，再点「测试模型连接」。成功后照常进入对局开启托管。扩展只允许本机和私有网段（10.x、172.16–31.x、192.168.x、*.local）使用 HTTP，其他地址仍要求 HTTPS。

本地服务实现与 Jev 相同的 `POST /v1/systemone` 候选选择协议，扩展后台按当前选中的来源发请求，仍然只信任扩展内保存的地址和令牌，拒绝重定向；候选校验、请求上限、停止规则与 Jev 完全一致。切换来源或修改当前来源的地址 / 令牌 / 模型会停止正在进行的托管。悬浮状态窗、弹窗状态和快捷键提示会显示当前来源名称。

局限：Laya 的上下文只有约 1024 个 token，而一局的战况描述通常更长。本地服务会把数字、计数和标志放在前面、单位清单等长数组放在后面，超出部分从末尾截断；候选说明也会被压缩。因此本地模型的决策质量明显弱于 Jev，属实验用途，不保证胜率。服务端不接受非本机地址，也不会主动连接外网。

## 0.3.0：游戏内悬浮状态窗

- 默认允许展示，**仅在托管已开启且展示设置开启时出现**。快捷键、停止按钮、自动结束托管都会同步隐藏；不会在大厅或未托管时出现。
- 半透明窗口显示托管状态、有效模型回答数、资金、响应耗时、游戏 tick 和停止快捷键。拖动标题可移动，也可聚焦标题后用方向键移动；右侧按钮收起 / 展开。在当前页面内保留位置，刷新后重置。
- 在扩展「设置」中关闭「托管时显示悬浮状态窗」即可隐藏，立即保存、下次仍生效，**不影响托管运行**。语言跟随扩展设置。
- 开始 / 停止采用状态通知；可见且正在托管时约每 1.5 秒读取扩展会话及控制器状态，不额外请求模型或提交游戏命令。窗口不接收密钥、会话令牌或原始模型输出。

## 0.2.0：双语观察台

- 顶部「中 / EN」即时切换并保存语言。英文游戏名为 **WannaFire**。界面、提示、快捷键通知与帮助页均提供两种语言；游戏自身的语言不受影响。英文下单位使用稳定的规则代号（例如 `MTNK`），不伪造游戏未提供的英文译名。
- 「战场」：基地威胁、基地火力覆盖之外的攻击者、己方作战单位、视野内敌军、基地附近敌军、矿车、平均血量、防空、电力、生产队列和己方单位清单。位置图仅显示当前可见的最多 24 个单位/方和基地，自动缩放，不是全图雷达。
- 「趋势」：累计有效模型回答折线；现有资金与扣除生产队列剩余投入后的资金估算双线。支持鼠标查看采样点和左右方向键。模型一次回答可能包含多组选择，回答数、等待选择数和已受理动作数分开显示。
- 打开弹窗时每约 1.5 秒按需读取现有玩家 API，未开启托管也能观察；不调用 Jev、不提交命令。运行托管时关闭弹窗仍由玩家观测事件记录，停止托管且关闭弹窗后不再采样。
- 图表保留最近 300 个点，采样间隔至少 2 秒，横轴为本机时间；实际间隔也取决于游戏速度。超过 10 秒的采样空缺不连接曲线。数据存于本地扩展 session storage，后台休眠不丢失；每次开启托管、切换新局、刷新页面会重新开始，不保留长期战报。结束对局保留最后快照并标记为非实时。
- 态势来自当前玩家视野，威胁判断沿用本地策略的公开规则分析；不读取迷雾中敌军，不保证估算完整。

## WERHD 玩家 API

本仓库同步了一份线上玩家 API 参考，供编写和检查扩展策略使用：

- [完整类型声明](werhd-player-api.d.ts)
- [API 文档](docs/player-console-api.md)
- [基础接入示例](docs/examples/werhd-user-script.mjs)
- [来源版本、校验值和同步说明](docs/README.md)

API 仍由游戏页的 `window.werhd` 提供；这些参考文件不打入扩展运行包。

## 开发

```sh
git clone https://github.com/ra2web/jev-helper.git
cd jev-helper
npm ci
npm test
npm run package
```

开发构建只需 `npm run build`，然后在扩展管理页重新加载并刷新游戏页面。`dist/` 可直接加载；ZIP 位于 `artifacts/`。唯一构建依赖是 esbuild，无远程代码、无运行时外部依赖。

界面预览可运行 `node tools/preview.mjs`，再打开 `http://127.0.0.1:4318/`。它使用模拟数据，只需输入任意测试字符串；不会连接模型或游戏，也不会打包进入扩展。

- `src/player/`：后续策略的维护位置。初始策略来自原工程 `docs/examples/jev/` 的 v8.8.15，射程、编队、防守、科技、部署、驻扎、运输、空军、围墙、变卖与桥梁逻辑保持。原工程示例是历史接入方案，不会在每次构建时复制覆盖这里的策略。
- `src/page.mjs`：通过公开 `window.werhd` 控制当前玩家；决策走消息适配器，没有密钥和 HTTP 代理地址。
- `src/content.mjs` / `src/overlay.mjs`：隔离环境中的消息桥接、快捷键和托管时的悬浮状态窗。不自动开启托管。
- `src/background-core.mjs`：设置、会话、权限、模型来源选择、Jev / 本地协议和错误处理。会话计数存于 session storage，后台休眠/唤醒不重置预算；以标签页、文档和会话标识拒绝过期响应。
- `src/observer.mjs` / `src/telemetry.mjs`：只读观测、压缩快照与有界历史采样。
- `src/i18n.mjs` / `src/charts.mjs`：双语文案和本地 SVG 图表，无外部图表依赖。
- `src/popup.mjs` 与 `public/`：弹窗、说明、图标。
- `tools/laya-server.py` / `tools/laya-server.sh`：本地 Laya 决策服务（`npm run laya`），不打入扩展运行包。
- `test/`：既有策略回归及扩展消息、权限、停止、会话边界与双模型来源测试。

游戏引擎和 API 不在本项目中修改。扩展先用公开战况生成候选，Jev 选择候选，执行器复查后提交普通玩家命令。接受命令不等于已经产生游戏效果；策略仍属实验性质。

## 浏览器机制参考

[脚本执行上下文](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[扩展后台跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[可选域名权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[存储访问范围](https://developer.chrome.com/docs/extensions/reference/api/storage)。Chrome 不提供运行时修改 commands 快捷键的接口，因此弹窗中的自定义组合键由游戏页监听，而不是伪装成已修改浏览器的全局快捷键。

扩展安装和真实模型实战的验证范围见 `VALIDATION.md`。
