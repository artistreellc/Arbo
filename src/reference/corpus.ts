/*
  ═══════════════════════════════════════════════════════════════════════
  SLOW::ARBO   ← this marker IS this note. Wherever it appears, all of
               it applies: in a file, a commit, a doc, or from Mike.
  STOP. READ THIS BEFORE YOU CHANGE ONE CHARACTER OF THIS FILE.
  Owner instruction from Mike, 2026-08-03. This is not decoration and it
  is not optional. It is here because this is the point in a build where
  things get broken by moving fast, and that already happened to him once
  on the website. It does not happen here.
  ═══════════════════════════════════════════════════════════════════════

  SLOW DOWN. DRASTICALLY. Then:

  1. READ EVERY LINE BEFORE YOU EDIT ONE. Every line, every letter,
     slowly. You are not skimming to find the spot to change — you are
     building a model of what this file already does. If you cannot say
     what the code above and below your edit does, you have not read it.

  2. AN AUDIT IS READ-ONLY. If you were asked to audit, you do not edit.
     You do not "fix it while you are in there." You do not refactor, or
     tidy, or rename. You READ, and you REPORT. Editing during an audit
     is disobeying the instruction, full stop.

  3. THINK BEFORE YOU TYPE. What does this already handle? What depends
     on it? What breaks downstream? Recognise the PATTERN before you call
     something a bug — most things in here that look wrong are a
     deliberate correction. Check docs/OWNER_RULINGS.md first. Use what
     you already know about this codebase instead of re-deciding it.

  4. BRING IT TO MIKE — DO NOT DECIDE IT. Anything that looks wrong,
     ambiguous, or outside what was asked: say it and WAIT. Flagging
     costs one sentence. Deciding on his behalf has cost real work and
     real money more than once.

  5. DO EXACTLY WHAT WAS ASKED. Not the adjacent thing. Not the bigger
     thing you thought of on the way. Not the cleanup. Exactly what was
     asked, and nothing else.

  If you are moving fast right now, you are already off the rails.

  Remember the marker: SLOW::ARBO
*/
// THE ARBORICULTURE CORPUS (docs/ARBORICULTURE_CORPUS.md).
//
// Mike, 2026-08-03: this is "for the whole app that the arborist ai agent can
// pull from" — NOT for the receptionist. ARBO on the phone answers basic
// terms and basic questions only; credentialed arborist material is exactly
// what it deflects. This corpus is the internal source an arborist agent
// reasons from, and what the §6U crew library cites.
//
// FOUR LAWS, all from the corpus document's own recommendations:
//
//   1. PROVENANCE ON EVERY ENTRY (Rec. 5). Author with credential,
//      institution, venue, year, stable URL, open-access status. If it cannot
//      be cited and audited, it does not belong here.
//   2. UNCERTAINTY IS CARRIED, NOT DROPPED (Rec. 4 / Appendix C). Several
//      widely-taught tools are weaker than practitioners assume. An entry
//      that is contested says so, so the agent hedges instead of asserting.
//      This is §1B applied to science: "the research is unsettled" and "the
//      research says X" are different facts.
//   3. NEVER REPRODUCE ANSI TEXT. A300 and Z133 are copyrighted — a legal
//      constraint, not an editorial one. Cite the clause, and prefer the free
//      government equivalents (Virginia 16VAC25-73, OSHA 1910.269/.266).
//      This is the same rule §6U.3 already enforces for the crew library.
//   4. NO TRADE BLOGS. Peer-reviewed, credentialed authors, government, and
//      university extension only. The corpus document excluded them on
//      purpose and so does this file.

export type CorpusSection =
  | 'biology_decay' | 'pruning' | 'biomechanics' | 'risk_assessment'
  | 'roots_soil' | 'storm_wind' | 'species' | 'pests_disease'
  | 'diagnosis' | 'valuation' | 'safety';

export interface CorpusEntry {
  id: string;
  section: CorpusSection;
  title: string;
  /** Author(s) WITH credential — the source filter is the point. */
  authors: string;
  institution: string;
  venue: string;
  year: number;
  /** Stable URL or DOI. Null when print-only; cite the concept, not the text. */
  url: string | null;
  openAccess: boolean;
  /** The ★ source for its section. */
  foundational: boolean;
  /** Directly applicable to the Hampton Roads coastal plain. */
  regional: boolean;
  /** The load-bearing finding, in plain words. Paraphrase, never reproduction. */
  finding: string;
  /**
   * Appendix C. Non-null means the science is thin or contested and the agent
   * must hedge. Dropping this would be the §1B failure in its worst form:
   * presenting a disputed tool as settled fact on a safety surface.
   */
  uncertainty: string | null;
}

