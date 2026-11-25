# Test price files

46 import files for the save strategy. The import reads the slot length from the file and updates **Price slot length** to match (the file name shows it, e.g. `G0.5` = 30 min).

**Import** is the result of the system's real import code (in-memory database, setting starting at 30 min). The strategy details come from the strategy engine with charge 300 min and discharge 240 min; other durations give other windows. The table shows the merged phases (FLAT left out); the stored strategy and the export have one record per price row (e.g. 24 for hourly prices). No profit is shown: the plan is chosen by composition, not by a score.

## Coverage

| Rule or option | Files |
|---|---|
| Slot length 15 / 30 / 60 min, read from the file | C5, C6, E1, E2 · A1–B6 · C1, C3, E3, F1 (every import starts from a 30-min setting) |
| Unsupported or mixed slot length is rejected | G7, G8 |
| Continuity, coverage 00:00–24:00, duplicate slots | E5, G9, G10 |
| Wrong format, empty file, non-Excel file | E6, F2, F3 |
| File formats .xlsx / .xls / .csv, Excel date cells, unsorted rows | all · F5 · F6 · G6 |
| Multi-day batch, 1000+ rows, month boundary | D6, E4 · F4 · G5 |
| Single price tier → not executed, one 00:00–24:00 FLAT row | D1, E4 (last day) |
| Two price tiers → no FLAT | D2 |
| One discharge (plan A) with the tail reservation: discharge ends before the last P hours, charge = last P hours | A3, B6 · A2, C1 (blocked, plan B wins) |
| Two discharges (plan B): gap > 2 h, exactly 2 h, under 2 h | B1, B2, B4 · B5 · B6 |
| Two discharges with one charge / two charges | B4, B5, D3 · A1, B1, B2 |
| Shapes C-D-C-D, D-C-D-C, 2D+1C | B1, G1, B4 |
| Exactly one discharge between two charges (C-D-D-C rejected) | A1, B2, E3 |
| Two charges need a gap > 2 h | G2 |
| Tail handling (two discharges reach 24:00): gap ≥ 4 h → second moves 2 h, last 2 h charge (not in M); M sits between the discharges | C2, C4 |
| Tail handling infeasible (M cannot fit between the discharges) → one discharge | C3, G3 |
| Step 3.5: first non-FLAT stage from 24:00 back is a discharge → the last slot charges | A1, A2, A3, A6, B1, B2, B4, B5, B6, C1, C3, C4, C5, C6, D3, D4, D5, D6, E1, E2, E3, E4, F1, F4, F5, F6, G2, G3, G5, G6 |
| Ties (earliest window wins) | A5 |
| Negative prices, very small spreads | D5 · D4 |
| Design doc tests TC004, ET001, ET002, ET007, PT003 | F1, F2, F3, D1, F4 |

Design doc V1 rules (§2.7.1.9) plus the team answers: the plan is chosen by composition (the larger discharge price sum wins, then the cheapest charge for it; no score). One discharge ends before the last P hours (P = configured charge duration, here 5 h) and its charge is the cheapest window; two discharges that reach 24:00 move 2 h earlier (only the second if the gap is 4 h or more, otherwise both) and the last 2 h charge on top of M; if, going back from 24:00, the first non-FLAT stage is a discharge, the last slot charges; a single-tier day is one FLAT row.

