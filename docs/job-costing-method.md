# Job costing method: what a token costs in my home lab

**What:** how the job costing page works out the cost of a token in my home lab: the jobs, the cost pools, the formulas, the assumptions and their sources, the period statements and their checks.
**When:** prices as at 20 October 2026; model version 1.0.

## 1. The jobs being costed

Three jobs, each costed like a job in a factory:

| Job | Unit of output | Machines today |
|---|---|---|
| Training a language model | tokens trained (537M model; 1B in 8-bit) | Server 1 (two RTX 5080) and Server 2 (RTX 4080) |
| Writing training data | kept tokens: written and passed the checks (86 percent kept) | Server 1 and Server 2 |
| Answering questions | tokens served (gpt-oss-20b) | one RTX 5080 in Server 1, or the M5 Max laptop |

Each job is costed today and under up to 15 alternatives: software changes, a cheaper power plan, the planned third training server (PC5, parked: test first, nothing bought), a card swap in the storage server, renting cards, and buying tokens from an API.

## 2. Cost pools

- **Machine cost:** depreciation down to an end value, the cost of money tied up, and upkeep. Today's machines are costed at what they would sell for (the indicative resale estimate of 20 Aug 2026), which is the cost of keeping rather than selling them; new parts at their price.
- **Electricity:** wall power measured by smart plugs, times the flat rate with GST.
- **Rent or API price:** a seller's price, converted at the Reserve Bank rate, plus 10 percent GST and extras. Storage while stopped and data transfer are not included.
- **Lab services** (storage server, network, monitoring) are a separate cost pool and are not spread over the tokens.

## 3. Formulas

- Machine cost an hour = machine cost × (depreciation down to the resale value over the life + cost of money on the average amount tied up + upkeep) ÷ hours a year. At the defaults: cost × 0.3088 a year ÷ 7,000 hours.
- Electricity an hour = kW × cents a kWh × (1 + cooling).
- Rent an hour = cards × US$ price × A$ per US$ × (1 + GST and extras).
- Cost per token = cost an hour ÷ tokens an hour.
- Whole lab after a change = (today's cost an hour + the added cost an hour) ÷ (today's tokens an hour + the added tokens an hour). The reference is today's machines for training, and today's machines batched for writing data and answering questions.
- Per word = per token ÷ 0.75; per parameter = 20 × the cost per token, for a compute optimal run.

Upgrades are shown two ways: the added capacity alone, and the whole lab after the change. Bridges (waterfalls) run from today to the whole lab after the change, part by part: machine cost, electricity, rent, and speed.

## 4. Kinds of number

| Kind | Meaning |
|---|---|
| Measured | measured on the lab by a meter, sensor or log |
| My record | my own record: a bill, invoice or order |
| Quoted | a seller's price on a date |
| Published | a published figure: a benchmark, price list or paper |
| Estimate | an estimate: an assumption, said so |
| Computed | computed from the other figures |

## 5. Assumptions

