# Change record: network drives moved back to Samba file sharing

| Field | Value |
|---|---|
| Date | 28 September 2026 |
| System | Media server: a Proxmox virtualisation host running a Windows 11 virtual machine and a small Linux container that serves files with Samba (the standard Windows file sharing protocol on Linux) |
| Change type | Normal change (planned, tested, with a rollback) |
| Requested by | The owner (me) |
| Approved by | The owner (me) |
| Status | Closed, successful |

## 1. Change summary

Replace the four Windows drive letters (M:, T:, N:, G:) that pointed at host folders through **virtiofs** (a way to hand host folders straight into a virtual machine) with ordinary **Samba network drives** on the same letters. Harden the Samba server, mount the host's data disks by their permanent IDs, and make the drives reconnect by themselves after any restart.

## 2. Reason for change

All four network drives disappeared from Windows. I needed a permanent fix, not a reconnect.

What I found when I investigated:
- The drives were not Samba drives at all. They were virtiofs drives. They worked for twelve days, and still worked after the host updates. From the next morning onwards the Windows side started, hung and never made a drive, with no error. A Windows Update restart then killed all four virtiofs processes on the host, which stay dead until the virtual machine is fully stopped and started. I could not identify why the Windows side began hanging.
- **A security problem beside it:** virtiofs ran as the root (administrator) user on the host with no user mapping. That gave Windows root level write access to the folder holding my **backup repository**, the only other copy of my photographs.

## 3. Risk and impact

| Item | Assessment |
|---|---|
| Users affected | One (me). Drives unavailable during the work. |
| Risk to data | Low. No data moved. Only configuration files changed, each copied first. |
| Main risks | A wrong line in the disk mount file (`/etc/fstab`) stopping the host from booting; Windows refusing the stricter Samba settings; the backup folder being exposed again. |
| Controls | `nofail` on every mount so a missing disk cannot stop the boot; `findmnt --verify` to check the mount file before any reboot; old copies of every changed file kept; the virtual machine's identity settings compared before and after every step. |
| Benefit | Drives that survive restarts; the backup folder no longer reachable from Windows. |

## 4. Plan

1. **Samba server (container):** require SMB version 3 (was 2), make message signing mandatory, keep the named user and no guest access, and hide the backup folder from every share now and in any future share (`veto files` in the global section). Keep the old file as `smb.conf.before-change`.
2. **Host:** change the four data disks in `/etc/fstab` from mounting by label to mounting **by UUID** (a permanent ID), with each disk's serial number written as a comment beside its line. Add `nofail` to all five lines. Check with `findmnt --verify`, then `systemctl daemon-reload`. Keep the old file as `fstab.before-change`.
3. **Start order:** the file sharing container starts first, the Windows virtual machine second, 30 seconds later.
4. **Windows:** disable and stop the five virtiofs services. Map M:, T:, N: and G: over Samba as persistent drives, using the credential already saved in Windows Credential Manager (no password typed or stored anywhere new). Add a scheduled task that runs at every sign-in and whenever the network connects: it waits up to about three minutes for the server, keeps drives that work, re-maps any that are missing, and writes a log.
5. **Virtual machine settings:** remove the four virtiofs devices.

## 5. Rollback plan

- Samba: copy `smb.conf.before-change` back and restart Samba.
- Host mounts: copy `fstab.before-change` back, `systemctl daemon-reload`.
- Virtual machine: add the four virtiofs devices back with one `qm set` command (recorded in the change notes), then re-enable the Windows services.
- Trigger for rollback: the host fails to mount a data disk, or Windows cannot connect to Samba with the new settings.

## 6. Test

Three rounds, each harder than the last. Pass means all four drives come back **by themselves** with no action from me except signing in.

| Round | What | Drives after sign-in |
|---|---|---|
| 1 | Windows restart | 4 of 4 back by themselves |
| 2 | Full virtual machine stop and start (virtiofs devices now removed) | 4 of 4 back by themselves |
| 3 | Full host reboot | 4 of 4 back by themselves |

In every round I checked: all four drives connected, their sizes correct (14,902 / 7,450 / 5,544 / 3,724 GB), **the backup folder not visible**, and the connection using SMB 3.1.1 with AES-128-GMAC signing. After the host reboot, every checked line on the host matched the before picture: disks mounted by UUID on the same serials, the mount file, no failed services, Samba settings, the virtual machine's identity settings and the backup folder's entry.

## 7. Approval

Approved by the owner (me) before work started, after reading the plan and rollback above. The host reboot in round 3 was a separate go-ahead given at that point.

## 8. Result

**Successful.** The drives came back in my open Windows session during the work and passed all three test rounds.

Follow-ups written down, not done as part of this change:
1. Windows has no automatic sign-in, so the network drives only appear after I sign in. Automatic sign-in would store my Windows password on the machine, so I left it off on purpose.
2. The four old virtiofs folder mappings still exist on the host but are used by nothing. One of them would expose the backup folder again if ever attached to a virtual machine. Recommendation: delete at least that one.
3. One more share has no drive letter, because I never used it from Windows.

Records updated: the server's build record, the task record and this change record. Old copies of every changed configuration file are kept beside the new ones.