## A · Classic tariffs

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| A1_tiered-tariff_G0.5.xlsx | 30 min | Tiered tariff: valley 00–06, peaks 06–09 and 18–22 | Baseline, same as the downloadable sample | Import OK: 96 rows (106 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |
| A2_evening-peak_G0.5.xlsx | 30 min | Night valley 00–07, single evening peak 17–22 | Evening peak lies in the reserved last 8 h, so one discharge cannot use it; two discharges win | Import OK: 96 rows (24 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 07:00–07:30, PEAK 17:00–20:30, LOW 23:30–24:00 |
| A3_midday-peak_G0.5.xlsx | 30 min | Single midday peak 10–15, valleys at night and evening | Tail reservation: one discharge before 16:00, charge = last 8 h (16:00–24:00) | Import OK: 96 rows (18 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 10:00–14:00, LOW 23:30–24:00 |
| A4_morning-peak_G0.5.xlsx | 30 min | Morning peak 07–11, cheap afternoon 13–17 | Charge after the discharge (discharge first) | Import OK: 96 rows (17 ms)<br>All 2 days: plan A, 1 charge(s) — PEAK 07:00–11:00, LOW 12:00–17:00 |
| A5_long-plateau_G0.5.xlsx | 30 min | Long high plateau 08–21 at one price, valley elsewhere | Ties: earliest window wins inside a flat plateau | Import OK: 96 rows (16 ms)<br>All 2 days: plan A, 1 charge(s) — LOW 00:00–08:00, PEAK 08:00–21:00, LOW 21:00–24:00 |
| A6_linear-ramp_G0.5.xlsx | 30 min | Price rises steadily from 0.20 to 1.12 over the day | No clear tiers; last-hour rule at the top of the ramp | Import OK: 96 rows (26 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 15:00–19:00, LOW 23:30–24:00 |

## B · Two cycles

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| B1_two-peaks-midday-valley_G0.5.xlsx | 30 min | Peaks 08–10 and 18–21, valleys 00–06 and 12–16 | Alternating C-D-C-D | Import OK: 96 rows (17 ms)<br>All 2 days: plan B, 2 charge(s), last phase was a discharge → last slot charges — LOW 00:00–01:00, PEAK 08:00–10:00, LOW 12:00–16:00, PEAK 18:00–20:00, LOW 23:30–24:00 |
| B2_two-peaks-night-valley_G0.5.xlsx | 30 min | Peaks 07–10 and 17–21, one long night valley | Charges may not sit outside both discharges (C-D-D-C is not allowed) | Import OK: 96 rows (18 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 07:00–07:30, PEAK 17:00–20:30, LOW 23:30–24:00 |
| B3_two-valleys-one-peak_G0.5.xlsx | 30 min | Valleys 02–06 and 13–17, single peak 08–12 | One discharge cannot take two charges any more (charge = last P hours); two discharges win | Import OK: 96 rows (11 ms)<br>All 2 days: plan A, 2 charge(s) — LOW 02:00–06:00, PEAK 08:00–12:00, LOW 13:00–14:00 |
| B4_two-peaks-one-valley_G0.5.xlsx | 30 min | Valley 00–06, peaks 08–10 and 13–15 | 2D + 1C | Import OK: 96 rows (13 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 08:00–10:00, PEAK 13:00–15:00, LOW 23:30–24:00 |
| B5_peaks-2h-apart_G0.5.xlsx | 30 min | Peaks 09–12 and 14–17 (exactly 2 h gap) | Discharge gap boundary (≥ 2 h allowed) | Import OK: 96 rows (12 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 09:00–12:00, PEAK 14:00–15:00, LOW 23:30–24:00 |
| B6_peaks-1h-apart_G0.5.xlsx | 30 min | Peaks 09–12 and 13–16 (1 h gap) | Gap too small for two discharges there; one discharge, charge = last 8 h | Import OK: 96 rows (14 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 09:00–12:00, PEAK 14:00–15:00, LOW 23:30–24:00 |

## C · Last hour

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| C1_peak-to-midnight_G1.xlsx | 60 min | Valley 00–08, peak 17–24 | Peak up to 24:00: one discharge is blocked by the tail reservation; two discharges win | Import OK: 48 rows (11 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 17:00–18:00, PEAK 20:00–23:00, LOW 23:00–24:00 |
| C2_morning-and-late-peak_G0.5.xlsx | 30 min | Peaks 07–09 and 21–24, valley 00–06 | Tail handling, gap ≥ 4 h: the second discharge moves 2 h earlier, the last 2 h charge | Import OK: 96 rows (9 ms)<br>All 2 days: plan B, 2 charge(s), tail handling (last 2 h charge) — PEAK 07:00–08:00, LOW 11:00–16:00, PEAK 19:00–22:00, LOW 22:00–24:00 |
| C3_close-peaks-at-end_G1.xlsx | 60 min | Peaks 15–18 and 20–24 (2 h gap), highest at 22–24 | Gap < 4 h at the end: both discharges would move 2 h, but M (8 h) cannot fit between them (exactly one discharge between charges) → one discharge, plan A | Import OK: 48 rows (7 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 14:00–18:00, LOW 23:00–24:00 |
| C4_highest-at-23h_G0.5.xlsx | 30 min | Single spike at 23:00–24:00 | Spike at 23:00: discharge cannot keep it; tail handling or the tail reservation charges there | Import OK: 96 rows (11 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 15:00–19:00, LOW 23:30–24:00 |
| C5_late-peak_G0.25.xlsx | 15 min | 15-min prices, peak 20–24 | 15-min slots: the 2-hour tail shift is 8 slots | Import OK: 192 rows (26 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 07:00–07:15, PEAK 20:00–23:45, LOW 23:45–24:00 |
| C6_short-late-peak_G0.25.xlsx | 15 min | 15-min prices, short peak 22–24 only | Short peak at the end with 15-min slots: the tail reservation makes the plan charge in the expensive last hours | Import OK: 192 rows (17 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 07:00–11:00, LOW 23:45–24:00 |

## D · Tiers and edges

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| D1_single-tier_G0.5.xlsx | 30 min | Same price all day (0.50) | Single tier → not executed, the whole day is FLAT | Import OK: 96 rows (8 ms)<br>All 2 days: not executed (single price tier) — FLAT 00:00–24:00 |
| D2_two-tiers_G0.5.xlsx | 30 min | Only 0.30 and 0.90 (high 08–20) | Two tiers → no FLAT in the strategy | Import OK: 96 rows (9 ms)<br>All 2 days: plan A, 1 charge(s) — LOW 00:00–08:00, PEAK 08:00–20:00, LOW 20:00–24:00 |
| D3_three-tiers_G0.5.xlsx | 30 min | Valley 0.25 / flat 0.50 / peak 0.95 | Normal LOW/FLAT/PEAK labels | Import OK: 96 rows (7 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 10:00–14:00, LOW 23:30–24:00 |
| D4_tiny-differences_G0.5.xlsx | 30 min | Prices differ by 0.001 only | Algorithm still runs on very small spreads | Import OK: 96 rows (8 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |
| D5_negative-valley_G0.5.xlsx | 30 min | Negative prices 11–15 (solar surplus) | Negative prices accepted; charge there | Import OK: 96 rows (9 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — PEAK 00:00–00:30, LOW 10:00–15:00, PEAK 18:00–21:30, LOW 23:30–24:00 |
| D6_noisy-week_G0.5.xlsx | 30 min | 7 days, tiered tariff ±0.05 random noise | Each day planned independently | Import OK: 336 rows (18 ms)<br>2026-10-19: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00<br>2026-10-20: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:30–07:00, PEAK 18:30–22:00, LOW 23:30–24:00<br>2026-10-21: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 08:30–09:00, PEAK 18:00–21:30, LOW 23:30–24:00<br>2026-10-22: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 08:00–08:30, PEAK 18:00–21:30, LOW 23:30–24:00<br>2026-10-23: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 01:00–06:00, PEAK 08:00–08:30, PEAK 18:30–22:00, LOW 23:30–24:00<br>2026-10-24: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00<br>2026-10-25: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 08:30–09:00, PEAK 18:30–22:00, LOW 23:30–24:00 |

## E · Granularity and files

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| E1_quarter-hour-detail_G0.25.xlsx | 15 min | 15-min prices that change inside the hour | Windows can start at :15 / :45 | Import OK: 192 rows (13 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:45–07:00, PEAK 18:15–22:00, LOW 23:45–24:00 |
| E2_quarter-hour-tariff_G0.25.xlsx | 15 min | 15-min slots, tiered tariff (flat inside each hour) | G = 0.25: 96 slots per day, same plan as 30 min | Import OK: 192 rows (13 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:15, PEAK 18:00–21:45, LOW 23:45–24:00 |
| E3_hourly-tariff_G1.xlsx | 60 min | Hourly slots, tiered tariff | G = 1: 24 slots, 390 min rounds to 7 h | Import OK: 48 rows (9 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–07:00, PEAK 18:00–21:00, LOW 23:00–24:00 |
| E4_mixed-week_G0.5.xlsx | 30 min | 7 different day profiles incl. one flat day | Multi-day batch; one day not executed | Import OK: 336 rows (17 ms)<br>2026-10-19: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00<br>2026-10-20: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 07:00–07:30, PEAK 17:00–20:30, LOW 23:30–24:00<br>2026-10-21: plan B, 2 charge(s), last phase was a discharge → last slot charges — LOW 00:00–01:00, PEAK 08:00–10:00, LOW 12:00–16:00, PEAK 18:00–20:00, LOW 23:30–24:00<br>2026-10-22: plan A, 2 charge(s) — LOW 02:00–06:00, PEAK 08:00–12:00, LOW 13:00–14:00<br>2026-10-23: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 17:00–17:30, PEAK 19:30–23:00, LOW 23:30–24:00<br>2026-10-24: plan A, 1 charge(s) — LOW 00:00–08:00, PEAK 08:00–20:00, LOW 20:00–24:00<br>2026-10-25: not executed (single price tier) — FLAT 00:00–24:00 |
| E5_INVALID-missing-slot_G0.5.xlsx | 30 min | 10:00–10:30 missing on 2026-10-24 | Import must fail: slots not continuous | **Import fails:** parse failure for 2026-10-24: slot "10:30-11:00" breaks continuity (expected start 10:00) |
| E6_INVALID-wrong-format_G0.5.xlsx | 30 min | Date 2026/10/24, slot 00:00~00:30, price "abc" | Import must fail: wrong format | **Import fails:** wrong format in row 2: expected date YYYY-MM-DD, time slot HH:MM-HH:MM and a numeric price (got "2026/10/24", "00:00~00:30", "abc") |

## F · Design doc test data

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| F1_TC004-doc-example_G1.xlsx | 60 min | The design doc §2.7.1.6 example prices, 1 day, 24 records (2026-10-21) | TC004: 24 records, strategy generated automatically | Import OK: 24 rows (7 ms)<br>2026-10-21: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 08:00–09:00, PEAK 18:00–21:00, LOW 23:00–24:00 |
| F2_ET001-empty-file.xlsx | 30 min | Header row only, no data | ET001: empty file is rejected | **Import fails:** empty file |
| F3_ET002-invalid_format.txt | 30 min | Plain text file (invalid_format.txt) | ET002: wrong format is rejected | **Import fails:** wrong format in row 2: expected date YYYY-MM-DD, time slot HH:MM-HH:MM and a numeric price (got "It has no date", "time slot or price columns.", "") |
| F4_PT003-1008-rows_G0.5.xlsx | 30 min | 21 days × 48 slots = 1008 records | PT003: import 1000+ records (< 5 s) | Import OK: 1008 rows (62 ms)<br>21 days planned; first: 2026-10-01: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:30–05:30, PEAK 06:30–07:00, PEAK 18:00–21:30, LOW 23:30–24:00 |
| F5_xls-format_G0.5.xls | 30 min | tiered tariff saved as legacy .xls | §6.3: .xls files are accepted | Import OK: 96 rows (30 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |
| F6_csv-format_G0.5.csv | 30 min | tiered tariff as .csv | CSV import (date, time_slot, price) | Import OK: 96 rows (8 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |

## G · Rule edges and input checks

| File | Slot | Scenario | What it tests | Expected result |
|---|---|---|---|---|
| G1_discharge-first-alternating_G0.5.xlsx | 30 min | Peaks 04–06 and 13–15, valleys 08–10 and 18–21 | Alternating D-C-D-C (discharge first) | Import OK: 96 rows (10 ms)<br>All 2 days: plan B, 2 charge(s) — PEAK 04:00–06:00, LOW 08:00–10:00, PEAK 13:00–15:00, LOW 18:00–21:00 |
| G2_valleys-2h-apart_G0.5.xlsx | 30 min | Valleys 02–06 and 08–12 split by a peak 06–08 | Two charges need a gap > 2 h: the valleys are exactly 2 h apart, so the first charge must end earlier (05:30) | Import OK: 96 rows (13 ms)<br>All 2 days: plan B, 2 charge(s), last phase was a discharge → last slot charges — LOW 02:00–03:00, PEAK 06:00–08:00, LOW 08:00–12:00, PEAK 18:00–20:00, LOW 23:30–24:00 |
| G3_last-hour-gap-3h_G1.xlsx | 60 min | Peaks 14–17 and 20–24 (3 h gap), highest at 22–24 | Gap 3 h at the end: after both discharges move 2 h their price sum is below the single discharge, so plan A wins (composition) | Import OK: 48 rows (9 ms)<br>All 2 days: plan A, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 13:00–17:00, LOW 23:00–24:00 |
| G4_first-discharge-at-midnight_G1.xlsx | 60 min | Peaks 00–03 and 20–24, valley 06–14 | Tail handling with a discharge at 00:00 (gap ≥ 4 h: only the second moves) | Import OK: 48 rows (7 ms)<br>All 2 days: plan A, 1 charge(s) — PEAK 00:00–04:00, LOW 06:00–11:00 |
| G5_month-boundary_G0.5.xlsx | 30 min | 2026-10-30 to 2026-11-02, tiered tariff | Monthly export: two month sheets (2026-10, 2026-11) | Import OK: 192 rows (15 ms)<br>All 4 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |
| G6_unsorted-excel-dates_G0.5.xlsx | 30 min | Rows shuffled; dates stored as real Excel date cells | Row order and Excel date cells do not matter | Import OK: 96 rows (13 ms)<br>All 2 days: plan B, 1 charge(s), last phase was a discharge → last slot charges — LOW 00:00–05:00, PEAK 06:00–06:30, PEAK 18:00–21:30, LOW 23:30–24:00 |
| G7_INVALID-mixed-slot-lengths.xlsx | 30 min | Day 1 in 30-min slots, day 2 in 60-min slots | Import must fail: one slot length per file | **Import fails:** all price slots must have the same length; the file mixes 30, 60-minute slots |
| G8_INVALID-45min-slots_G0.75.xlsx | 45 min | 45-min slots (no longer supported) | Import must fail: slot length not 15/30/60 min | **Import fails:** price slots of 45 min are not supported; use 15, 30 or 60-minute slots |
| G9_INVALID-day-ends-23h_G0.5.xlsx | 30 min | 2026-10-24 stops at 23:00 | Import must fail: day does not reach 24:00 | **Import fails:** parse failure for 2026-10-24: slots do not cover 00:00-24:00 |
| G10_INVALID-duplicate-slot_G0.5.xlsx | 30 min | 12:00–12:30 appears twice on 2026-10-24 | Import must fail: duplicate slot | **Import fails:** parse failure for 2026-10-24: slot "12:00-12:30" appears twice |

Machine-readable results: `expected-results.csv`.
