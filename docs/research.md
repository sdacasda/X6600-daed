# 雅典娜 AX6600 PLUS：daed 依赖复核与构建方案

核对日期：2026-09-19。目标：保留用户当前 PLUS 功能，在同一设备源码基础上补齐 daed 所需内核能力，使用 GitHub Actions 构建。

**当前状态：已完成下列静态核对与构建输入准备；尚未编译固件，尚未进行设备运行测试。配套配置片段是候选输入，不是已经验证可刷入的固件。**

## 1. 本次确认的基础

- 构建仓库：`ones20250/Openwrt-AX6600`，发布标签对应提交 `6a49eb74045f58514f6986daaf40201cbd0160ee`。
- 系统源码：`ones20250/immortalwrt_ipq`，提交 `86645e0f52ddffa33677bf79ea34121c1eaefd28`。
- 目标：`qualcommax/ipq60xx`、`jdcloud_re-cs-02`、`aarch64_cortex-a53`。
- 已读取用户提供的完整 OpenWrt `.config`、插件版本记录，并补取同一发布的 manifest。
- 原固件内核 `6.18.44`；用户 SSH 结果确认该版本正在运行。
- 用户 Config 文件 SHA-256：`3e2969e13605269b54b221e69ac5de642d0d2c83187f41ce6f7daa20b15633bc`。
- 用户 Packages 文件 SHA-256：`89a852e7bdab3c3ceaeb0825121bcf60697554212fa0fb180c443ae4073d0783`。

