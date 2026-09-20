# AX6600 PLUS + daed

为京东云雅典娜 AX6600（`jdcloud,re-cs-02`）准备的 ImmortalWrt PLUS 云编译配置，沿用 ones20250 的 Wi-Fi YES PLUS 方案，增加 daed、LuCI 入口和所需 eBPF/BTF 内核支持。

**当前是待云编译验证的构建方案，不是已经通过实机测试的固件。** 不需要 fork 原项目，也不需要在 Windows 上安装 Linux 编译环境。

## 使用 GitHub Actions

1. 仓库默认分支需要包含 `.github/workflows/build.yml` 及本仓库其他文件。
2. 打开 **Actions → AX6600 PLUS + daed → Run workflow**，第一次选择 `config`。
3. `config` 会下载锁定源码、安装 feeds、合并 PLUS 配置并运行 `make defconfig`，检查依赖是否完整；不会编译固件。
4. 检查通过后，再手动选择 `firmware`。该模式执行完整编译及产物检查，可能需要数小时。
5. 成功后，在本次运行底部 **Artifacts** 下载 `AX6600-PLUS-daed-candidate-*`；失败时下载 `AX6600-daed-reports-*` 查看日志。

提交代码只运行轻量脚本测试；完整编译必须手动启动。云编译不需要 SSH 密码、订阅链接或路由器账户，也不会连接或修改路由器。

## 基线和依赖

- 原 PLUS 发布：`IPQ60XX-WIFI-YES-PLUS-ones20250-main-26.09.17-17.45.26`。
- 固件源码：`ones20250/immortalwrt_ipq`，提交 `86645e0f52ddffa33677bf79ea34121c1eaefd28`。
- daed：`1.27.0`，沿用 ImmortalWrt 的 Go/BPF 构建、Web 资源校验和 procd 服务。
- 保留原完整配置，校验原有 547 个启用的软件包及功能选项，并用原发布 manifest 检查编译后的软件包。若新源码使选项失效，构建会停止并报告，而不是静默删减 PLUS 功能。
- LuCI 使用原发布 manifest 版本号 `830486a` 追溯到的提交 `830486a7e412a83f233e9c18bd1eb3668212c799`，该版本已包含 daed、IP/MAC 绑定和定时重启页面。其他标准 feeds 选择原发布时刻之前的提交作为候选基线；原发布没有提供全部 feeds 的提交记录，因此**不宣称逐字节复现原固件**。
- 所有仓库提交写在 [source-lock.json](source-lock.json)。GitHub runner、apt 工具和 Actions 主版本标签仍可能更新；完整环境不属于位级可复现构建。

详见 [依赖核对报告](docs/research.md)。该报告的初始调查时间早于本构建脚本；当前 feeds 选择以本 README 和锁文件为准。

## 检查与默认行为

- 启用 `KPROBES`、`BPF_EVENTS`、`BPF_STREAM_PARSER`、`DEBUG_INFO_BTF` 等；安装 TC BPF、XDP socket 诊断、veth 及地理数据库。
- 编译环境为 Ubuntu 24.04，使用 LLVM 18；最终 Linux 配置与 `vmlinux` 的 `.BTF` 段都要通过检查。
- 提取实际 sysupgrade 中的 FIT kernel，检查设备、target、FIT 头和 **6,291,456 字节（6144 KiB）**上限。超限会停止，不自动改分区或改变压缩方式。
- 仅在所有检查通过后导出 sysupgrade、manifest、SHA256 和验证报告，不发布 factory 刷机包。
- daed 默认关闭，启用后 Web 监听 `0.0.0.0:2023`；不添加 WAN 放行规则。沿用上游配置目录 `/etc/daed/` 和 procd，控制日志大小。
- 保留 PLUS 的 OpenClash、PassWall2、AdGuardHome、Docker 等。第一次配置 daed 时需结合实际网络处理代理、DNS 与 NSS/ECM 加速关系；不应直接同时启用多套透明代理。

完整编译通过仍不能代替实机验证：Wi-Fi、NSS、启动分区、DNS 和透明代理转发都需要后续检查。原 FIT 已有约 5.81 MB，增加 BTF 后可能超出上限；发生这种情况需要重新评估布局，不能强刷。

## 刷机前仍需核实

请先通过 SSH 提供以下只读输出，以确认真实分区容量和实际接口：

```sh
lsblk -b -o NAME,SIZE,PARTLABEL,MOUNTPOINT
uci -q get network.wan.proto
ubus call network.interface.lan status | jsonfilter -e '@.l3_device'
ubus call network.interface.wan status | jsonfilter -e '@.l3_device'
```

如果系统没有 `lsblk`，可先提供 `cat /proc/partitions`。同时说明它是主路由还是旁路由、现在启用了哪套代理和 DNS 服务。实际刷机前还需要备份与可用的恢复路径。这里不提供跳过检查的强刷命令。

## 本地脚本验证

Node.js 22 或更新版本：

```sh
node --test tests/*.test.mjs
bash -n scripts/prepare.sh
```

这些测试检查配置合并、依赖检查和失败阻断逻辑，不等同于编译成功或 daed 已能在设备上运行。
