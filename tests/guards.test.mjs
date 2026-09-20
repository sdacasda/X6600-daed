import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, mergeConfig, requireConfig, requireKernel, requireBtf,
  requireFirmware, requireManifest, patchPackages } from '../scripts/guards.mjs';

test('overlay replaces disabled keys and preserves unrelated PLUS settings', () => {
  const result = mergeConfig('CONFIG_PACKAGE_dockerd=y\n# CONFIG_KERNEL_KPROBES is not set\nCONFIG_KERNEL_DEBUG_INFO_REDUCED=y\n',
    'CONFIG_KERNEL_KPROBES=y\n# CONFIG_KERNEL_DEBUG_INFO_REDUCED is not set\n');
  const config = parseConfig(result);
  assert.equal(config.get('CONFIG_PACKAGE_dockerd'), 'y');
  assert.equal(config.get('CONFIG_KERNEL_KPROBES'), 'y');
  assert.equal(config.get('CONFIG_KERNEL_DEBUG_INFO_REDUCED'), 'n');
  assert.equal((result.match(/CONFIG_KERNEL_KPROBES/g) || []).length, 1);
});
test('package symbols containing dots and plus signs survive normalization',()=>{
  const original='CONFIG_PACKAGE_liblua5.4=y\nCONFIG_PACKAGE_libstdc++=y\n';
  const config=parseConfig(mergeConfig(original,''));
  assert.equal(config.get('CONFIG_PACKAGE_liblua5.4'),'y');
  assert.equal(config.get('CONFIG_PACKAGE_libstdc++'),'y');
});
test('defconfig silently removing a required package blocks the build', () => {
  assert.throws(() => requireConfig('CONFIG_PACKAGE_daed=y\n', 'CONFIG_PACKAGE_daed=y\nCONFIG_KERNEL_DEBUG_INFO_BTF=y\n'), /DEBUG_INFO_BTF/);
});
test('a required disabled option must remain explicitly disabled', () => {
  assert.throws(() => requireConfig('CONFIG_KERNEL_DEBUG_INFO_REDUCED=y\n', '# CONFIG_KERNEL_DEBUG_INFO_REDUCED is not set\n'), /DEBUG_INFO_REDUCED/);
});
const kernel = ['BPF','BPF_SYSCALL','BPF_JIT','CGROUPS','CGROUP_BPF','KPROBES','KPROBE_EVENTS','BPF_EVENTS',
  'BPF_STREAM_PARSER','DEBUG_INFO','DEBUG_INFO_BTF','NET_INGRESS','NET_EGRESS','NET_CLS_ACT','NET_NS','NAMESPACES','XDP_SOCKETS',
  'PERF_EVENTS'].map(k => `CONFIG_${k}=y`).join('\n') + '\n# CONFIG_DEBUG_INFO_REDUCED is not set\n' +
  ['NET_SCH_INGRESS','NET_CLS_BPF','NET_ACT_BPF','VETH','XDP_SOCKETS_DIAG'].map(k=>`CONFIG_${k}=m`).join('\n')+'\n';
test('Linux kernel check accepts required modules and rejects missing BTF', () => {
  requireKernel(kernel);
  assert.throws(() => requireKernel(kernel.replace('CONFIG_DEBUG_INFO_BTF=y','')), /DEBUG_INFO_BTF/);
});
test('BTF must exist as an ELF section, not merely in a config', () => {
  requireBtf('  [13] .BTF PROGBITS ffff0000 000100 000200 00 A 0 0 4');
  assert.throws(() => requireBtf(' [13] .BTF.ext PROGBITS 00 00 00'), /BTF/);
});
const fit = (size=64) => {const b=Buffer.alloc(size);b.writeUInt32BE(0xd00dfeed);b.writeUInt32BE(size,4);return b;};
const metadata={supported_devices:['jdcloud,re-cs-02'],version:{target:'qualcommax/ipq60xx'}};
test('firmware guard permits the limit and refuses an oversized kernel', () => {
  requireFirmware(fit(64),metadata,64);
  assert.throws(()=>requireFirmware(fit(65),metadata,64), /size/);
});
test('firmware guard rejects another board, wrong target and invalid FIT', () => {
  assert.throws(()=>requireFirmware(fit(),{...metadata,supported_devices:['other']},128), /device/);
  assert.throws(()=>requireFirmware(fit(),{...metadata,version:{target:'x86/64'}},128), /target/);
  assert.throws(()=>requireFirmware(Buffer.alloc(64),metadata,128), /FIT/);
  const truncated=fit();truncated.writeUInt32BE(999,4);
  assert.throws(()=>requireFirmware(truncated,metadata,128), /FIT/);
});
test('manifest must contain the selected version and all required modules', () => {
  requireManifest('daed - 1.27.0-r1\nkmod-sched-bpf - 6.18.44-r1\n',['daed','kmod-sched-bpf'],'1.27.0');
  assert.throws(()=>requireManifest('daed - 1.27.0-r1\n',['daed','kmod-sched-bpf'],'1.27.0'), /kmod-sched-bpf/);
  assert.throws(()=>requireManifest('daed - 1.28.0-r1\n',['daed'],'1.27.0'), /version/);
});
test('external plugin patch requires the exact upstream clone instruction', () => {
  const original='git clone --depth=1 --single-branch --branch "$PKG_BRANCH" "https://github.com/$PKG_REPO.git"';
  const patched=patchPackages(original,[{repo:'owner/pkg',commit:'a'.repeat(40)}]);
  assert.match(patched,/fetch --depth=1 origin/);
  assert.match(patched,/'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'/);
  assert.throws(()=>patchPackages('echo changed upstream',[]),/clone instruction/);
  assert.throws(()=>patchPackages(original,[{repo:'owner/pkg',commit:'main'}]),/commit/);
});