| Setting | Default | Kind | Source or note |
|---|---|---|---|
| Electricity, cents a kWh | 36.08 c | My record | the lab's flat rate with GST, September 2026 |
| Cheaper flat plan, cents a kWh | 24.057 c | Published | cheapest flat market offer seen for the Energex area, 20 Oct 2026 |
| Hours a year each machine works | 7,000 | Estimate | the lab's own planning figure; measured use in the 15 days to 14 Oct was about 730 hours a year |
| Years of useful life | 3 years | Estimate | planning figure; the tax office's effective life for desktops and servers is 4 years |
| Resale value at the end, share of cost | 30% | Estimate | planning figure |
| Cost of money a year | 7% | Estimate | planning figure, on the average amount tied up |
| Upkeep a year, share of cost | 3% | Estimate | planning figure |
| Extra power for air conditioning | 0% | Estimate | 0 when the room is not cooled; 15 to 28 percent when it is (from registered air conditioner ratings) |
| A$ per US$ | 1.4337 | Published | Reserve Bank of Australia, 19 Oct 2026 (A$1 = US$0.6975) |
| Words per token | 0.75 | Published | OpenAI's guidance for English text, about 0.75 |
| Training tokens per parameter | 20 | Published | compute optimal training, Hoffmann et al. 2022 (Chinchilla) |
| Share of written text kept after checks | 86% | Measured | the lab's six hour generation bench, 16 Oct 2026 (86 percent on the PCs) |
| Speed gain from FP8 training | 18% | Estimate | published gains at about 0.5B parameters are 18 to 27 percent, a cautious case 10 percent; untested here |
| Price fall after waiting a year | 1.00 | Estimate | 1.0 means no change; at most about 1.14 if card prices fall back to launch prices; no new consumer cards are expected before 2028 |
| Cost of today's machines | what they would sell for | Estimate | 1: what they would sell for (indicative resale, 20 Aug 2026), the cost of keeping rather than selling them; 0: replacement cost new |
| GST and extras on rented cards and API tokens | 10% | Published | GST is 10 percent on overseas digital services; storage while stopped and data transfer cost more |

## 6. Results at the defaults

| Job | Today | Best A$0 change | PC5 as planned, added (whole lab after) |
|---|---|---|---|
| Training, 537M, A$ per billion tokens | A$4.31 | A$3.65 (FP8), A$3.66 (power plan) | A$4.55 (A$4.41) |
| Training, 1B, A$ per billion tokens | A$9.38 | A$7.95 (FP8) | A$10.09 (A$9.67) |
| Writing data, A$ per million kept tokens | A$0.84 | A$0.18 (batched) | A$0.19 (A$0.19) |
| Answering, A$ per million tokens | A$0.52 | A$0.15 (8 users at once) | A$0.17 (A$0.16) |

At measured use (about 730 hours a year instead of 7,000) training on today's machines costs A$24.68 per billion tokens. PC5 beats renting the same cards above 4,492 hours a year (51 percent of the year).

## 7. Period statements, 7 to 19 October 2026

The lab cost A$258.89 in 13 days. By function, idle capacity (machine cost of planned hours not worked) was A$152.72, 59 percent.

Training at standard cost was A$19.88 against A$155.06 actual. Standard is the cost at the planned hours and the measured speed; actual charges all of Server 1 and Server 2's cost for the 13 days to the work done.

| Variance | A$ |  |
|---|---|---|
| Idle capacity (machine cost of planned hours not worked) | +128.90 | adverse |
| Speed (log medians about 1.1 percent above the standard) | -0.12 | favourable |
| Electricity with no job attached | +6.40 | adverse |

About 4.32 billion tokens were trained after the held out loss went flat: an abnormal loss of about A$18.60 at standard cost.

## 8. Checks

| Check | Left | Right | Difference | Finding |
|---|---|---|---|---|
| PC5 parts list | 18 lines added up: A$10,008.55 | stated total: A$10,008.55 | 0.00 | classification error, no change to the total |
| Parts invoice, 21 Jul 2025 | five items added up: A$4,013.74 | invoice total: A$4,013.74 | 0.00 | agreed |
| Electricity rate | 32.8 cents before GST, times 1.1: 36.08 c | rate used: 36.08 c | 0.00 | agreed |
| Server 1 and Server 2 electricity, 7 to 19 Oct | smart plug meters: 49.202 kWh | jobs plus the remainder: 49.202 kWh | 0.000 | a finding: 36 percent of the metered electricity had no job attached |
| Training tokens, 29 Sep to 14 Oct | log lines, millions: 7,307.1 M | the job's saved counters, millions: 7,274.7 M | 32.4 | timing difference, explained |
| Check: capacity model against the measured speed | model, tokens a second: 67,795 | measured cluster: 67,794 | 1 | model check, not a reconciliation |

## 9. Fixed asset register

