# OpenCare demo video: narration script

Main cut, 3:29.2 long. Record every line in one voice memo, top to bottom, with about 2 seconds of silence between lines. If you flub a line, pause and say the whole line again; the last take is kept. Put the memo at `video/vo_omar/memo.m4a`; it gets split into lines and checked against this script.

The edit trims the silence around each take and places it at its timecode. If a take runs long, the edit stretches the shot before the next politician instead of talking over them. The build refuses to export if any narration overlaps a politician speaking (0.7 s clear before, 0.5 s after).

Tone: calm documentary, a little dry. Don't rush; there is room.

| Line | Starts at | Over this picture | Say |
| --- | --- | --- | --- |
| L01 | 0:07.1 | Crash aftermath (Veo) | John Doe survived the crash. |
| L02 | 0:15.6 | John in a hospital bed with the bill | Then came the bill. Four hundred and fifty-six thousand dollars. |
| L03 | 0:20.5 | John in a hospital bed with the bill | In America, one bad night can cost you everything you have. |
| L04 | 0:25.3 | Snowy Toronto, your team photos | We're a team from Canada. Back home, John's night ends with a cast and a ride home, not a bill. Watching Americans go through this, we kept asking: why? |
| L05 | 0:36.9 | Protest: "Everyone in, nobody out" | And we're not the only ones asking. |
| L06 | 1:07.3 | Protest: "RIP Aetna denied my claim" | Medicare for All has become one of the biggest fights in American politics. |
| L08 | 1:24.9 | Close-up of the real CareCard | So we built that card. And a way to pay for it. |
| L09 | 1:40.7 | Funding diagram | OpenCare's community fund is designed to be paid for like a public good. Nonprofit hospitals already owe their communities charity care to keep their tax exemption. Public programs, like Massachusetts' Health Safety Net, pay in. And anyone can donate. |
| L10 | 1:57.2 | John at the hospital desk (Veo) | Back at the hospital, John doesn't fill out a single form. |
| L11 | 2:09.4 | Your real tap on the kiosk phone | He taps his CareCard. OpenCare runs the bill through every assistance policy the hospital offers, and takes off a hundred and forty-six thousand dollars. What's left goes to the community fund, in one tap. |
| L12 | 2:30.1 | Admin: queue, flagged case, John's case, approve | On the other side, a real person reviews every request. Everyone is eligible; a published need formula only decides who's seen first. Each case comes with a brief and red flags, like instructions someone hid in a bill to trick the AI. The AI advises. A human decides. |
| L13 | 2:50.5 | Admin "Decided": Paid + Nessie card | One click, and the fund pays the hospital directly, through Capital One's Nessie banking API. |
| L14 | 2:56.6 | Solana explorer receipt | Every payment gets a receipt on the Solana blockchain. Public, permanent, and with no patient data on it. |
| L15 | 3:04.8 | Public ledger, case OC-8B87 | Billed: four hundred and fifty-six thousand. Left for John to pay: zero. |
| L16 | 3:13.2 | Landing page, the 3 figures | Insurance. The hospital. The community. Every source of help, in order, until the bill hits zero. |
| L17 | 3:23.3 | End card | OpenCare. Care for all. |

## Politicians speaking (no narration here)

- 0:39.6 to 0:49.4: Bernie: cancer and bankruptcy
- 0:49.4 to 0:55.8: AOC: Elmhurst treats everyone
- 0:58.8 to 1:06.8: Bernie: over 60% support Medicare for All
- 1:11.6 to 1:20.5: Abdul: "imagine you had another card"
- 1:20.5 to 1:24.4: Abdul: "no premium, no copay, no deductible"
- 1:28.6 to 1:40.2: Bernie: "health care should be funded that way"

## Notes

- The kiosk's discount step on screen says "AI is checking your bill", but those three discounts are scripted for the demo, so the narration says "OpenCare runs the bill through every assistance policy" rather than claiming live AI there.
- John's decision brief says **standard template** in the admin drawer, so the narration doesn't say Gemini wrote it. Add a Gemini line only if you can point to a case whose brief says "written by Gemini, numbers checked".
- Rebuild once your takes are in: `python build.py --vo omar` (about 10 minutes).
