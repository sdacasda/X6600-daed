// Pure validation helpers; no router or network operations.
export function parseConfig(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const set = line.match(/^(CONFIG_[\w.+-]+)=(.*)$/);
    const unset = line.match(/^# (CONFIG_[\w.+-]+) is not set$/);
    if (set) values.set(set[1], set[2]);
    if (unset) values.set(unset[1], 'n');
  }
  return values;
}
export function mergeConfig(base, overlay) {
  const values = new Map([...parseConfig(base), ...parseConfig(overlay)]);
  return '# Generated from pinned PLUS baseline and daed overlay.\n' +
    [...values].map(([k,v]) => v === 'n' ? `# ${k} is not set` : `${k}=${v}`).join('\n') + '\n';
}
export function requireConfig(actual, expected) {
  const got = parseConfig(actual);
  const errors = [...parseConfig(expected)].filter(([k,v]) => got.get(k) !== v)
    .map(([k,v]) => `${k}: expected ${v}, got ${got.get(k) ?? 'absent'}`);
  if (errors.length) throw new Error('Required config changed:\n' + errors.join('\n'));
}
export const kernelBuiltins = ['BPF','BPF_SYSCALL','BPF_JIT','CGROUPS','CGROUP_BPF','KPROBES',
  'KPROBE_EVENTS','BPF_EVENTS','BPF_STREAM_PARSER','DEBUG_INFO','DEBUG_INFO_BTF','NET_INGRESS',
  'NET_EGRESS','NET_CLS_ACT','NET_NS','NAMESPACES','XDP_SOCKETS','PERF_EVENTS'];
export const kernelModules = ['NET_SCH_INGRESS','NET_CLS_BPF','NET_ACT_BPF','VETH','XDP_SOCKETS_DIAG'];
export function requireKernel(text) {
  requireConfig(text, kernelBuiltins.map(k=>`CONFIG_${k}=y`).join('\n') + '\n# CONFIG_DEBUG_INFO_REDUCED is not set\n');
  const values = parseConfig(text);
  for (const key of kernelModules) {
    if (!['y','m'].includes(values.get(`CONFIG_${key}`))) throw new Error(`Missing kernel CONFIG_${key}`);
  }
}
export function requireBtf(sections) {
  if (!/\]\s+\.BTF\s+/.test(sections)) throw new Error('vmlinux has no .BTF ELF section');
}
export function relocateLuci(text) {
  const marker = 'include ../../luci.mk';
  if (text.split(marker).length !== 2) throw new Error('LuCI makefile include changed');
  return text.replace(marker, 'include $(TOPDIR)/feeds/luci/luci.mk');
}
export function requireFirmware(kernel, metadata, limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid kernel size limit');
  if (kernel.length > limit) throw new Error(`Kernel size ${kernel.length} exceeds ${limit} bytes`);
  if (kernel.length < 40 || kernel.readUInt32BE(0) !== 0xd00dfeed ||
      kernel.readUInt32BE(4) < 40 || kernel.readUInt32BE(4) > kernel.length) throw new Error('Invalid or truncated FIT kernel');
  if (!metadata.supported_devices?.includes('jdcloud,re-cs-02')) throw new Error('Wrong supported device');
  if (metadata.version?.target !== 'qualcommax/ipq60xx') throw new Error('Wrong firmware target');
}
export function requireManifest(text, packages, version) {
  const entries = new Map(text.trim().split(/\r?\n/).map(line => line.split(' - ')));
  for (const name of packages) if (!entries.has(name)) throw new Error(`Missing manifest package: ${name}`);
  const actual = entries.get('daed');
  if (actual !== version && !actual?.startsWith(version+'-')) throw new Error(`Unexpected daed version: ${actual}`);
}
export function patchPackages(text, pins) {
  const marker = 'git clone --depth=1 --single-branch --branch "$PKG_BRANCH" "https://github.com/$PKG_REPO.git"';
  if (text.split(marker).length !== 2) throw new Error('Pinned upstream clone instruction changed');
  const cases = pins.map(({repo,commit}) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid plugin repository or commit');
    return `    '${repo}') PKG_PIN='${commit}' ;;`;
  }).join('\n');
  return text.replace(marker, `local PKG_PIN\n  case "$PKG_REPO" in\n${cases}\n    *) echo "Unpinned plugin: $PKG_REPO" >&2; return 1 ;;\n  esac\n  git init -q "$REPO_NAME"\n  git -C "$REPO_NAME" remote add origin "https://github.com/$PKG_REPO.git"\n  git -C "$REPO_NAME" fetch --depth=1 origin "$PKG_PIN"\n  git -C "$REPO_NAME" checkout -q --detach FETCH_HEAD\n  [ "$(git -C "$REPO_NAME" rev-parse HEAD)" = "$PKG_PIN" ]`);
}
