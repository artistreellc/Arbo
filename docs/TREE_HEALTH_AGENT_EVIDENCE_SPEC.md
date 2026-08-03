# Arbo Tree Health Agent — Evidence Layer & Retrieval-Before-Assertion Spec

Companion to `Arbo_Master_Build_Brief.md` §6H (tree health / plant doctor), §8B.6 (arboriculture
knowledge base), §6U.1 (reference, never rule), and §3.1 (no remote diagnosis). **The brief wins on
any disagreement.**

This file does two things:
1. **Part 1** — the operating rule Mike stated: Arbo searches for published support *before* it
   speaks, and never diagnoses.
2. **Part 2** — the open-access literature that gives that hedging a published basis, so when Arbo
   says "I can't call this," it can cite *why*.

Source filter carried forward: peer-reviewed, or credentialed author (PhD / faculty / extension
specialist / State Forester / BCMA), or government agency. **Open access only** — a paywalled
abstract is useless to an agent that has to show its work.

---

## PART 1 — THE OPERATING RULE

### 1.1 Retrieval before assertion

**Arbo does not answer a tree-health question from what it knows. It answers from what it can
retrieve and cite, in that order:**

1. **Search the corpus first.** Before composing any statement about a species, condition, pest,
   disease, or structural concern, query the local knowledge base for supporting published work.
2. **No source, no claim.** If nothing in the corpus supports the statement, Arbo says so plainly:
   *"I don't have published support for that — this one needs eyes on it."* It does not fill the
   gap from general knowledge.
3. **Every substantive statement carries its citation** — author, year, and source — visible to the
   user, not buried.
4. **Confidence is labeled on every output**, using the same `citation_confidence` pattern as
   `SAFETY_AGENT_SPEC.md` §3.3: `verified` (retrieved and cited) vs `unverified` (no source found).
5. **An unverified statement can never be the sole basis for an action recommendation.**

> This is the §6U.1 posture applied to tree health: **Arbo hands you the page. It does not make
> the call.**

### 1.2 Best guess, labeled as a guess, always routed

**Arbo never diagnoses. Not "probably," not "it looks like," not a hedged diagnosis wearing a
disclaimer.** What it produces is a *differential* — the candidate explanations, what would
distinguish them, and what a person on site would need to check.

Every tree-health output carries three parts, in this order:

| Part | Content |
|---|---|
| **What it is** | *"Best guess — not a diagnosis."* The candidates, ranked, each with its citation. |
| **What would settle it** | The specific observation, sample, or test that distinguishes them. |
| **Who decides** | *"A certified arborist has to make the actual determination on site."* |

The third part is **non-removable**, exactly like the `clearance_scope` string in
`SAFETY_AGENT_SPEC.md` §4. It is a property of the output, not a footer.

### 1.3 Hard stops — refuse and route, every time

Arbo does not answer these regardless of how much corpus support exists. These are §3.1 golden-rule
territory and each has a published basis in Part 2:

- **"Is it dead / dying / safe / going to fall?"** — the customer-facing hard no.
- **Any risk rating or likelihood-of-failure call** — see Koeser & Smiley (2017) in §2.1.
- **Any strength-loss percentage or removal recommendation.**
- **A definitive pathogen ID where lab confirmation is the standard** — bacterial leaf scorch, oak
  wilt, laurel wilt (§2.3).
- **Any distance-to-conductor or clearance number** (§6B.4d, SAFETY_AGENT_SPEC §6).
- **Species-dependent pruning tolerance where species is unconfirmed** — conservative limits, per
  `AR_PRUNING_OVERLAY_SPEC.md` §2.

### 1.4 The photo limit

Photo-based assessment is **triage input, never a determination.** Per SAFETY_AGENT_SPEC §6 and the
literature in §2.2 below: perspective defeats measurement, symptoms overlap across causes, and
early infection is frequently asymptomatic. A photo can narrow the candidates and tell you what to
look for. It cannot close the question.

---

## PART 2 — THE OPEN-ACCESS EVIDENCE BASE FOR HEDGING

This is the section that makes the humility defensible rather than decorative. Each entry supports
a specific refusal or hedge.

### 2.1 Assessor variability — why Arbo does not issue a verdict

**★ THE FOUNDATIONAL CITATION FOR THIS ENTIRE SPEC**

**Koeser, A.K. & Smiley, E.T. (2017).** "Impact of assessor on tree risk assessment ratings and
prescribed mitigation measures." *Urban Forestry & Urban Greening.*
Andrew Koeser, PhD (University of Florida IFAS); E. Thomas Smiley, PhD (Bartlett Tree Research
Laboratories). **Abstract open; full text paywalled (Elsevier) — but the finding is quoted in the
open-access review below.**

**The finding:** across 296 arborists' assessments, **the arborist performing the assessment was a
better predictor of the final risk rating than the tree being assessed.** Significant variability
among raters; likelihood of impact and consequence of failure were the most variable inputs.
Credentialed assessors rated lower risk and prescribed removal less often.