[原发布](https://github.com/ones20250/Openwrt-AX6600/releases/tag/IPQ60XX-WIFI-YES-PLUS-ones20250-main-26.09.17-17.45.26)

## 2. 新发现的关键限制：内核空间

准确源码的设备定义写明 `KERNEL_SIZE := 6144k`，即 6,291,456 字节。已解包的 PLUS FIT 内核为 5,809,712 字节，距离该构建布局上限只剩 **481,744 字节，约 470.5 KiB**。

BTF 和探针等功能可能使内核变大；具体增量必须编译后测量。用户报告的 `/overlay` 剩余 1.6 GB 不等于内核分区可用空间。6 MiB 是源码布局值，仍需读取实机分区表确认实际容量。

构建中必须读取最终 sysupgrade 包内的 FIT 内核长度，并与源码布局、实际目标分区容量分别比较。超出任一适用限制时不进入刷机阶段。保留原 gzip FIT 格式；若超限，再研究压缩或裁剪方案，不能未经验证切换 LZMA、改分区或改 U-Boot。

该版本升级脚本的设备专用 `platform_check_image()` 返回成功，不能把通过升级预检等同于内核大小已经核验；通用元数据检查仍有价值，但不能替代容量检查。

来源：[设备定义](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/target/linux/qualcommax/image/ipq60xx.mk)、[FIT 格式](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/target/linux/qualcommax/image/Makefile)、[设备升级脚本](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/target/linux/qualcommax/ipq60xx/base-files/lib/upgrade/platform.sh)。

## 3. daed、后端、核心和界面必须配套

首轮候选采用 ImmortalWrt 已打包的 **daed 1.27.0**：

| 组件 | 固定版本/提交 |
|---|---|
| daed | `v1.27.0`，提交 `06857f52c33cc3264aea9eb90431afbe8909073c` |
| dae-wing 后端 | `6bb6a310ef3d98bea691fd5955cc703306835546` |
| 内置 dae 核心 | `7e67e31e241a6d2cc5f2b5ff228b4fb5faf6d24a` |
| Web 界面 | 同一 `v1.27.0` 的 `web.zip` |
| Web SHA-256 | `da8755fb2cabfab392854e807e385b12d9e9842d6c8b5e347284d1ae0e582bfc` |

这是候选构建组合，不代表已证明它与 Linux 6.18.44、当前 Go 工具链兼容。daed 已包含核心，不另行启用独立 dae 服务；也不把当前 dae 主分支的新字段直接复制到这个固定核心的配置。

本次查询 `releases/latest` 指向 `dae-lang-core-v0.2.0` 组件发布，因此下载时使用明确标签和哈希，不能依赖 `latest` 自动找到整套程序。

来源：[ImmortalWrt 打包定义](https://github.com/immortalwrt/packages/blob/8509f551edb7beb4a6324afca4d84b2bea404b66/net/daed/Makefile)、[daed 版本](https://github.com/daeuniverse/daed/tree/v1.27.0)、[固定后端](https://github.com/daeuniverse/dae-wing/tree/6bb6a310ef3d98bea691fd5955cc703306835546)。

## 4. 内核要求逐项核对

以下“已有”来自用户 SSH 配置或提供的完整 OpenWrt 配置；最终仍需检查构建生成的 Linux `.config`。

| Linux 功能 | 当前证据 | 构建处理 |
|---|---|---|
| `BPF`、`BPF_SYSCALL`、`BPF_JIT` | 已有 | 保留，验证最终为 y |
| `CGROUPS`、`CGROUP_BPF` | 已有 | 保留 |
| `NET_INGRESS`、`NET_EGRESS`、`NET_CLS_ACT` | SSH 已有 | 保留 |
| `NET_SCH_INGRESS` | 模块已加载 | 保留 `kmod-sched-core` |
| `NET_CLS_BPF`、`NET_ACT_BPF` | `kmod-sched-bpf` 未选，前者在 SSH 中关闭 | 选入 `kmod-sched-bpf`，验证 `.ko` 入镜像 |
| `KPROBES` | 关闭 | 开启 |
| `KPROBE_EVENTS` | 需由依赖补齐 | 由 KPROBES 关联选择并检查最终值 |
| `BPF_EVENTS` | 关闭 | 开启 |
| `PERF_EVENTS`、FTRACE 依赖 | PERF_EVENTS 关闭 | 按原源码 KPROBES 的 select 关系补齐 |
| `BPF_STREAM_PARSER` | 关闭 | 开启，依赖 CGROUP_BPF |
| `DEBUG_INFO` | 已开启 | 保留 |
| `DEBUG_INFO_REDUCED` | 已开启 | 关闭 |
| `DEBUG_INFO_BTF` | 未选，实机无 vmlinux BTF | 开启，检查 ELF `.BTF` 和实机 BTF |
| `XDP_SOCKETS` | 关闭 | 为所选软件包的依赖链开启 |
| `XDP_SOCKETS_DIAG` | 未选 | 选入 `kmod-xdp-sockets-diag` |
| `VETH`、`NET_NS`、`NAMESPACES` | 已有 | 保留，用于核心网络命名空间 |
| `IKCONFIG` 支持 | 原版含 `kmod-ikconfig` | 保留，便于实机复核 |

XDP sockets 是所选 ImmortalWrt 软件包的依赖之一；这不表示应把所有物理网口改为 XDP 工作方式。eBPF TC 接管与 NSS 是否兼容仍需实测。

来源：[固定核心的内核要求](https://github.com/daeuniverse/dae/blob/7e67e31e241a6d2cc5f2b5ff228b4fb5faf6d24a/docs/en/README.md)、[原源码内核选项及依赖](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/config/Config-kernel.in)、[网络模块定义](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/package/kernel/linux/modules/netsupport.mk)。

## 5. 编译端和软件包要求

- 采用 ARM64/musl 的 OpenWrt 交叉构建；不能安装 Ubuntu 的 `.deb` 或 x86_64/AVX2 二进制到这台路由器。
- 选入 `daed`、`luci-app-daed`、`daed-geoip`、`daed-geosite`；LuCI 包负责引入后三者对应依赖。原 PLUS 已有 `v2ray-geoip`、`v2ray-geosite`、`ca-bundle`、`ip-full`、基础调度和 veth。
- 构建需要 Go host、BPF headers 和支持 BPF 目标的 LLVM/Clang；原源码 `bpf.mk` 最低要求 Clang 12。确定云端 LLVM 路径后，再选择 host/prebuilt/build 模式，不能只选 `HAS_BPF_TOOLCHAIN` 就认为编译器已安装。
- BTF 选项会选择 DWARVES/pahole；须验证构建实际使用的 host 工具，不能只检查 runner 系统 PATH。
- 原 BPF headers 包有自己的内核版本（6.12）；这是构建头文件来源，不等于必须把设备内核降到 6.12。CO-RE 能否正确重定位还取决于实机 BTF 和 verifier。
- 固定后端声明 Go 1.22、建议 toolchain 1.23.6；本次查看的 packages 软件源默认 Go 已为 1.27。不能仅凭版本号较新判定兼容，必须编译后端及其 QUIC 等依赖。
- `tc-full`、`bpftool` 可用作调试工具，不应冒充 daed 程序本身的强制依赖。首轮可按空间选择工具。
- 原配置中没显示 daed 选项，并不能单独证明软件源没有该包；可能是依赖条件未满足而被隐藏。应先检查 feeds，再安装索引和执行 `make defconfig`。

来源：[BPF 构建规则](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/include/bpf.mk)、[LuCI 依赖](https://github.com/immortalwrt/luci/blob/adc898b447eb4ee8023398182f5d0de2e8817e81/applications/luci-app-daed/Makefile)、[后端 go.mod](https://github.com/daeuniverse/dae-wing/blob/6bb6a310ef3d98bea691fd5955cc703306835546/go.mod)。

## 6. 从其他系统借鉴的部分

| 参考 | 借鉴到本设备 | 不直接照搬 |
|---|---|---|
| daed 自带 systemd 服务，供普通 Linux 打包使用 | 等待网络、配置目录、异常重启、避免独立 dae 同时运行 | `systemctl`、systemd unit 文件 |
| daeuniverse 的 NixOS 模块 | 配置与数据库持久化、geo 数据路径、限制管理入口 | 全局开放透明代理端口的防火墙做法 |
| ImmortalWrt 原生包 | procd/UCI、日志轮换、LuCI、默认禁用 | 未经检查把管理入口暴露到所有可达网络 |
| 官方 Docker 示例 | `/etc/daed` 持久化以及宿主内核依赖 | 用 Docker 绕开缺失 BTF；容器仍依赖宿主内核 |

系统服务参考明确 `Conflicts=dae.service`。在 OpenWrt 中要用适合 procd 的方式保持单一流量接管者。原生包现有日志轮换和较高文件描述符限制可复用；配置数据库应留在持久化目录，日志使用路由器的临时日志空间并控制大小。

NixOS 默认监听 localhost；路由器需要局域网管理，因此本方案是管理入口仅供管理 LAN 使用，并检查 IPv4/IPv6 的 WAN 防火墙，不机械复制 localhost 或无差别开放端口。

来源：[systemd 服务](https://github.com/daeuniverse/daed/blob/v1.27.0/install/daed.service)、[NixOS 模块](https://github.com/daeuniverse/flake.nix/blob/main/daed/module.nix)、[procd 启动脚本](https://github.com/immortalwrt/packages/blob/8509f551edb7beb4a6324afca4d84b2bea404b66/net/daed/files/daed.init)、[Docker 官方说明](https://github.com/daeuniverse/daed/blob/v1.27.0/docs/getting-started.md)。

## 7. PLUS 共存与网络设置

1. **保留插件，先不自动接管。** daed 默认 `enabled=0`；OpenClash、PassWall2 可以保留安装，但测试同一终端流量时只能由明确选定的代理接管。数据库、订阅和节点信息不写入公开构建仓库。
2. **确认拓扑。** 先确认本机是主路由还是旁路由、WAN 是 PPPoE 还是 DHCP、实际 LAN bridge/访客网络有哪些。不能凭示例把 `eth0`、`docker0` 写死。
3. **区分接口含义。** `lan_interface` 处理经过该 LAN 的设备流量；`wan_interface` 用于本机程序流量。根据实际目标选择，避免把“WAN”误解为只要代理局域网就必须绑定。
4. **DNS 与 DHCP 分开处理。** 保留 DHCP 服务。先画清 dnsmasq、AdGuard Home 与 dae DNS 的请求方向，避免互相转发的循环。按域名分流需要核心能获得相应 DNS 信息；客户端自行使用加密 DNS时不能保证完整的域名分流。不要直接复制 Clash YAML/fake-IP 方案。
5. **端口用途不同。** `2023` 是 Web/API 默认端口；`12345` 是透明代理内部端口，不是给终端填写的 HTTP/SOCKS 端口。保持透明代理端口保护，按固定版本和 fw4 实际规则调试。
6. **NSS/ECM 单独验证。** 保留 NSS 驱动和无线支持。首轮测试关闭相关流量卸载建立基线，再逐项启用实测；不能保证完整 NSS 加速与所有 dae 分流同时有效。原 ECM 停止脚本会清理连接并卸载 ECM，本阶段不执行，也不盲目卸载底层 NSS/Wi-Fi 驱动。
7. **IPv6 一起验证。** 检查转发、RA、反向路径过滤、TCP/UDP 和 DNS，不用“全面关闭 IPv6”掩盖故障。不照抄其他内核/核心版本的 sysctl 集合。
8. **协议按固定核心核对。** 其文档列有 VLESS/Reality、VMess、Trojan、Shadowsocks、Hysteria2、TUIC v5、AnyTLS 等；具体传输方式和订阅格式仍需确认，不能把“支持协议”当成所有客户端配置都可直接导入。只需用户说明协议名称，无需发送订阅密钥。

来源：[固定核心示例](https://github.com/daeuniverse/dae/blob/7e67e31e241a6d2cc5f2b5ff228b4fb5faf6d24a/example.dae)、[DNS](https://github.com/daeuniverse/dae/blob/7e67e31e241a6d2cc5f2b5ff228b4fb5faf6d24a/docs/en/configuration/dns.md)、[协议](https://github.com/daeuniverse/dae/blob/7e67e31e241a6d2cc5f2b5ff228b4fb5faf6d24a/docs/en/proxy-protocols.md)、[原版 ECM 服务](https://github.com/ones20250/immortalwrt_ipq/blob/86645e0f52ddffa33677bf79ea34121c1eaefd28/package/qca-nss/qca-nss-ecm/files/qca-nss-ecm.init)。

## 8. 云编译步骤与验收条件

1. 基于上述 PLUS 发布提交建立定制分支，锁定系统源码和五个外部插件提交。用户提供的 Packages 文件没有包含所有标准 feeds 的提交；因此不能声称原构建可逐字节复现。为新构建明确选择并记录完整 feeds 锁定清单。
2. 原始完整配置作基线，按键覆盖候选 daed 配置；不依赖冲突重复行的先后顺序。确认 feeds 里确有包，再运行 `make defconfig`。
3. 检查规范化后的 OpenWrt `.config` 中新增选项没有被依赖系统清除；检查生成的 Linux `.config` 中所有必需项。
4. 先构建 daed 与内核，确认工具链、BPF 生成、Go 依赖和 BTF 生成。然后构建完整固件及与该内核 ABI 匹配的全部模块。
5. 检查 ELF `.BTF`、最终 FIT 长度、sysupgrade 的设备元数据、包 manifest、daed/Web 版本；保存 SHA-256、内核配置、feeds.buildinfo、完整构建日志。原 CI 会删除部分 buildinfo，应为定制流程保留。
6. 首轮产物作为 Actions artifact，不自动发布正式 Release，也不从 CI 自动刷路由器。编译成功仅说明构建通过。
7. 设备测试前备份并确认恢复方式；核对实际分区容量。不能把其他固件源的 kmod 强制装到新内核上。
8. 实机检查 BTF、模块与 eBPF 程序加载；测试单台 LAN 设备的直连/代理、TCP/UDP、IPv4/IPv6、DNS、局域网访问、管理入口访问范围、服务停止恢复和重启恢复；再扩展到正常负载和加速组合。

上游包自带的测试仅检查 `daed --version`，不足以证明 eBPF 成功挂载或网络正常。因此上述设备网络测试是必需的验证阶段。

## 9. 现在需要用户配合的信息

- 已提供独立仓库 [sdacasda/X6600-daed](https://github.com/sdacasda/X6600-daed)，无需 Fork 原项目。构建方案与锁定依赖已加入本仓库，当前尚未完成云编译。
- 实机分区名称和字节大小：在 SSH 中执行 `lsblk -b -o NAME,SIZE,PARTLABEL,MOUNTPOINT`；如果不支持该列，发回错误即可。
- 本机是主路由还是旁路由；目前实际使用 OpenClash、PassWall2、AdGuard Home 中哪些服务；拟用节点协议名称。

无需先刷 PURE，也无需现在停止任何服务。本报告和候选片段都不会修改运行中的路由器。