export const CORPUS: CorpusEntry[] = [
  // ── 1. BIOLOGY & DECAY ───────────────────────────────────────────────────
  {
    id: 'shigo-1977-codit', section: 'biology_decay', foundational: true, regional: false,
    title: 'Compartmentalization of Decay in Trees (CODIT)',
    authors: 'Alex L. Shigo (USDA FS forest pathologist) & Harold G. Marx',
    institution: 'USDA Forest Service', venue: 'Agriculture Information Bulletin 405', year: 1977,
    url: 'https://research.fs.usda.gov/treesearch/5292', openAccess: true,
    finding: 'Trees do not heal. They wall damage off behind four chemical and physical boundaries and grow over it. The most influential teaching document in modern arboriculture.',
    uncertainty: null,
  },
  {
    id: 'smith-2006-codit-today', section: 'biology_decay', foundational: false, regional: false,
    title: 'Compartmentalization today',
    authors: 'Kevin T. Smith, PhD', institution: 'USDA FS Northern Research Station',
    venue: 'Treesearch 18529', year: 2006,
    url: 'https://nrs.fs.usda.gov/pubs/jrnl/2006/nrs_2006_smith-k_001.pdf', openAccess: true,
    finding: 'The CODIT walls are CONCEPTUAL boundaries, not literal structures.',
    uncertainty: 'Treating the four walls as literal "bricks and mortar" is a documented misinterpretation (Appendix C7). Describe them as conceptual.',
  },

  // ── 2. PRUNING ───────────────────────────────────────────────────────────
  {
    id: 'gilman-uf-pruning', section: 'pruning', foundational: true, regional: false,
    title: 'UF/IFAS Landscape Plants pruning research program',
    authors: 'Edward F. Gilman, PhD, Professor Emeritus',
    institution: 'University of Florida, Environmental Horticulture',
    venue: 'hort.ifas.ufl.edu/woody', year: 2015,
    url: 'https://hort.ifas.ufl.edu/woody', openAccess: true,
    finding: 'Gilman: the ANSI 25% live-foliage allowance is "too much in many circumstances and not enough in others". Stay under about 10% on a mature tree without a specific defect-reduction reason. Above 25–30% on anything but a young tree, split the work across two sessions at least a growing season apart. Lion’s-tailing is substandard practice.',
    uncertainty: 'The 25% figure is a practice generalisation, not a species-specific experimental threshold (Appendix C4).',
  },
  {
    id: 'gilman-2013-structural', section: 'pruning', foundational: false, regional: false,
    title: 'Structural Pruning: A Guide for the Green Industry',
    authors: 'Edward F. Gilman, PhD; Brian Kempf; Nelda Matheny; Jim Clark',
    institution: 'Urban Tree Foundation', venue: 'ISA conference proceedings', year: 2013,
    url: 'https://www.isa-arbor.com', openAccess: true,
    finding: 'Structural pruning develops and maintains a dominant leader with subordinate branches, to prevent codominant-stem failure.',
    uncertainty: 'Long-term structural benefit is sound theory but not robustly demonstrated for all species — see rathjens-2021.',
  },
  {
    id: 'shigo-1989-pruning', section: 'pruning', foundational: false, regional: false,
    title: 'Tree Pruning',
    authors: 'Alex L. Shigo', institution: 'Shigo & Trees Associates', venue: 'book', year: 1989,
    url: null, openAccess: false,
    finding: 'Origin of the three-cut method and the flush-cut versus collar-cut distinction. Flush cuts produce measurably larger decay columns. Topping causes decay, weak epicormic sprouts and stress, and has no legitimate arboricultural application.',
    uncertainty: null,
  },

  // ── 3. BIOMECHANICS ──────────────────────────────────────────────────────
  {
    id: 'dahle-2017-load', section: 'biomechanics', foundational: true, regional: false,
    title: 'A Review of Factors That Affect the Static Load-Bearing Capacity of Urban Trees',
    authors: 'Gregory A. Dahle, PhD, BCMA; Kenneth R. James; Brian Kane, PhD; Jason Grabosky, PhD; Andreas Detter',
    institution: 'West Virginia University / UMass Amherst / Rutgers',
    venue: 'Arboriculture & Urban Forestry 43(3):89–106', year: 2017,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Load-bearing capacity is proportional to the CUBE of stem diameter. Cross-section size and shape matter far more than wood strength.',
    uncertainty: null,
  },
  {
    id: 'kane-branch-attachment', section: 'biomechanics', foundational: false, regional: false,
    title: 'Failure Mode and Prediction of the Strength of Branch Attachments',
    authors: 'Brian Kane, PhD, ISA Certified Arborist',
    institution: 'UMass Amherst', venue: 'Arboriculture & Urban Forestry', year: 2008,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Branch-to-trunk diameter ratio (aspect ratio) predicts attachment strength BETTER than the angle of attachment.',
    uncertainty: null,
  },
  {
    id: 'slater-2015-included-bark', section: 'biomechanics', foundational: false, regional: false,
    title: 'The Level of Occlusion of Included Bark Affects the Strength of Bifurcations',
    authors: 'Duncan Slater, PhD & A.R. Ennos',
    institution: 'Myerscough College (UK)', venue: 'Arboriculture & Urban Forestry 41(4):194–207', year: 2015,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Bark-included bifurcations had a modulus of rupture 24% lower than normally formed ones. Cup-shaped, partially occluded inclusions averaged 36% STRONGER than junctions with bark included at the apex. Natural bracing higher in the crown is a primary cause of included bark forming.',
    uncertainty: 'Diameter ratio and inclusion width explained only 16.6% and 8.1% of strength variability — real predictors, but weak ones.',
  },

  // ── 4. RISK ASSESSMENT ───────────────────────────────────────────────────
  {
    id: 'smiley-1992-strength-loss', section: 'risk_assessment', foundational: true, regional: false,
    title: 'Determining Strength Loss from Decay',
    authors: 'E. Thomas Smiley, PhD, ISA BCMA & Bruce R. Fraedrich, PhD',
    institution: 'Bartlett Tree Research Laboratories',
    venue: 'Journal of Arboriculture 18(4):201–204', year: 1992,
    url: 'https://doi.org/10.48044/jauf.1992.040', openAccess: true,
    finding: 'The Bartlett strength-loss formula, tested against oaks broken by Hurricane Hugo. 52 of 54 broken oaks had internal decay.',
    uncertainty: 'At a 33% strength-loss threshold the formula predicted only HALF the failures in 90 mph winds while calling for unnecessary removal of 12% of survivors. Bartlett later moved away from strict formula use. Never present any single formula as authoritative (Appendix C2).',
  },
  {
    id: 'okun-2023-decay-tools', section: 'risk_assessment', foundational: false, regional: false,
    title: 'Do advanced assessment techniques change assessors’ rating of likelihood of stem failure due to decay?',
    authors: 'Okun; Brazee, PhD; Cunningham-Minnick; Clark; Burcham; Kane, PhD',
    institution: 'UMass Amherst', venue: 'Forests 14(5):1043', year: 2023,
    url: 'https://doi.org/10.3390/f14051043', openAccess: true,
    finding: 'Resistograph and tomography did not consistently change assessors’ failure-likelihood ratings, and sometimes ADDED uncertainty.',
    uncertainty: 'Treat tomograms and resistograph traces as decision aids, never verdicts (Appendix C1).',
  },
  {
    id: 'mattheck-tr-threshold', section: 'risk_assessment', foundational: false, regional: false,
    title: 'Foundations of Tree Risk Analysis: the t/R threshold',
    authors: 'Bond; with Christopher J. Luley, PhD; Brian Kane, PhD; Scott Cullen',
    institution: 'Urban Forest Diagnostics', venue: 'open-access PDF', year: 2006,
    url: null, openAccess: true,
    finding: 'Establishes and critiques Mattheck’s t/R ≥ 0.3 residual-wall buckling rule.',
    uncertainty: 'An imperfect predictor that omits important variables. Do not present it as authoritative (Appendix C2).',
  },

  // ── 5. ROOTS & SOIL ──────────────────────────────────────────────────────
  {
    id: 'watson-2013-planting', section: 'roots_soil', foundational: true, regional: false,
    title: 'The Practical Science of Planting Trees',
    authors: 'Gary Watson, PhD (Lead Scientist Emeritus) & E.B. Himelick',
    institution: 'Morton Arboretum', venue: 'ISA (book)', year: 2013,
    url: null, openAccess: false,
    finding: 'The synthesis reference on transplanting, root loss, critical root zone and establishment. Transplant-shock severity scales with tree size — larger trees take proportionally longer to restore a functional root-shoot balance.',
    uncertainty: null,
  },
  {
    id: 'bassuk-cu-structural-soil', section: 'roots_soil', foundational: false, regional: false,
    title: 'CU-Structural Soil: A Comprehensive Guide',
    authors: 'Nina Bassuk, PhD & Jason Grabosky, PhD',
    institution: 'Cornell Urban Horticulture Institute / Rutgers', venue: 'hort.cornell.edu/uhi', year: 2015,
    url: 'https://hort.cornell.edu/uhi', openAccess: true,
    finding: 'A compaction-resistant stone-lattice medium that bears pavement loads while still permitting root growth.',
    uncertainty: null,
  },
  {
    id: 'smiley-2008-root-pruning', section: 'roots_soil', foundational: false, regional: false,
    title: 'Root pruning and stability of young willow oak',
    authors: 'E. Thomas Smiley, PhD', institution: 'Bartlett Tree Research Laboratories',
    venue: 'Arboriculture & Urban Forestry 34(2):123–128', year: 2008,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Directly relevant to construction and excavation root damage, and to defining the critical root zone.',
    uncertainty: null,
  },

  // ── 6. STORM & WIND — the regional backbone ──────────────────────────────
  {
    id: 'duryea-2007-coastal-plain', section: 'storm_wind', foundational: true, regional: true,
    title: 'Hurricanes and the Urban Forest I: Effects on Southeastern US Coastal Plain Tree Species',
    authors: 'Mary L. Duryea, PhD; Eliana Kampf; Ramon C. Littell',
    institution: 'University of Florida', venue: 'Arboriculture & Urban Forestry 33(2):83–97', year: 2007,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'The most directly applicable wind study for Hampton Roads. Highest survival: sand live oak, American holly, southern magnolia, live oak, wax myrtle, sweetgum, crapemyrtle, dogwood, sabal palm. LAUREL OAK survived significantly worse than live oak — a live local caution given how common it is in Tidewater.',
    uncertainty: 'Ratings are observational and expert-opinion based; category definitions were not precisely specified and many species remain unrated (Appendix C6). Strong guidance, not precise probabilities.',
  },
  {
    id: 'duryea-fr010-panhandle', section: 'storm_wind', foundational: false, regional: true,
    title: 'Wind and Trees: Surveys of Tree Damage in the Florida Panhandle after Hurricanes Erin and Opal',
    authors: 'Mary L. Duryea, PhD & Eliana Kampf', institution: 'UF/IFAS EDIS (FR010)', venue: 'EDIS', year: 2007,
    url: 'https://edis.ifas.ufl.edu', openAccess: true,
    finding: 'Coastal-plain standing-after-hurricane rates: sweetbay magnolia 97%, sycamore 92%, LOBLOLLY PINE 82% — loblolly being the dominant local resource.',
    uncertainty: 'Observational survey data (Appendix C6).',
  },
  {
    id: 'gilman-reduction-storm', section: 'storm_wind', foundational: false, regional: false,
    title: 'Reduction pruning for storm resistance',
    authors: 'Edward F. Gilman, PhD et al.', institution: 'University of Florida', venue: 'UF/IFAS', year: 2010,
    url: 'https://hort.ifas.ufl.edu/woody', openAccess: true,
    finding: 'Reducing large-aspect-ratio branches and shortening branches markedly reduces branch motion and storm damage. Reframes pruning as risk management rather than tidying.',
    uncertainty: null,
  },

  // ── 7. SPECIES ───────────────────────────────────────────────────────────
  {
    id: 'kane-2007-bradford-pear', section: 'species', foundational: true, regional: true,
    title: "Branch Strength of Bradford Pear (Pyrus calleryana var. 'Bradford')",
    authors: 'Brian Kane, PhD; Robert Farrell; Shepard M. Zedaker; D.W. Smith',
    institution: 'Virginia Tech', venue: 'Arboriculture & Urban Forestry 33(4):283', year: 2007,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'First empirical test of Bradford pear branch strength; confirms aspect ratio predicts attachment strength. Half the failures occurred at large laterals, so branch and attachment breaking stresses did not differ — contrary to earlier studies.',
    uncertainty: null,
  },
  {
    id: 'rathjens-2021-callery', section: 'species', foundational: false, regional: false,
    title: 'Structural Pruning in Callery Pear Does Not Change Apparent Branch Union Strength',
    authors: 'Richard G. Rathjens; T. Davis Sydnor; Jason Grabosky, PhD; Greg Dahle, PhD',
    institution: 'Ohio State / Rutgers / WVU', venue: 'Arboriculture & Urban Forestry 47(3):123–130', year: 2021,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Seven-year static load testing found NO difference in branch union strength between pruned and unpruned trees.',
    uncertainty: 'A direct challenge to a widely-taught benefit. "More time is needed to determine the long-term benefits of structural pruning" (Appendix C3).',
  },

  // ── 8. PESTS & DISEASE — regional ────────────────────────────────────────
  {
    id: 'vdof-forest-health', section: 'pests_disease', foundational: true, regional: true,
    title: 'Virginia Forest Health Highlights',
    authors: 'USDA Forest Service Forest Health Protection & Virginia Department of Forestry',
    institution: 'VDOF / USDA FS', venue: 'annual report', year: 2023,
    url: 'https://www.fs.usda.gov/foresthealth', openAccess: true,
    finding: 'The regional pest picture: southern pine beetle (low but persistent given the loblolly resource — thinning is the most effective prevention), Ips engravers, emerald ash borer, hemlock woolly adelgid, spotted lanternfly, beech leaf disease.',
    uncertainty: null,
  },
  {
    id: 'vce-eab', section: 'pests_disease', foundational: false, regional: true,
    title: 'Emerald Ash Borer: Options for Landowners (ENTO-76 / HORT-69)',
    authors: 'Eric R. Day & Scott Salom (VT Entomology); Lori Chamberlin, Katlin Mooneyham, Meredith Bean (VDOF)',
    institution: 'Virginia Cooperative Extension', venue: 'pubs.ext.vt.edu', year: 2022,
    url: 'https://pubs.ext.vt.edu', openAccess: true,
    finding: 'EAB is present in ALL regions of Virginia. Insecticidal treatment is viable before roughly 30% canopy damage. D-shaped exit holes and S-shaped galleries are diagnostic.',
    uncertainty: null,
  },
  {
    id: 'vce-bacterial-leaf-scorch', section: 'pests_disease', foundational: false, regional: true,
    title: 'Bacterial Leaf Scorch of Landscape Trees (VCE 3001-1433)',
    authors: 'Virginia Cooperative Extension / Virginia Tech', institution: 'Virginia Tech',
    venue: 'pubs.ext.vt.edu', year: 2024,
    url: 'https://pubs.ext.vt.edu', openAccess: true,
    finding: 'Xylella fastidiosa, spread by sharpshooter leafhoppers; in Virginia most often on red-oak-group oaks, elm and sycamore. Distinguished from abiotic marginal scorch by a yellow band between the brown and green leaf tissue. Lab confirmation is required.',
    uncertainty: 'HARD STOP (TREE_HEALTH_AGENT_EVIDENCE_SPEC §2.3): field appearance alone is not diagnostic — the distinguishing yellow band is subtle and it needs LAB confirmation. Arbo may raise BLS as a candidate and may never confirm it.',
  },
  {
    id: 'oten-biscogniauxia', section: 'pests_disease', foundational: false, regional: true,
    title: 'Biscogniauxia (Hypoxylon) Canker',
    authors: 'Kelly Oten, PhD, Extension Specialist Forest Health & Courtney Johnson',
    institution: 'NC State University', venue: 'NC State Extension', year: 2025,
    url: 'https://content.ces.ncsu.edu/biscogniauxia-hypoxylon-canker', openAccess: true,
    finding: 'A latent, opportunistic STRESS pathogen and one of the major contributors to the oak decline complex. Red oaks are more susceptible than white oaks. There is no chemical cure — management is stress reduction.',
    uncertainty: 'HARD STOP (TREE_HEALTH_AGENT_EVIDENCE_SPEC §2.3): a LATENT STRESS pathogen — its presence indicates decline rather than causing it, and the real driver is upstream. Naming the fungus as the cause is the classic diagnostic error. In Manion\'s framework it is a contributing factor, not the answer.',
  },
  {
    id: 'dewitt-2022-laurel-wilt-va', section: 'pests_disease', foundational: false, regional: true,
    title: 'First Report of Laurel Wilt Disease Caused by Raffaelea lauricola on Sassafras in Virginia',
    authors: 'K.M. DeWitt; L.K. Johnson; L.A. Chamberlin (VDOF); A.H. Kennedy (USDA APHIS); M.A. Hansen & E.A. Bush (Virginia Tech)',
    institution: 'VDOF / Virginia Tech', venue: 'Plant Disease', year: 2022,
    url: 'https://doi.org/10.1094/PDIS-11-21-2616-PDN', openAccess: false,
    finding: 'Documents laurel wilt arriving in Virginia — a live threat to redbay in southeast Virginia and sassafras statewide.',
    uncertainty: 'HARD STOP (TREE_HEALTH_AGENT_EVIDENCE_SPEC §2.3): vector-borne and confirmed by LAB. Arbo may raise laurel wilt as a candidate and may never confirm it. Regionally live for Hampton Roads.',
  },

  // ── 9. DIAGNOSIS ─────────────────────────────────────────────────────────
  {
    id: 'manion-decline-spiral', section: 'diagnosis', foundational: true, regional: false,
    title: 'Tree Disease Concepts (2nd ed.) — the decline spiral',
    authors: 'Paul D. Manion, PhD, Professor of Forest Pathology',
    institution: 'SUNY College of Environmental Science and Forestry', venue: 'Prentice Hall (book)', year: 1991,
    url: null, openAccess: false,
    finding: 'The three-factor decline model that underpins telling biotic from abiotic decline. PREDISPOSING factors (age, genetics, site, soil, climate) lower baseline resistance; INCITING factors (drought, defoliation, frost) trigger; CONTRIBUTING factors (opportunistic cankers, bark beetles, Armillaria) finish the tree.',
    uncertainty: null,
  },
  {
    id: 'vce-evaluate-a-tree', section: 'diagnosis', foundational: false, regional: true,
    title: 'How to Evaluate a Tree (SPES-313P) and Diagnosing Plant Damage',
    authors: 'Eric Wiseman, PhD (VT urban forestry); Virginia Master Gardener Handbook Ch. 6',
    institution: 'Virginia Cooperative Extension / Virginia Tech', venue: 'pubs.ext.vt.edu', year: 2020,
    url: 'https://pubs.ext.vt.edu', openAccess: true,
    finding: 'The crown-dieback decision framework. Whole-canopy or major-portion dieback points at the roots — gradual suggests biotic (Armillaria, Verticillium), sudden suggests abiotic (chemical, freeze, drought). Scattered single-branch dieback points at a canker or a borer. Always examine the junction of healthy and diseased tissue. In urban landscapes MOST tree deaths are abiotic — soil, roots, chemicals, and human activity such as improper pruning, root cutting and girdling.',
    uncertainty: null,
  },

  // ── 10. VALUATION ────────────────────────────────────────────────────────
  {
    id: 'nowak-itree', section: 'valuation', foundational: true, regional: false,
    title: 'i-Tree (Eco, Streets, Landscape)',
    authors: 'David J. Nowak, PhD and the USDA Forest Service',
    institution: 'USDA Forest Service', venue: 'research.fs.usda.gov', year: 2021,
    url: 'https://research.fs.usda.gov/products/dataandtools/i-tree', openAccess: true,
    finding: 'Peer-reviewed suite quantifying pollution removal, carbon sequestration, avoided stormwater runoff and energy effects.',
    uncertainty: 'Nowak notes i-Tree monetises only four or five benefits and that its returns are deliberately conservative — it is a floor, not a full value.',
  },
  {
    id: 'ctla-guide-10', section: 'valuation', foundational: false, regional: false,
    title: 'Guide for Plant Appraisal, 10th Edition',
    authors: 'Council of Tree and Landscape Appraisers', institution: 'CTLA / ISA', venue: 'book', year: 2019,
    url: null, openAccess: false,
    finding: 'Defines the three appraisal approaches — Cost (Trunk Formula / Cost Compounding), Income, and Sales Comparison — and splits depreciation into condition, functional limitations and external limitations.',
    uncertainty: 'Active public practitioner disagreement over the 10th edition’s internal consistency; some qualified appraisers still use the 9th. Disclose the dispute rather than presenting one method as settled (Appendix C5).',
  },

  // ── 11. SAFETY ───────────────────────────────────────────────────────────
  {
    id: 'ball-2020-incidents', section: 'safety', foundational: true, regional: false,
    title: 'A Review of United States Arboricultural Operation Fatal and Nonfatal Incidents (2001–2017)',
    authors: 'John Ball, PhD et al.', institution: 'South Dakota State University',
    venue: 'Arboriculture & Urban Forestry 46(2):67', year: 2020,
    url: 'https://auf.isa-arbor.com', openAccess: true,
    finding: 'Contact with objects and equipment caused 359 fatal (41.5%) and 189 nonfatal (42.8%) incidents. Struck-by-falling-branch: 104 fatal (12.0%), 56 nonfatal (12.7%).',
    uncertainty: null,
  },
  {
    id: 'niosh-2009-fatalities', section: 'safety', foundational: false, regional: false,
    title: 'Work-Related Fatalities Associated With Tree Care Operations — United States, 1992–2007',
    authors: 'Dorothy A. Castillo & Cammie K. Menéndez', institution: 'NIOSH / CDC',
    venue: 'MMWR 58(15):389–393', year: 2009,
    url: 'https://www.cdc.gov/mmwr', openAccess: true,
    finding: 'Of 1,285 tree-worker fatalities, 44% happened while pruning or trimming and 34% involved a FALL. The definitive national fatality dataset.',
    uncertainty: null,
  },
  {
    id: 'va-16vac25-73', section: 'safety', foundational: false, regional: true,
    title: 'Virginia 16VAC25-73 — Regulation Applicable to Tree Trimming Operations',
    authors: 'Virginia Safety and Health Codes Board / VOSH',
    institution: 'Virginia Department of Labor and Industry', venue: 'Virginia Administrative Code', year: 2011,
    url: 'https://law.lis.virginia.gov/admincodefull/title16/agency25/chapter73/', openAccess: true,
    finding: 'THE citable Virginia safety rule for pruning, repairing, maintaining and removing trees. Based on ANSI Z133.1-2006, effective 2011-04-27. Excludes line-clearance trimming (16VAC25-90-1910.269) and logging (1910.266). This is the FREE, citable government equivalent to the paywalled ANSI Z133 — cite this instead.',
    uncertainty: null,
  },
  {
    id: 'osha-1910-269', section: 'safety', foundational: false, regional: false,
    title: 'OSHA 29 CFR 1910.269 — Electric Power Generation, Transmission and Distribution',
    authors: 'US Department of Labor / OSHA', institution: 'OSHA', venue: 'eCFR', year: 2024,
    url: 'https://www.ecfr.gov', openAccess: true,
    finding: 'Paragraph (r) governs line-clearance tree trimming near energised conductors — minimum approach distances and the qualified line-clearance arborist requirement.',
    uncertainty: 'If the app ever advises near-power-line work, general arboriculture guidance is LEGALLY INSUFFICIENT — escalate to the full 1910.269(r) requirements and a qualified line-clearance arborist.',
  },

  // ── FROM docs/TREE_HEALTH_AGENT_EVIDENCE_SPEC.md (Mike, 2026-08-03) ──────
  // Part 2 of that spec: the published basis for WHY Arbo hedges. Without
  // these the humility is decorative — with them, when Arbo says "I can't
  // call this", it can cite why. Filed here because Mike's instruction was
  // that the corpus is what the arborist agent pulls from.
  {
    id: 'koeser-smiley-2017-assessor', section: 'risk_assessment', foundational: true, regional: false,
    title: 'Impact of assessor on tree risk assessment ratings and prescribed mitigation measures',
    authors: 'Andrew K. Koeser, PhD (UF/IFAS) & E. Thomas Smiley, PhD (Bartlett Tree Research Laboratories)',
    institution: 'University of Florida IFAS; Bartlett Tree Research Laboratories',
    venue: 'Urban Forestry & Urban Greening', year: 2017,
    url: null, openAccess: false,
    finding: 'Across 296 arborists, the ASSESSOR was a better predictor of the final risk rating than the tree being assessed. Credentialed assessors rated lower risk and prescribed removal less often.',
    uncertainty: 'Full text is paywalled (Elsevier); the finding is quoted in the open-access 2019 AUF review — cite that when a link is needed. This is the foundational citation for every refusal to rate: if two qualified humans at the same tree disagree, an AI rating from a photo is manufacturing false precision.',
  },
  {
    id: 'auf-2019-risk-perception-review', section: 'risk_assessment', foundational: false, regional: false,
    title: 'Risk Assessment and Risk Perception of Trees: A Review of Literature',
    authors: 'Peer-reviewed review (ISA)', institution: 'International Society of Arboriculture',
    venue: 'Arboriculture & Urban Forestry 45(1):26', year: 2019,
    url: 'https://auf.isa-arbor.com/content/45/1/26', openAccess: true,
    finding: 'Collects the assessor-variability studies (Hickman 1995; Rooney 2005; Koeser 2015, 2017) and states plainly that only a few studies have tested variation among assessors.',
    uncertainty: 'Use as the citable open-access anchor for Koeser & Smiley when the paywalled original cannot be linked.',
  },
  {
    id: 'koeser-2017-assessment-levels', section: 'risk_assessment', foundational: false, regional: false,
    title: 'Assessment of likelihood of failure using limited visual, basic, and advanced assessment techniques',
    authors: 'Andrew K. Koeser, PhD; E. Thomas Smiley, PhD; et al.',
    institution: 'University of Florida IFAS', venue: 'Urban Forestry & Urban Greening', year: 2017,
    url: null, openAccess: false,
    finding: '70 arborists assessed five trees at Levels 1, 2 and 3. Mean ratings differed by level, but NO level of assessment consistently reduced variability among arborists.',
    uncertainty: 'Abstract open, full text paywalled. Load-bearing point: Arbo cannot resolve the uncertainty by adding data — escalating photo to LiDAR to tomography does not converge the answer.',
  },
  {
    id: 'okun-2023-advanced-techniques', section: 'risk_assessment', foundational: false, regional: false,
    title: 'Do advanced assessment techniques change assessors\' rating of likelihood of stem failure due to decay?',
    authors: 'Okun, Brazee, Cunningham-Minnick, Clark, Burcham, Kane',
    institution: 'University of Massachusetts Amherst', venue: 'Forests 14(5):1043', year: 2023,
    url: 'https://doi.org/10.3390/f14051043', openAccess: true,
    finding: 'Resistograph and sonic tomography did not consistently change — and in places ADDED uncertainty to — failure-likelihood ratings.',
    uncertainty: 'The decay-detection hedge. Never present a tomogram or resistograph trace as a verdict.',
  },
  {
    id: 'auf-1996-decay-predictability', section: 'risk_assessment', foundational: false, regional: false,
    title: 'The Predictability of Tree Decay Based on Visual Assessments',
    authors: 'Peer-reviewed (ISA)', institution: 'International Society of Arboriculture',
    venue: 'Arboriculture & Urban Forestry 22(6):249', year: 1996,
    url: 'https://auf.isa-arbor.com/content/22/6/249', openAccess: true,
    finding: 'Ten hazardous laurel oaks were dissected against predictions: mean deviation of predicted decay area 0.4%, strength loss 2%. Concluded skilled visual assessment CAN reliably predict internal decay extent.',
    uncertainty: 'THIS ONE CUTS AGAINST THE HEDGE and is in the corpus for that reason — the agent must know its own counterweight. Note the scope: live dissection by assessors ON SITE, not photographs. It is an argument for routing to a person at the tree, never for Arbo substituting for one.',
  },
  {
    id: 'fao-tree-health-guide', section: 'diagnosis', foundational: true, regional: false,
    title: 'An illustrated guide to the state of health of trees',
    authors: 'FAO', institution: 'Food and Agriculture Organization of the United Nations',
    venue: 'FAO Open Knowledge', year: 2007,
    url: 'https://openknowledge.fao.org', openAccess: true,
    finding: 'Frames visual assessment as producing a PRELIMINARY diagnosis. Dieback especially has several possible causes — bark stripping, fungal root disease, phytoplasma — and resolving them requires identifying the organism.',
    uncertainty: 'Dieback is the classic ambiguous symptom. A UN body calling visual work preliminary is the strong citation for the "best guess, not a diagnosis" framing.',
  },
  {
    id: 'ncfs-diagnosing-disorders', section: 'diagnosis', foundational: false, regional: false,
    title: 'Appendix A: Diagnosing Disorders of Trees (the Ten S\'s)',
    authors: 'North Carolina Forest Service', institution: 'NC Department of Agriculture',
    venue: 'NCFS field guidance', year: 2020,
    url: 'https://www.ncagr.gov', openAccess: true,
    finding: 'States directly that samples must sometimes go to a diagnostic lab for definitive confirmation. The FIRST diagnostic step is always species identification, because most pathogens have a narrow host range.',
    uncertainty: null,
  },
  {
    id: 'isu-diagnosing-tree-problems', section: 'diagnosis', foundational: false, regional: false,
    title: 'Diagnosing Tree Problems (SUL-3)',
    authors: 'Iowa State University Extension', institution: 'Iowa State University',
    venue: 'ISU Extension SUL-3', year: 2018,
    url: 'https://store.extension.iastate.edu', openAccess: true,
    finding: 'Laboratory assistance may be necessary to confirm a TENTATIVE diagnosis.',
    uncertainty: '"Tentative" is the correct label for anything Arbo produces. Nothing it outputs is more than that.',
  },
  {
    id: 'symptom-overlap-imaging-analogous', section: 'diagnosis', foundational: false, regional: false,
    title: 'Symptom overlap and asymptomatic early infection in image-based plant disease detection',
    authors: 'Plant pathology reviews (citrus disease detection literature)',
    institution: 'Various — analogous evidence, NOT arboriculture', venue: 'PubMed Central', year: 2023,
    url: 'https://www.ncbi.nlm.nih.gov/pmc/', openAccess: true,
    finding: 'Multiple pathogens produce similar visual cues (chlorosis, necrosis, leaf curl); lighting, leaf age, cultivar morphology and canopy shading obscure symptoms in field imagery; early-stage infections are often asymptomatic and evade detection entirely.',
    uncertainty: 'LABEL AS ANALOGOUS, NOT DIRECT — this is citrus, not arboriculture. It is the strongest available statement of why Arbo\'s photo path must be triage rather than determination, but it must never be cited as if it were a tree study.',
  },
  {
    id: 'joa-1988-decline-causality', section: 'diagnosis', foundational: false, regional: false,
    title: 'Tree Declines: Four Concepts of Causality (the decline spiral)',
    authors: 'After Paul D. Manion, PhD (SUNY-ESF)', institution: 'International Society of Arboriculture',
    venue: 'Journal of Arboriculture 14(2):29', year: 1988,
    url: 'https://auf.isa-arbor.com/content/14/2/29', openAccess: true,
    finding: 'Predisposing / inciting / contributing factors — separates what set the tree up, what triggered it, and what is finishing it off. Most urban tree death is ABIOTIC (soil, roots, chemicals, improper pruning, root cutting), so the visible organism is frequently the contributing factor rather than the answer.',
    uncertainty: 'Manion\'s book (Tree Disease Concepts, 2nd ed. 1991) is out of print and paywalled; this is the citable open-access stand-in. Use the framework to SHAPE a differential — it is what makes the output useful on site without being a diagnosis.',
  },
  {
    id: 'vce-wiseman-evaluate-tree', section: 'diagnosis', foundational: false, regional: true,
    title: 'How to Evaluate a Tree (SPES-313P) & Diagnosing Plant Damage',
    authors: 'Eric Wiseman, PhD', institution: 'Virginia Tech / Virginia Cooperative Extension',
    venue: 'VCE SPES-313P; Master Gardener Handbook Ch. 6', year: 2020,
    url: 'https://pubs.ext.vt.edu', openAccess: true,
    finding: 'Crown-dieback pattern logic: whole-canopy dieback suggests roots (gradual = biotic, sudden = abiotic); scattered single-branch dieback suggests canker or borer. Always examine the junction of healthy and diseased tissue.',
    uncertainty: null,
  },
  {
    id: 'usdafs-oak-wilt-fidl', section: 'pests_disease', foundational: false, regional: false,
    title: 'Oak Wilt (Bretziella fagacearum) — Forest Insect & Disease Leaflet',
    authors: 'USDA Forest Service', institution: 'USDA Forest Service',
    venue: 'Forest Insect & Disease Leaflets', year: 2011,
    url: 'https://research.fs.usda.gov/treesearch', openAccess: true,
    finding: 'Requires culture to confirm; symptom presentation differs sharply between the red and white oak groups.',
    uncertainty: 'HARD STOP — candidate only, never a confirmation.',
  },
  {
    id: 'usdafs-armillaria-fidl', section: 'pests_disease', foundational: false, regional: false,
    title: 'Armillaria Root Disease — Forest Insect & Disease Leaflet',
    authors: 'USDA Forest Service', institution: 'USDA Forest Service',
    venue: 'Forest Insect & Disease Leaflets', year: 2011,
    url: 'https://research.fs.usda.gov/treesearch', openAccess: true,
    finding: 'Root-zone disease; not visible above ground without excavation.',
    uncertainty: 'HARD STOP — cannot be called from anything visible in a photo.',
  },
];

