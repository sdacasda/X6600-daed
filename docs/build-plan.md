# PLUS + daed cloud build

Design basis: docs/research.md and the user's selection of PLUS and GitHub Actions.
This repository changes an existing build flow; the router is never modified by CI.

- [x] Implement and test config merging, post-defconfig checks, Linux config/BTF checks, FIT size/device checks, and manifest checks in scripts/guards.mjs.
- [x] Freeze original builder, firmware source, external plugins and candidate standard feeds in source-lock.json. Original standard feed SHAs were not supplied; record selection provenance.
- [x] Add scripts/prepare.sh and scripts/build.mjs, reusing upstream scripts at their pinned revision; default daed to disabled, preserve PLUS selections.
- [x] Add manually dispatched config/firmware build modes on ubuntu-24.04, contents:read permissions, reports on failure and firmware artifacts only after verification.
- [x] Run local node:test, shell syntax and workflow structure checks. Independent review found a preservation gap, now fixed by checking all 547 selected package symbols and the original installed manifest.
- [ ] Run the Linux CI config mode, resolve actual feed/Kconfig issues, then full firmware compilation and artifact checks.
- [ ] Confirm actual device partitions and recovery path, then perform separately coordinated hardware tests.

Critical conditions: missing BTF, silently dropped options, wrong device, oversized kernel, incompatible daed/web version, unavailable pinned sources, and lost PLUS package selections stop the build. The 6 MiB layout limit is conservative until the user's partition sizes are known. No partition, bootloader, NSS runtime or router configuration changes are performed.