Deemed cost is the fair value, what each machine would sell for (20 Aug 2026), used in place of the price paid because most purchase invoices are incomplete. Depreciation runs over 3 years to a 30 percent end value. Tax depreciation is not shown: it starts from the price paid, needs assessable income, and the tax office's effective lives are 4 years for desktops and servers, 2 for laptops and 5 for network gear.

## 10. Limits

- Most speeds for cards I do not own are estimates from published figures, marked as such.
- Tokens are counted raw: with more islands training one shared model, each token is worth a little less (about 90 percent at 4 islands, 85 percent at 6, published estimate).
- The M5's hourly cost is its full cost per hour of use.
- These are findings, not purchase advice.

## 11. Sources

- [AER, default market offer 2026-27, final determination](https://www.aer.gov.au/system/files/2026-05/AER%20-%20Final%20determination%20-%20Default%20market%20offer%202026%E2%80%9327.pdf)
- [Energy Made Easy plan register: the cheapest flat plan seen](https://cdr.energymadeeasy.gov.au/alinta/cds-au/v1/energy/plans/ALI1164888MRE1%40EME)
- [Reserve Bank of Australia, table F11.1 exchange rates](https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv)
- [staticICE, RTX 5080 prices](https://www.staticice.com.au/cgi-bin/search.cgi?q=rtx%205080%2016gb%20-laptop%20-block%20-mobile%20-notebook&links=200)
- [staticICE, RTX 5090 prices](https://www.staticice.com.au/cgi-bin/search.cgi?q=rtx%205090%2032gb%20-laptop%20-block%20-mobile%20-notebook&links=200)
- [staticICE, RTX PRO 6000 prices](https://www.staticice.com.au/cgi-bin/search.cgi?q=rtx%20pro%206000&links=200)
- [staticICE, Radeon AI PRO R9700 prices](https://www.staticice.com.au/cgi-bin/search.cgi?q=r9700&links=200)
- [Scorptec, RTX 5080 at the lowest local price](https://www.scorptec.com.au/product/graphics-cards/nvidia/126954-ne75080019t2-gb2035s)
- [Vast.ai, marketplace prices (RTX 5090 page)](https://vast.ai/pricing/gpu/RTX-5090)
- [Vast.ai, billing: storage while stopped](https://docs.vast.ai/documentation/reference/billing)
- [RunPod pricing](https://www.runpod.io/pricing)
- [Lambda pricing](https://lambda.ai/pricing)
- [DeepInfra pricing](https://deepinfra.com/pricing)
- [OpenRouter, gpt-oss-20b](https://openrouter.ai/openai/gpt-oss-20b)
- [Anthropic, Claude API pricing (Haiku 5.5, prompts up to 100,000 tokens)](https://platform.claude.com/docs/en/about-claude/pricing)
- [ATO, final guidance on effective life](https://www.ato.gov.au/businesses-and-organisations/business-bulletins-newsroom/final-guidance-effective-life-of-assets)
- [Effective life determination 2025](https://www.legislation.gov.au/F2025L01097)
- [Hoffmann et al. 2022, compute optimal training (Chinchilla)](https://ar5iv.labs.arxiv.org/html/2203.15556)
- [Kaplan et al. 2020, scaling laws](https://arxiv.org/pdf/2001.08361)
- [llm.c, GPT-2 reproduction](https://github.com/karpathy/llm.c/discussions/481)
- [LLMQ, lower precision pretraining on consumer cards](https://arxiv.org/pdf/2512.15306)
- [DiLoCo, low communication training](https://arxiv.org/html/2311.08105v3)
- [Epoch AI, trends in GPU price performance](https://epoch.ai/publications/trends-in-gpu-price-performance)
- [Epoch AI, inference price trends](https://epoch.ai/data-insights/ai-inference-price-trends)
- My electricity bill, Sep 2026 (private)
- My lab's measurements: meters, logs and benches (private)