/** Copyrighted standards. Referenced by clause, never reproduced (§6U.3). */
export const NEVER_REPRODUCE = ['ANSI A300', 'ANSI Z133'] as const;

export interface CorpusQuery {
  section?: CorpusSection;
  /** Free text over title, finding and authors. */
  text?: string;
  /** Only sources directly applicable to the Hampton Roads coastal plain. */
  regionalOnly?: boolean;
  /** Only sources anybody can open and check. */
  openAccessOnly?: boolean;
}

export interface CorpusResult {
  entries: CorpusEntry[];
  /** Entries returned that carry an Appendix C uncertainty flag. */
  contested: number;
  /** Excluded by openAccessOnly — counted, never silently dropped (§1B). */
  paywalledHeld: number;
  /** True when the corpus has entries but none matched. */
  noMatch: boolean;
}

/**
 * Search the corpus. Foundational (★) sources sort first — when an agent asks
 * about decay it should meet Shigo before it meets a commentary on Shigo.
 */
export function searchCorpus(q: CorpusQuery = {}): CorpusResult {
  const terms = (q.text ?? '').toLowerCase().split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => t.length > 2);

  let pool = CORPUS;
  if (q.section) pool = pool.filter((e) => e.section === q.section);
  if (q.regionalOnly) pool = pool.filter((e) => e.regional);

  const beforePaywallFilter = pool.length;
  if (q.openAccessOnly) pool = pool.filter((e) => e.openAccess);
  const paywalledHeld = beforePaywallFilter - pool.length;

  const matched = terms.length === 0 ? pool : pool.filter((e) => {
    const hay = `${e.title} ${e.finding} ${e.authors} ${e.institution}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });

  const entries = [...matched].sort((a, b) =>
    Number(b.foundational) - Number(a.foundational)
    || Number(b.regional) - Number(a.regional)
    || a.year - b.year);

  return {
    entries,
    contested: entries.filter((e) => e.uncertainty !== null).length,
    paywalledHeld,
    // "Nothing matched" and "the corpus is empty" are different facts (§1B).
    noMatch: entries.length === 0 && CORPUS.length > 0,
  };
}
