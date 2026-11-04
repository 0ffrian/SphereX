# NASA Space Apps 2026: Team Handover

## 1. The competition

- **What:** NASA Space Apps Challenge, a global hackathon where teams use real NASA data to solve set challenges.
- **Our event:** Port Louis local event, 14 to 15 November 2026, Rajiv Gandhi Science Centre, Bell Village.
- **Teams:** 2 to 6 people.
- **Eligibility:** The local event lists ages 16 to 25. The global challenge has no upper age limit. Munazir (27) asked the local organiser for an exception and was accepted.
- **Rule to remember:** The official site says not to start building before the hackathon begins. Reading and learning about the data beforehand is fine.

## 2. Our challenge: Planet X and SPHEREx

- **Official difficulty:** Advanced (one of only two challenges labelled Advanced only).
- **Challenge statement (summary):** Since 2025, NASA's SPHEREx mission has mapped the whole sky every six months in 102 near-infrared bands, imaging over a billion objects. Comets, asteroids, brown dwarfs and possibly new planets show up by shifting position between images. Build a **public-facing web tool** that displays SPHEREx sky images and makes it easy for anyone to see how they change over time.
- **Link:** https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/

### Requirements, in plain words
1. Use real SPHEREx images.
2. Show how the sky changes over time.
3. Make it usable by the general public, with no astronomy knowledge needed.
4. It must be a web tool.

## 3. The data

- **Format:** FITS images (astronomy format; each pixel is a brightness value, not a colour).
- **Wavelengths:** 0.75 to 5.0 microns, 102 bands.
- **Releases:** Weekly. Use QR2 and QR3. QR1 was retired in Feb 2026.
- **Epochs:** About three full-sky scans so far, so only a few "before and after" pairs per spot.
- **Access (all free):**
  - IRSA (NASA/IPAC infrared archive): web Data Explorer, Python `astroquery`, Simple Image Access API
  - AWS bucket, no account needed: `s3://nasa-irsa-spherex` (e.g. `qr2/level2/`)
  - IRSA tutorial notebooks: https://irsa.ipac.caltech.edu/docs/notebooks/
- **Useful IRSA tools:** Spectrophotometry tool (spectrum at a position), cutout tools, Custom Mosaic tool.
- **Citation:** Each release has a DOI (QR2: 10.26131/IRSA652) and IRSA asks for an acknowledgement statement.

## 4. Competition from other teams

The global event already ran in October and some projects are public on GitHub. **SkyShift** (github.com/sreenath1212/skyshift-spherex) already has a blink comparator, time slider, wavelength slider and a "Planet X hunt" game. Most teams show pictures. We need to stand apart by **finding real objects in real data**.

## 5. Our concept: Rainbow Trails

**Core idea:** SPHEREx does not capture all 102 colours at the same moment. It images the same spot in different bands over several days. If we stack those images and colour each by its wavelength:
- Stars stay still, so all colours overlap and they look **white**.
- Moving objects leave a **rainbow dotted trail**, one dot per band.

**Why it works for the three goals:**
1. **Wow factor:** Live on stage, open a sky patch and movers light up as rainbow streaks. Click one: "Known asteroid, rocky surface".
2. **Intuitive:** No flipping or hunting. Moving things look different by default, and the trail also gives the object's spectrum (what it is made of).
3. **Discovery chance:** Cross-match every trail with known asteroid and star catalogues. Anything unmatched is a candidate. Best realistic target: a nearby **brown dwarf** (slow movement between six-month scans plus a distinctive spectrum).

**Must verify first:** The timing between band exposures on real data. The whole concept depends on it.

**Honest expectation:** A confirmed new discovery in one weekend is unlikely. A believable, reportable candidate list is achievable and is what judges will respect.

## 6. Machine learning plan

Keep it small. A big model from scratch will not be ready in a weekend.

1. **Detection with classic code first:** find point sources and link them into trails. This is the backbone.
2. **Small "real or bogus" classifier:** filters out cosmic rays, glare and bad pixels.
3. **Free labels:** trails that match known asteroids = "real"; random noise spots = "fake".
4. **Optional:** a second small classifier for spectra (rocky / icy / brown dwarf).
5. **Demo safety:** pre-run the pipeline on a few sky patches during the event so the site shows results instantly. Avoid live processing on stage.

## 7. Other ideas explored (from the concept page)

1. **Mover Finder:** difference two epochs, circle movers, check against known asteroids. (Folds into Rainbow Trails.)
2. **Light Fingerprint:** click an object, see its 102-band spectrum explained in one sentence.
3. **Spot the Mover:** public votes on candidates, with a Mauritius leaderboard.
4. **Sky Timeline:** slider through scans with motion trails.

Recommended order: Mover Finder / Rainbow Trails as the core, then Light Fingerprint, then Spot the Mover if time allows.

## 8. How hard is each challenge (our own view, not the official labels)

1. Dancing with the SARs (radar data, hardest)
2. **Planet X and SPHEREx (ours)**
3. Earth System Trend Detective
4. MODIS and VIIRS Hot Spots
5. Lunar Landing Site Navigator

The rest lean on design and storytelling more than hard data work.

## 9. Changing challenge

The official guides do not say whether a team can switch challenge after selecting. If needed, ask the local organiser (Maghanga) before 14 November. Fallback: create a new team under the other challenge, but confirm first.

## 10. Judging and what happens if we win

**Judging criteria (equal weight):**
- **Influence:** big or small problem?
- **Creativity:** new or incremental?
- **Validity:** is the science sound, can it work for real?
- **Relevance:** does it answer the challenge, is it feasible?
- **Presentation:** how well we tell the story.

**If we win locally:**
1. Local prizes from the Port Louis organisers.
2. Local judges may nominate us as a **Global Nominee** (the local winner is not automatically the nominee).
3. NASA experts pick **Global Finalists**.
4. **10 Global Winners**, one per category. Winners are invited to a celebration that may include a NASA centre visit.
5. Results come out over the following few months.

**Best-fit categories for us:** Best Use of Data, Best Use of Science, Galactic Impact.

## 11. Next steps

- [ ] Read the full challenge statement and resources on the challenge page.
- [ ] Read the Participant Guides for submission requirements.
- [ ] Go through the IRSA SPHEREx notebook tutorials (learning only, no building).
- [ ] Confirm how band exposures are timed (the Rainbow Trails assumption).
- [ ] Split roles: data pipeline, ML filter, web front end, presentation.
- [ ] Plan the 2-minute demo story around one real trail and one unmatched candidate.

## Sources

- Challenge list: https://www.spaceappschallenge.org/2026/challenges/
- Participant FAQs: https://www.spaceappschallenge.org/resources/participant-faqs/
- Team Formation Guide: https://spaceappschallenge.org/resources/team-formation-guide
- Judging and Awards Guide: https://spaceappschallenge.org/resources/judging-awards-guide
- SPHEREx QR overview: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html
- SPHEREx data tools: https://spherex.caltech.edu/page/data-tools
- AWS open data: https://registry.opendata.aws/spherex-qr/
- SkyShift repo: https://github.com/sreenath1212/skyshift-spherex