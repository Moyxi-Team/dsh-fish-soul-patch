# services —— 跟随 DSH 启动的本地服务栈

这些脚本**不做开机自启、不做登录自启**。它们只干一件事：**DSH（DeepSeek Harness）启动之后，把 fish-soul 依赖的几个本地服务拉起来；DSH 关掉之后，服务自己退场。**

原来那一套是「登录即起」（HKCU\Run、计划任务、Startup 文件夹里 6 个 vbs）。问题是没人在用电脑时它也在跑：QQ 没登录、微信没开，watchdog 只能空转重试，日志刷满、偶尔抢端口。现在统一改成**应用触发**：DSH 是这套服务的唯一消费者，DSH 起来了才有意义。

## 一、触发链

```
DSH 启动
  └─ 加载 profile 插件 dsh-boot-hooks（boot-hooks\boot-hooks.mjs，cordis.patch.yml 注册）
       └─ spawn wscript //B app-triggered-boot.vbs        ← 走 vbs 是为了不弹黑框
            └─ powershell -File app-triggered-boot.ps1    ← 2 分钟去抖，写 app-triggered-boot.log
                 ├─ fish-stack-watchdog.vbs  → fish-stack-watchdog.ps1   （常驻 8 秒轮询）
                 └─ wechat-stack-watchdog.vbs → wechat-stack-watchdog.ps1（常驻 8 秒轮询）
```

两个 watchdog 都是**常驻循环 + 具名互斥量**，重复拉起无副作用；它们每轮都检查 DSH 是否还活着，**DSH 消失 5 分钟（`HOST_GRACE_MINUTES = 5`）后自行退出**，并把状态文件一起清掉。所以「关掉 DSH → 服务在 5 分钟内全部退场」是设计行为，不是故障。

## 二、各服务管什么

| watchdog | 端口 | 服务 | 起服条件 |
| --- | --- | --- | --- |
| `fish-stack-watchdog.ps1` | `127.0.0.1:17890` | `voice-rotate-proxy.mjs`（TTS/STT 网关） | 只要 DSH 在 |
| `fish-stack-watchdog.ps1` | `127.0.0.1:3001` | SnowLuma（QQ OneBot 桥） | DSH 在 **且 `QQ.exe` 在跑** |
| `fish-stack-watchdog.ps1` | `127.0.0.1:8791` | `douyin-duty\webhook-sink.mjs`（抖音回调接收） | 只要 DSH 在 |
| `wechat-stack-watchdog.ps1` | `127.0.0.1:11229` `11234` | `social-bridge.js`（微信 ↔ fish-soul 的桥） | DSH 在 **且 WechatAgent 适配器端口在听** |
| `wechat-stack-watchdog.ps1` | — | 每次 (重)启动 + 每 5 分钟跑 `scripts\ensure-fish-soul-link.mjs` | 同上；若它**改动**了 `social-bridge.js`，会把桥重启一次让新代码生效 |

两条踩过的坑，代码里已经固化：

* **SnowLuma 必须在 QQ 已登录时启动**。QQ 不在时它只绑 WebUI 5099，之后不会再接管 QQ，变成僵尸占位。所以「3001 没起 + QQ 在跑 → 杀掉所有 SnowLuma 重新起一个；3001 没起 + QQ 不在 → 全部杀掉，等」。
* **WechatAgent 更新会把 `social-bridge.js` 覆盖回原版**。桥照旧监听 11229，但 fish-soul 接线没了（不进 11233、不听 11234）→ 微信掉回「未分组」会话。所以 watchdog 定时重打接线，而不是靠「端口在听」判断健康。

## 三、首次安装

```powershell
# 1) 把 boot-hooks\ 放到 DSH 目录下（插件必须住在 node_modules 之外，pnpm 更新删不掉它）
New-Item -ItemType Directory -Force C:\Users\Administrator\.dsh\boot-hooks
Copy-Item .\boot-hooks\* C:\Users\Administrator\.dsh\boot-hooks\ -Force

# 2) 把 .ps1 / .vbs 平铺到 DSH 目录（脚本内部按这个位置找同级文件）
Copy-Item .\*.ps1, .\*.vbs C:\Users\Administrator\.dsh\ -Force

# 3) 注册插件（幂等，可反复跑；DSH 开着也能跑）
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Administrator\.dsh\install-boot-hook.ps1

# 4) 重启一次 DSH，让 cordis 加载插件
```

`install-boot-hook.ps1` 只做四件修复，别的一概不动：

1. 校验 `boot-hooks\boot-hooks.mjs` + `package.json` 在；
2. `profiles\desktop\node_modules\dsh-boot-hooks` 的 **junction** 指向插件目录（不是就重建）；
3. `profiles\desktop\package.json` 里补 `dependencies.dsh-boot-hooks = link:...` 和 `dsh.profile.bundles` 里的 `dsh-boot-hooks`；
4. `profiles\desktop\pnpm-lock.yaml` 里补 importer 条目（缺了 pnpm 一装东西就会把 link 删掉）。

