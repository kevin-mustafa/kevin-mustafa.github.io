# Runbook: update the graphics card servers

**Machines:** Server 1 (two graphics cards) and Server 2 (one graphics card), Ubuntu Linux, NVIDIA graphics driver.
**Last run:** 13 October 2026, both servers, every check passed.

## Purpose

Bring both training servers up to date with security and package updates **without moving the NVIDIA driver or the machine learning software stack**, prove the NVIDIA driver module exists for any new kernel (the core of the operating system) **before** rebooting into it, and finish with the same measured baseline as before. Firmware, BIOS updates, a full Ubuntu release upgrade and restarting training are **not** part of this runbook.

## Before you start

**Safety**
- Training is paused only on a deliberate decision. Put a HOLD marker in every card's queue folder first, so no training job starts during the work.
- Server 1 goes first as the "canary": if something breaks, it breaks on one server, not both.
- Restart with a normal reboot over SSH. **Never cold power off Server 2.**

**What you need**
- SSH (secure shell) access to both servers with passwordless `sudo`.
- The remote console for each server (keyboard, video and mouse over the network), in case a server does not come back on its own.
- A folder for evidence: every command's output gets saved with a timestamp.

## Steps (Server 1 first, then Server 2)

1. **Inventory, read only.** Save the current kernel, the list of held packages, the list of packages waiting to upgrade, the NVIDIA and machine learning library versions, the network link speeds, the boot order and the fan state. Then run a dry run:
   ```
   sudo apt-get -s dist-upgrade
   ```
   **Expect:** no packages removed. **Check:** what it would change besides packages. On my last run the dry run showed it would also replace `dkms` (the tool that rebuilds the NVIDIA module for each kernel) with NVIDIA's own version in place of Ubuntu's. I chose to hold it.
2. **Set holds, refresh and simulate again.**
   ```
   sudo apt-mark hold dkms
   sudo apt-get update
   sudo apt-get -s full-upgrade
   ```
   **Server 2 only:** the signed NVIDIA module for any newer kernel needed a newer driver than the one I run. So on Server 2 I also hold the kernel packages:
   ```
   sudo apt-mark hold linux-generic linux-image-generic linux-headers-generic
   ```
   **Expect:** 0 to remove, the NVIDIA packages kept back. **If not:** any removal, or any NVIDIA package in the upgrade list, means stop and find out why.
3. **Run the upgrade as its own background service**, so a dropped SSH connection cannot kill it halfway:
   ```
   sudo systemd-run --unit=apt-full-upgrade /bin/bash ~/update/upgrade.sh
   ```
   The script logs the held packages before and after, runs `apt-get -y full-upgrade` keeping my existing config files, and writes the exit code. **Expect:** `apt-get exit 0`, the held list the same before and after. On my last run it took under a minute on each server. **If it fails:** read the log and do not reboot.
4. **Prove before the reboot (read only).** Check that:
   - `dkms status` shows the NVIDIA module installed for the new kernel;
   - the module file's version stamp matches the new kernel;
   - the new kernel's start-up image (initrd) exists;
   - the boot menu's first entry is the new kernel;
   - no training service was stopped or started by the upgrade.

   **Rollback trigger:** no NVIDIA module for the new kernel. Do not reboot into it. Set the boot menu default to the kernel that is running now, run `update-grub`, hold the kernel packages and write down why.
5. **Reboot over SSH.**
   ```
   sudo systemctl reboot
   ```
   **Expect:** Server 1 back on SSH in about 40 seconds, Server 2 in about 3 minutes (slow firmware). Server 2's 10 gigabit network card can be missing on a cold start; a small boot check service then does one warm restart by itself.
6. **Re-baseline.** Run the inventory again and compare it with step 1. **Expect:** the kernel as planned, the same NVIDIA driver version on every card, the machine learning library sees the cards, network links at 10,000 Mb/s, boot order unchanged, HOLD still in.
   Then a short load test: **set every fan and the liquid cooler pump to full first**, read them back, run 20 seconds of heavy maths on each card, then set the fans back to quiet. On my last run the cards measured 121.0 and 117.1 TFLOPS on Server 1 and 104.1 TFLOPS on Server 2 (trillions of calculations per second).
   **Rollback triggers:** `nvidia-smi` fails, the cards are not visible to the software, a network link below 10,000, or the server does not boot into Ubuntu.
7. **Restart check at HOLD.** After two minutes of uptime, run my restart check: every service up, fans in the right mode, cards reading HOLD as expected, network link speed correct.
8. **Write it down:** versions before and after, which packages were held and why, timings, and the load test numbers.

## How to check it worked

Every line of the step 6 inventory matches the plan, the step 7 restart check passes on both servers, and the load test numbers are in line with the baseline taken before the update.

## What to do if it fails

| What you see | Likely cause | Fix |
|---|---|---|
| SSH refused or timing out for minutes after the reboot | Slow firmware, a slow USB device, or the network card check doing its warm restart | Watch the remote console. Wait up to about 6 minutes. Never press power again while the screen shows it booting. |
| `dkms status` does not list the new kernel | The module build failed, or `dkms` changed | Keep the running kernel as the default (step 4). Read the build log under `/var/lib/dkms/nvidia/`. |
| The signed module for a new kernel wants a newer NVIDIA package | The vendor rebuilt its modules for a newer driver | Hold the kernel packages on that server. A newer kernel waits for a planned driver change. |
| The cards are missing after reboot | Booted into a kernel without the module | Boot the previous kernel from the boot menu, make it the default, hold the new kernel, record why. |

## Rollback

Boot the previous kernel (from the boot menu through the remote console if needed), make it the default, hold the new kernel's packages and record why. Other packages are not rolled back, because they are security updates. A single bad package is pinned to its old version only after a deliberate decision.

## What this run found

On my last run I also found that Server 2 had started and stopped several times over two days in a way my records did not show. I wrote that down as an open question, and a later job read its own logs to see how each of those boots had ended.
