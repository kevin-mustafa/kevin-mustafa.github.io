# Graphics card servers under full load: test report

**What:** measured results from running my two graphics card servers flat out on a 537 million parameter language model: how busy each card stayed, temperatures, power, the bottleneck I found and the fix.
**When:** 24 to 29 September 2026.

## 1. The hardware

| Machine | Processor | Graphics cards | Card power limit |
|---|---|---|---|
| Server 1 | AMD Ryzen 9 9950X3D | Two NVIDIA RTX 5080 | 450 W each |
| Server 2 | Intel Core i9-12900K | One NVIDIA RTX 4080 | 380 W |

A 10 Gbit/s fibre link joins the servers. During every test all fans and the liquid cooler pump ran at full, and a temperature guard read every card every 10 seconds, ready to stop the job. Afterwards I put the fans back on quiet curves.

**How I measured:** `nvidia-smi` sampled every card each second; a profiler recorded what each card was doing, millisecond by millisecond; a one second sampler logged processor, memory, disk and network. Throughput is tokens (word pieces) processed per second.

## 2. Each server on its own (24 September)

Three hour training runs, each server alone:

| | Server 1 (two RTX 5080) | Server 2 (RTX 4080) |
|---|---|---|
| Throughput | 41,399 tokens a second | 20,502 tokens a second |
| Hottest card | 64 and 66 C | 77 C |
| Peak power | 678 W (both cards plus processor) | 329 W (card) |
| Heat or power throttling | none | none |

Stepping the power limits up (Server 1: 360 to 450 W; Server 2: 320 to 380 W) did not change speed: the cards never drew near their limits.

## 3. All three cards on one job: the bottleneck (27 and 28 September)

Next I trained one model across all three cards. Each training step ends with every card sending its gradients (the corrections it has worked out) to the others and receiving the total, so all cards stay in step.

**Result: three cards ran slower than Server 1 alone.** 24,703 tokens a second, against 41,610 for Server 1 by itself at the same settings.

The card's own "busy" counter read 100 percent the whole time, but it counts waiting as busy. Power told the truth: median card power was only 97, 109 and 156 W. The profiler showed why:

| Share of each step (measured) | Card doing real work | Card waiting on the gradient exchange |
|---|---|---|
| First attempt | 33 to 40% | 60 to 67% |
| After tuning (16 bit gradients, larger steps, work balanced to each card's speed) | 72 to 74% | 25 to 28% |

Every step pushed 2.15 GB of gradients over the single link, which ran at line rate (peaks of 9.8 Gbit/s) each time. Tuning doubled throughput to 52,020 tokens a second, but like for like that was only 1.08 times Server 1 alone.

**Not the bottleneck (measured):** processors (Server 1 at 6.5 to 12.1 percent), system memory (7 to 11 percent used), drives (no reads: the data sat in memory), PCIe card slots, card power, and the fibre itself (light levels 11.2 dB inside the warning limit, zero errors or drops). The limit was the 10 Gbit/s standard.

## 4. The fix: stop the cards waiting on the network

I changed the design so each card trains its own copy of the model, and every 30 seconds the copies are averaged into one shared model in the background. The cards no longer stop each step to talk over the network.

I tested it with a two hour acceptance run against six set pass marks, with deliberate faults: killing a card's job, and freezing the averaging process for 60 seconds. The first run passed five; the miss was a pause caused by my own profiler, so I reran without it (29 September).

| Clean rerun, measured | Server 1 card 0 | Server 1 card 1 | Server 2 card |
|---|---|---|---|
| Busy, whole job | 99.41% | 98.96% | 98.88% |
| Lowest 10 minute window | 99.60% | 99.20% | 99.19% |
| Speed against the card's own best | 97.58% | 97.71% | 97.35% |
| Median power | 330 W | 295 W | 323 W |
| Longest pause between steps | 0.23 s | 1.13 s | 1.39 s |

All six marks passed. Killed jobs were training again after 18.03 s and 13.46 s gaps; during the 60 second freeze no card waited.

The shared model also reached the same quality as Server 1 alone 1.34 to 1.60 times sooner, and finished better (held out loss, the error on unseen data, 1.2392 against 1.2899).

## 5. Temperatures under load (measured peaks)

| Test | Server 1 card 0 (chip / hot spot) | Server 1 card 1 | Server 2 card |
|---|---|---|---|
| Three cards, tuned | 56 / 65.3 C | 58 / 65.7 C | 63 / 77.0 C |
| Server 1 alone | 57 / 67.2 C | 61 / 69.6 C | idle |
| Server 2 alone | idle | idle | 68 / 82.0 C |
| Two hour rerun | up to 61.0 / 70.4 C (both cards) | | 70.0 / 85.0 C |

The guard's stop limits were 87 C (chip) and 105 C (hot spot). It never triggered.

## 6. Not measured

Power at the wall, the fibre modules under load (read once at idle), and why Server 1 card 1 clocks 3 to 4 percent lower and runs warmer than card 0.

## 7. Lessons

- **Utilisation counters can mislead.** "100 percent busy" included waiting. Power draw and a profiler gave the real picture.
- **Find the one full resource.** Everything was mostly idle except the network link, so faster cards or higher power limits would have bought nothing.
- **Prove a fix with pass marks and injected faults,** not with one good run.