改之前都会先备份成 `*.bak-boothook-<时间戳>`。**DSH 更新、WechatAgent 启动都可能重写 profile 配置**，出现「开机后服务没起来」时先重跑这一步。

想**当下就起一遍**（不等重启 DSH、也不想看着黑框）：双击 `start-fish-stack-now.vbs`，它绕过去抖直接跑同一个入口脚本。

## 四、验证它真的生效了

```powershell
# 插件被 cordis 加载了吗（每次 DSH 启动追加一行）
Get-Content C:\Users\Administrator\.dsh\boot-hooks\loaded.log -Tail 5

# 触发脚本跑了吗（含去抖跳过、端口判定）
Get-Content C:\Users\Administrator\.dsh\app-triggered-boot.log -Tail 20

# 两个 watchdog 的状态与日志
Get-Content C:\Users\Administrator\.dsh\fish-stack-watchdog.log -Tail 20
Get-Content C:\Users\Administrator\.dsh\wechat-stack-watchdog.log -Tail 20

# 端口是否都在听
netstat -ano | findstr /R "17890 3001 8791 11229 11234"
```

判读：`loaded.log` 里没有新行 → 插件没被加载（回到第三节第 3 步）；有 `apply called` 但没有 `spawned pid` → wscript 路径或 vbs 缺失；有 `spawned pid` 但端口空 → 看两个 watchdog 日志里的具体失败原因（node 路径、token 文件、端口被占）。

## 五、停用 / 卸载

```powershell
# 1) 停掉常驻循环（两个 watchdog 会互不重启，直接用进程名结束即可）
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'fish-stack-watchdog|wechat-stack-watchdog' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 2) 摘掉插件注册（三个地方都要删，否则 DSH 启动会报插件找不到）
#    profiles\desktop\package.json → dependencies 里删 dsh-boot-hooks、dsh.profile.bundles 里删 dsh-boot-hooks
#    profiles\desktop\pnpm-lock.yaml → 删 dsh-boot-hooks 那段 importer
#    profiles\desktop\node_modules\dsh-boot-hooks（junction，直接删链接即可，别删目标目录）

# 3) 彻底不要了：删 C:\Users\Administrator\.dsh\boot-hooks\ 与本目录复制过去的 .ps1/.vbs
```

**注意不要**再往这三个地方加回自启，否则等于把「登录即起」又装回来：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`、任务计划程序里的 `DSH-*`、`shell:startup` 里的 vbs。

## 六、换机器要改的硬编码路径

脚本是照本机环境写死的（`C:\Users\Administrator\.dsh`），换用户名/换盘符必须逐处改：

| 出现在 | 硬编码 | 含义 |
| --- | --- | --- |
| 全部脚本 | `C:\Users\Administrator\.dsh` | DSH 配置根（`$root` / `$dshDir`） |
| `boot-hooks.mjs` | 同上 + `C:\Windows\System32\wscript.exe` | 触发入口与 vbs 解释器 |
| `fish-stack-watchdog.ps1` | `C:\Program Files\nodejs\node.exe`、`C:\SnowLuma\node.exe`、`C:\Users\Administrator\.dsh\voice-rotate-proxy.mjs`、`...\douyin-duty\webhook-sink.mjs` | 各服务解释器与入口 |
| `wechat-bridge-start.ps1` | `E:\ruanjian\WeChatAgent` | WechatAgent 安装目录（`data\runtimes` 里挑能 `require('node:sqlite')` 的 node） |
| `wechat-stack-watchdog.ps1` | `...\components\qq-bridge`、`scripts\ensure-fish-soul-link.mjs` | 桥本体与接线修复脚本（都在 WechatAgent 侧） |

密钥不落盘：`wechat-bridge-start.ps1` 的 `SOCIAL_DSH_TOKEN` 是从 `WechatAgent\data\workspace\state\social-dsh-token.txt` 现读的，仓库里没有任何 token。

## 七、和补丁仓的关系

`services/` 只放「让服务活起来」的脚本，**不改 dsh-fish-soul 本体**，跟 `patch-fish-soul.mjs` 的补丁（P1~P10）互不依赖：

* 插件升级/重装**不会**影响这里（`boot-hooks` 在 node_modules 之外，watchdog 只是外部进程）；
* 重打补丁**也不会**动这里；
* 唯一交叉点是微信链路：`wechat-stack-watchdog.ps1` 会周期性重打 WechatAgent 的 `social-bridge.js` 接线（为的是 11233/11234 两个口），而 fish-soul 这侧监听 11233 的入站服务由 P9 补丁提供。**两个都要在**，微信消息才走得通。
