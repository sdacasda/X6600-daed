import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseConfig, mergeConfig, requireConfig, requireKernel, requireBtf,
  requireFirmware, requireManifest, patchPackages } from './guards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root,'source-lock.json'),'utf8'));
const source = path.resolve(process.env.WRT_SOURCE_DIR || path.join(root,'.work','source'));
const upstream = path.resolve(process.env.WRT_BUILDER_DIR || path.join(root,'.work','builder'));
const reports = path.join(root,'reports');
const deliver = path.join(root,'artifacts');
const read = p => fs.readFileSync(p,'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const overlay = () => read(path.join(root,'config','daed.config'));
const preserve = () => read(path.join(root,'config','preserve.config'));
const run = (cmd,args,options={}) => execFileSync(cmd,args,{cwd:source,encoding:'utf8',maxBuffer:16*1024*1024,...options});
function assertRevision(dir, revision) {
  const got=execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(got!==revision) throw new Error(`Wrong source revision at ${dir}: ${got}`);
}
function configuration() {
  return read(path.join(source,'.config'));
}
function verifyConfig() {
  const actual=configuration();
  // Keep diagnostic evidence even when a guard fails.
  fs.writeFileSync(path.join(reports,'effective.config'),actual);
  requireConfig(actual,overlay());
  requireConfig(actual,preserve());
  requireConfig(actual,'CONFIG_TARGET_qualcommax=y\nCONFIG_TARGET_qualcommax_ipq60xx=y\nCONFIG_TARGET_DEVICE_qualcommax_ipq60xx_DEVICE_jdcloud_re-cs-02=y\nCONFIG_USE_LLVM_HOST=y\nCONFIG_NEED_BPF_TOOLCHAIN=y\nCONFIG_DWARVES=y\n');
  const before=parseConfig(read(path.join(root,'config','plus-original.config')));
  const after=parseConfig(actual);
  const changed=[...new Set([...before.keys(),...after.keys()])].filter(k=>before.get(k)!==after.get(k))
    .map(k=>`${k}: ${before.get(k)??'absent'} -> ${after.get(k)??'absent'}`);
  fs.writeFileSync(path.join(reports,'config-changes.txt'),changed.join('\n')+'\n');
  console.log('Required config, target, toolchain and PLUS packages verified.');
}
fs.mkdirSync(reports,{recursive:true});
const mode=process.argv[2];
if(mode==='sources') {
  for(const [name,obj] of [['source',lock.firmware],['builder',lock.builder]]) {
    if(!/^[\w.-]+\/[\w.-]+$/.test(obj.repo)||!/^[a-f0-9]{40}$/.test(obj.commit)) throw new Error('Invalid source lock');
    console.log([name,`https://github.com/${obj.repo}.git`,obj.commit,obj.path||''].join('\t'));
  }
} else if(mode==='feeds') {
  assertRevision(source,lock.firmware.commit);
  const passwall=lock.external.find(p=>p.name==='passwall_packages');
  const feeds=[...lock.feeds,{name:passwall.name,repo:passwall.repo,commit:passwall.commit}];
  for(const p of feeds) {
    if(!/^[\w-]+$/.test(p.name)||!/^[\w.-]+\/[\w.-]+$/.test(p.repo)||!/^[a-f0-9]{40}$/.test(p.commit)) throw new Error('Invalid feed pin');
  }
  fs.writeFileSync(path.join(source,'feeds.conf.default'),feeds.map(p=>`src-git ${p.name} https://github.com/${p.repo}.git^${p.commit}`).join('\n')+'\n');
  fs.copyFileSync(path.join(root,'source-lock.json'),path.join(reports,'source-lock.json'));
} else if(mode==='customize') {
  assertRevision(upstream,lock.builder.commit);
  for(const p of [...lock.feeds,lock.external.find(p=>p.name==='passwall_packages')]) assertRevision(path.join(source,'feeds',p.name),p.commit);
  const baseline=path.join(root,'config','plus-original.config');
  if(hash(baseline)!==lock.original_config_sha256) throw new Error('Original PLUS config checksum changed');
  const makefile=path.join(source,'feeds','packages','net','daed','Makefile');
  if(hash(makefile)!==lock.daed.makefile_sha256) throw new Error('daed package definition changed');
  const patched=patchPackages(read(path.join(upstream,'Scripts','Packages.sh')),lock.external);
  fs.writeFileSync(path.join(reports,'Packages.pinned.sh'),patched.replace(/\r\n/g,'\n'));
  if(!fs.existsSync(path.join(source,'feeds','luci','applications','luci-app-daed','Makefile'))) throw new Error('Pinned LuCI feed has no daed app');
  fs.writeFileSync(path.join(source,'.config'),mergeConfig(read(baseline),overlay()));
  const init=path.join(source,'files','etc','config');
  fs.mkdirSync(init,{recursive:true});
  fs.writeFileSync(path.join(init,'daed'),"config daed 'config'\n\toption enabled '0'\n\toption listen_addr '0.0.0.0:2023'\n\toption log_maxbackups '1'\n\toption log_maxsize '5'\n");
} else if(mode==='normalize') {
  fs.writeFileSync(path.join(source,'.config'),mergeConfig(configuration(),overlay()));
} else if(mode==='verify-config') {
  verifyConfig();
} else if(mode==='verify-artifacts') {
  verifyConfig();
  const targets=fs.readdirSync(path.join(source,'build_dir'),{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('target-'));
  const kernels=[];
  for(const target of targets) {
    const td=path.join(source,'build_dir',target.name);
    for(const platform of fs.readdirSync(td,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('linux-qualcommax_ipq60xx'))) {
      const pd=path.join(td,platform.name);
      for(const k of fs.readdirSync(pd,{withFileTypes:true}).filter(d=>d.isDirectory()&&/^linux-\d/.test(d.name))) {
        if(fs.existsSync(path.join(pd,k.name,'vmlinux')))kernels.push(path.join(pd,k.name));
      }
    }
  }
  if(kernels.length!==1)throw new Error(`Expected one built kernel, found ${kernels.length}`);
  const kernelDir=kernels[0];
  requireKernel(read(path.join(kernelDir,'.config')));
  fs.copyFileSync(path.join(kernelDir,'.config'),path.join(reports,'linux.config'));
  const sections=run('readelf',['-SW',path.join(kernelDir,'vmlinux')]);
  requireBtf(sections);
  fs.writeFileSync(path.join(reports,'vmlinux-sections.txt'),sections);
  const bin=path.join(source,'bin','targets','qualcommax','ipq60xx');
  const images=fs.readdirSync(bin).filter(n=>n.endsWith('-jdcloud_re-cs-02-squashfs-sysupgrade.bin'));
  const manifests=fs.readdirSync(bin).filter(n=>n.endsWith('.manifest'));
  if(images.length!==1||manifests.length!==1)throw new Error('Expected one sysupgrade image and one manifest');
  const image=path.join(bin,images[0]);
  const metadataFile=path.join(reports,'firmware-metadata.json');
  run(path.join(source,'staging_dir','host','bin','fwtool'),['-i',metadataFile,image]);
  const metadata=JSON.parse(read(metadataFile));
  const fit=run('tar',['-xOf',image,'sysupgrade-jdcloud_re-cs-02/kernel'],{encoding:null,maxBuffer:64*1024*1024});
  requireFirmware(fit,metadata,lock.kernel_limit_bytes);
  const kept=read(path.join(root,'config','original.manifest')).trim().split(/\r?\n/).map(line=>line.split(' - ')[0]);
  requireManifest(read(path.join(bin,manifests[0])),[...kept,'daed','luci-app-daed','daed-geoip','daed-geosite','kmod-sched-bpf','kmod-xdp-sockets-diag','kmod-veth'],lock.daed.version);
  const report={result:'STATIC_BUILD_CHECKS_PASSED',hardware_tested:false,real_partition_size_confirmed:false,
    kernel_bytes:fit.length,source_layout_limit_bytes:lock.kernel_limit_bytes,image:images[0],sha256:hash(image),
    caveat:'Not a flash approval. Confirm the actual device partition sizes, backup and recovery path before flashing.'};
  fs.writeFileSync(path.join(reports,'build-verification.json'),JSON.stringify(report,null,2)+'\n');
  // Nothing is copied to the firmware artifact directory until every guard passed.
  fs.mkdirSync(deliver,{recursive:true});
  fs.copyFileSync(image,path.join(deliver,images[0]));
  fs.copyFileSync(path.join(bin,manifests[0]),path.join(deliver,manifests[0]));
  for(const name of fs.readdirSync(bin).filter(n=>n.endsWith('.buildinfo')))fs.copyFileSync(path.join(bin,name),path.join(deliver,name));
  fs.writeFileSync(path.join(deliver,'sha256sums.txt'),`${report.sha256}  ${images[0]}\n`);
  fs.copyFileSync(path.join(reports,'build-verification.json'),path.join(deliver,'build-verification.json'));
  console.log(JSON.stringify(report,null,2));
} else {
  throw new Error('Unknown command: '+mode);
}