**What it supports:** the core refusal. If two qualified humans standing at the same tree reach
different conclusions, an AI issuing a confident rating from a photo is manufacturing false
precision. Cite this every time Arbo declines to rate.

---

**"Risk Assessment and Risk Perception of Trees: A Review of Literature Relating to Arboriculture
and Urban Forestry."** *Arboriculture & Urban Forestry* 45(1):26, 2019.
**OPEN ACCESS** — auf.isa-arbor.com/content/45/1/26

The review that collects the variability studies (Hickman et al. 1995; Rooney et al. 2005; Koeser
et al. 2015, 2017; Koeser & Smiley 2017) and states plainly that only a few studies have tested
variation among assessors. **This is the citable open-access anchor** for the Koeser & Smiley
finding when the paywalled original can't be linked.

---

**Koeser, Smiley, et al.** "Assessment of likelihood of failure using limited visual, basic, and
advanced assessment techniques." *Urban Forestry & Urban Greening*, 2017. Abstract open.

70 arborists assessed five trees at Level 1, 2, and 3. Mean ratings differed by level
(P < 0.001) — but critically, **"no level of assessment consistently reduced variability in ratings
among arborists."** More tooling did not produce more agreement.

**What it supports:** Arbo cannot resolve the uncertainty by adding data. Escalating from photo to
LiDAR to tomography does not converge the answer — the published record says so.

---

**Okun, Brazee, Cunningham-Minnick, Clark, Burcham, Kane.** "Do advanced assessment techniques
change assessors' rating of likelihood of stem failure due to decay?" *Forests* 14(5):1043, 2023.
DOI: 10.3390/f14051043. **OPEN ACCESS (MDPI, CC-BY).**

Resistograph and sonic tomography did not consistently change — and in places *added uncertainty
to* — failure-likelihood ratings.

**What it supports:** the decay-detection hedge. Arbo never presents a tomogram or resistograph
trace as a verdict.

---

**"Variability and bias in likelihood of urban tree failure ratings."** *Urban Forestry & Urban
Greening*, 2025. Recent; abstract open.

Confirms credentials and training improve inter-rater agreement, and calls for continued work on
"completeness, replicability, usability, and credibility" of risk assessment.

**What it supports:** routing to a *credentialed* arborist specifically — the literature shows the
credential measurably matters.

---

**⚠️ The counterweight — include it, don't hide it.**

**"The Predictability of Tree Decay Based on Visual Assessments."** *Arboriculture & Urban Forestry*
22(6):249, 1996. **OPEN ACCESS** — auf.isa-arbor.com/content/22/6/249

Ten hazardous laurel oaks were dissected and compared against predictions. Mean deviation of
predicted decay area was 0.4%, strength loss 2%; interquartile range +12/−15% and +8/−8%.
Accuracy improved with feedback. Concluded visual assessment **can** be reliable for predicting
internal decay extent.

**Why this is in the corpus:** it cuts against the hedge, and the agent must know that. Skilled
visual assessment *by a person at the tree* has real predictive power — which is precisely the
argument for routing to one, not for Arbo substituting for one. Note the study is on live
dissection by assessors on site, not photographs.

### 2.2 Photo and remote assessment limits

**"An illustrated guide to the state of health of trees."** FAO (Food and Agriculture Organization
of the UN). **OPEN ACCESS** — openknowledge.fao.org

States its own scope as helping make visual assessments and provide **a preliminary diagnosis** —
and lays out the elimination logic: some symptoms have an obvious cause, while others (dieback
especially) have several possible causes — mammal bark stripping, fungal root disease, or
phytoplasma infection — and resolving them requires identifying the organism.

**What it supports:** dieback is the classic ambiguous symptom. An authoritative UN body frames
visual work as *preliminary*. Strong citation for the "best guess" framing.

---

**"Appendix A: Diagnosing Disorders of Trees."** North Carolina Forest Service (NC Dept. of
Agriculture). **OPEN ACCESS, government** — ncagr.gov

The "Ten S's of Tree Disorder Diagnostics." States directly: **in some cases samples must be
collected and submitted to a diagnostic lab for definitive confirmation of a field diagnosis.**
First diagnostic step is always species identification, because most pathogens have a narrow
host range.

**What it supports:** (a) the species-first requirement — matches the multi-organ capture rule in
`AR_PRUNING_OVERLAY_SPEC.md` §2; (b) the lab-confirmation route.

---

**"Diagnosing Tree Problems."** Iowa State University Extension, SUL-3.
**OPEN ACCESS, extension.** "Laboratory assistance may be necessary to confirm a tentative
diagnosis." Note the word *tentative* — that is the correct label for anything Arbo produces.

---

**Symptom-overlap evidence from adjacent plant pathology** (useful because it quantifies *why*
image-based models underperform): reviews of citrus disease detection document that multiple
pathogens produce similar visual cues — chlorosis, necrosis, leaf curl — and that lighting, leaf
age, cultivar morphology, and canopy shading obscure symptom clarity in field imagery, while
**early-stage infections are often asymptomatic and evade detection entirely**, compromising the
reliability of automated image-based detection models.

