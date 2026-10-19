# How I document my lab work

I run a home lab of training and storage servers like a production site: if it is not written down, it did not happen.

**Records first.** Before I touch a machine I read its build record, and after I touch it I update that record. The record is the source of truth, not my memory. When a fact changes, I keep the old version beside the new one.

**Serial numbers before device names.** Linux names like `/dev/sda` can change after a reboot or a cable move. I identify every drive, card and network port by its serial number or permanent ID first, and treat the device name as valid for one boot only. I also check by eye that a port number really is the connector I think it is.

**A change record for every change.** Each change gets a short record: what and why, the risk, the plan, how to roll it back, how I will test it, who approved it and what happened. I keep a copy of every file before I edit it, and I fingerprint important files with a checksum before and after.

**Measure before and after.** I take a "before" reading (versions, temperatures, speeds) and the same "after" reading, and compare them line by line. A number I did not measure is marked as an estimate, never written as fact.

**Every failure written down.** When something breaks I record what I saw, the cause if I found it, the fix, and the proof that the fix works. I reproduce the fault first where I can. If I cannot find a cause, I record an open question instead of guessing.

This repository holds examples: runbooks, a change record and my server check scripts.
