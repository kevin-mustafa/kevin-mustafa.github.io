# Tracing a storage link fault

**Machine:** my media and file server, an older Intel Z97 board running Proxmox (a virtualisation host that runs several virtual machines on one computer). It holds six SATA drives on the board's single SATA controller, and its graphics card is handed directly to a Windows virtual machine.

**When:** early September 2026, closed on 9 September 2026.

## 1. Symptom

Two hard drives, a Seagate 8 TB and a Seagate 4 TB, were logging interface CRC errors. A CRC error (cyclic redundancy check) means data arrived over the cable between the drive and the board damaged, so it had to be sent again. At the same time the Linux kernel log showed SATA link messages: the operating system was seeing the connection to the drives misbehave.

Nothing had been lost, but a storage link that keeps erroring is a fault waiting to become data loss, so I treated it as a live fault until proven otherwise.

## 2. What I checked, in order

I changed one thing at a time and wrote down the time of each change, so every result could be tied to a single cause.

| Step | What I did | Result |
|---|---|---|
| 1 | Swapped the SATA data cables | Errors did not stop |
| 2 | Checked power: every drive on its own straight power lead from the power supply, no Molex to SATA adapters, leads spread across different lines | Power wiring clean |
| 3 | Forced the affected SATA ports to slower link speeds (3.0 Gbps, then 1.5 Gbps) with a kernel boot setting, 3 September | Did not cure it |
| 4 | Turned the IOMMU off, 5 September, 09:07 | Counters stopped moving |
| 5 | Turned the IOMMU back on in passthrough mode, 5 September, 10:46 | Counters still frozen: the fix |

The usual first suspect for CRC errors is the cable, which is why step 1 came first. When new cables did not help, a hardware fault on the link became less likely and I started looking at software between the drives and memory.

## 3. How the cause was found

The IOMMU (input output memory management unit) is the part of the processor that controls how devices such as disk controllers reach system memory. It is what lets a virtual machine own a real device, like my graphics card, safely. It also sits in the path of every transfer the SATA controller makes.

From the moment the IOMMU was out of the path, the error counters never moved again. A test log I wrote at 09:56 on 5 September, inside that window, already showed the two drives' counters at 193 and 53, the same values they hold today.

That pointed at the IOMMU, but I could not simply leave it off: the graphics card passthrough to the Windows virtual machine needs it. The answer was passthrough mode, which keeps the IOMMU available for the virtual machines while the host's own devices, including the SATA controller, reach memory without going through its translation.

## 4. The fix

One kernel boot setting on the Proxmox host:

```
intel_iommu=on iommu=pt
```

The `iommu=pt` part is the cure. It was installed on 5 September 2026 at 10:46. The slower link speed settings from step 3 are no longer on the boot line.

## 5. Proof it was fixed

Error counters are lifetime totals, so a non zero number on its own proves nothing. What matters is whether the number moves.

I ran an overnight watch that read the CRC counters of the three drives that carried any count 140 times between 22:36 and 10:12 the next morning. That window included a live 63 GB file copy and about twelve hours of normal running. Every one of the 140 readings returned exactly the same three values (193, 2 and 53), which I checked by sorting the readings and confirming only one unique line remained.

| Measure over the watch | Change |
|---|---|
| Drive power on hours | +12 |
| CRC error counters | +0 |

I closed the case on 9 September with a written rule for reopening it: a counter that moves, not the presence of the old historical count.

## 6. Lessons

- **Watch the change, not the total.** A CRC counter of 193 looks alarming, but it was history. The test is whether it grows under load.
- **One change at a time, with timestamps.** Because each step was logged with its time, a log written at 09:56 could be placed exactly between two changes, and that is what identified the cause.
- **The obvious suspect is not always the cause.** Cables are the right first check for CRC errors, but here the cable swap was not the fix.
- **Know the cost of a boot setting change.** This machine later lost its remote console. A bad edit to the boot line could then only be recovered by someone standing at it, so I recorded that the setting must not be touched without a console attached.