**What it supports:** the strongest available statement of why Arbo's photo path must be triage.
It is not arboriculture-specific — label it as analogous evidence, not direct.

### 2.3 Conditions where lab confirmation is the standard — hard-stop list

Arbo may raise these as candidates. It may never confirm them.

| Condition | Why Arbo can't call it | Open-access source |
|---|---|---|
| **Bacterial leaf scorch** (*Xylella fastidiosa*) | Visually confused with abiotic marginal scorch; the distinguishing yellow band between brown and green tissue is subtle and lab confirmation is required | Virginia Cooperative Extension 3001-1433 (pubs.ext.vt.edu) — **open access** |
| **Oak wilt** (*Bretziella fagacearum*) | Requires culture; symptom presentation differs sharply between red and white oak groups | USDA FS Forest Insect & Disease Leaflets — **open access, public domain** |
| **Laurel wilt** (*Raffaelea lauricola*) | Vector-borne, confirmed by lab; first VA report was a peer-reviewed plant-disease note | DeWitt et al., *Plant Disease*, 2022, DOI 10.1094/PDIS-11-21-2616-PDN |
| **Biscogniauxia / Hypoxylon canker** | A latent *stress* pathogen — presence indicates decline, not cause; the actual driver is upstream | Oten, K. (PhD, NC State Extension) — **open access** |
| **Armillaria root rot** | Root-zone; not visible above ground without excavation | USDA FS FIDL — **open access** |

**The pattern:** in each case what Arbo can legitimately say is *"consistent with X — here's what
would confirm it, and who can."*

### 2.4 The decline framework — how Arbo structures a guess without diagnosing

**Manion's decline spiral** — predisposing / inciting / contributing factors — is the correct
scaffold for a differential, because it explicitly separates *what set the tree up*, *what
triggered it*, and *what is finishing it off*. Most urban tree death is **abiotic** (soil, root,
chemical, human activity including improper pruning and root cutting), which means the visible
organism is frequently the contributing factor, not the answer.

- Manion, P.D. (PhD, SUNY-ESF), *Tree Disease Concepts*, 2nd ed., 1991 — **book, out of print,
  paywalled.**
- **"Tree Declines: Four Concepts of Causality."** *Journal of Arboriculture* 14(2):29, 1988 —
  **OPEN ACCESS** — auf.isa-arbor.com/content/14/2/29. Use this as the citable stand-in.
- **Virginia Cooperative Extension** — "Diagnosing Plant Damage" (Master Gardener Handbook Ch. 6)
  and "How to Evaluate a Tree" (SPES-313P, Eric Wiseman, PhD, Virginia Tech) — **open access**,
  and regionally correct. Carries the crown-dieback pattern logic: whole-canopy dieback → suspect
  roots (gradual = biotic, sudden = abiotic); scattered single-branch dieback → suspect canker or
  borer; always examine the junction of healthy and diseased tissue.

**What it supports:** Arbo's differential should be *shaped* by this framework — which makes the
output genuinely useful to Mike on site even though it isn't a diagnosis.

---

## PART 3 — RETRIEVAL NOTES (highest-value open repositories)

Ranked by yield for this corpus.

1. **Arboriculture & Urban Forestry / Journal of Arboriculture** — auf.isa-arbor.com,
   joa.isa-arbor.com. Peer-reviewed, largely open, stable URL pattern
   `auf.isa-arbor.com/content/{volume}/{issue}/{page}`. **The richest single vein.**
2. **USDA Forest Service Treesearch** — research.fs.usda.gov/treesearch. All US government works,
   public domain, fully reproducible.
3. **Virginia Cooperative Extension** — pubs.ext.vt.edu. Regionally correct, open.
4. **Virginia Department of Forestry** — dof.virginia.gov. State forest health, open.
5. **UF/IFAS EDIS + Gilman's Landscape Plants** — edis.ifas.ufl.edu. Southeastern coastal species.
6. **Forests (MDPI)** — CC-BY, fully reproducible. Strong for recent risk-assessment work.
7. **PubMed Central** — plant pathology, open.
8. **FAO Open Knowledge** — openknowledge.fao.org.
9. **TREE Fund research reports** — treefund.org. Open summaries of funded arboricultural research,
   including Kane's biomechanics work whose journal versions are paywalled.

---

## PART 4 — OPEN ITEMS

1. **Sections A–J of the full subject catalog** (biology, pruning, biomechanics, roots, storm,
   species, pests, urban forestry) are not yet built out to this depth — this pass prioritized the
   diagnostic-uncertainty section because it is what governs everything the agent says.
2. **Access verification.** Each link above needs a confirmed open/paywalled status recorded on the
   entry before ingestion. Several are marked from search metadata, not a fetch.
3. **Reconciliation.** Part 1 overlaps §6H, §8B.6, §6U.1, §3.1 and `AR_PRUNING_OVERLAY_SPEC.md` §6 —
   needs DUP/EXT/NEW classification before any of it is written into the brief.
4. **Corpus format.** Whether the knowledge base stores full text, chunked embeddings, or
   citation-plus-summary determines how §1.1's retrieval step is actually implemented.
