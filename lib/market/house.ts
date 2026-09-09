import type { Rfp } from "./types";

/**
 * What Yuzu delivers when no model supplier will answer.
 *
 * The market's normal path takes work from a seller, which here means asking
 * our own analyst model to answer as that seller. So when every supplier
 * refuses at once — Groq rate limited, OpenRouter out of credit, Gemini rate
 * limited — there is no seller work to take, and the honest options are two: a
 * well-written apology, or something the buyer can actually use.
 *
 * This is the second one. It is a fixed template, filled with the buyer's own
 * words, and it is labelled as such everywhere it appears. Nothing here is
 * generated: `houseWork` is a pure function of the RFP, so the same brief
 * produces the same artifact byte for byte, and a reader can check that claim
 * by running it twice.
 *
 * The design rule throughout: a slot the brief answers is filled from the
 * brief, and a slot the brief does not answer is marked `[BRIEF DID NOT SAY:
 * ...]` rather than invented. Filling those gaps is exactly what a model does
 * and exactly what this cannot do, and pretending otherwise would make the
 * fallback a worse lie than the apology it replaces. It is also the more useful
 * shape: what comes back is a scaffold with the unknowns named, and naming them
 * is most of the work.
 */

/** Stamped at the top and the bottom of every house artifact. Checked by the verifier and by the tests. */
export const HOUSE_MARKER = "HOUSE-PRODUCED DELIVERABLE - NOT THE SELLER'S WORK";

/** How an unfilled slot is written. Never filled in, always counted. */
export const GAP_MARKER = "[BRIEF DID NOT SAY:";

export interface HouseWork {
  readonly output: string;
  /** Primary items the artifact contains — taglines, shots, questions. Checked against `requested`. */
  readonly produced: number;
  /** Items the brief asked for, when it named a number and the family produces countable items. */
  readonly requested?: number;
  /** Slots the brief did not answer, left marked rather than invented. */
  readonly openSlots: number;
}

export function houseWork(rfp: Rfp, sellerName: string, upstream: string): HouseWork {
  const brief = read(rfp);
  const family = rfp.capability.split(".")[0] ?? "research";
  const body =
    family === "copy"
      ? copy(brief)
      : family === "creative"
        ? creative(brief)
        : family === "analysis"
          ? analysis(brief)
          : research(brief);

  const output = [header(rfp, sellerName, upstream), body.text, constraints(rfp), footer(sellerName)].join("\n\n");

  return {
    output,
    produced: body.produced,
    requested: body.requested,
    openSlots: output.split(GAP_MARKER).length - 1,
  };
}

// ── reading the brief ─────────────────────────────────────────────────────
// Everything below is extraction, never invention. A value that is not in the
// buyer's own text comes back undefined, and the artifact says so where it
// would have used it.

interface Brief {
  readonly rfp: Rfp;
  /** The thing the goal is about, lifted out of the goal's own words. */
  readonly topic: string;
  readonly audience?: string;
  /** Capitalised runs in the goal: the closest thing to named entities available without browsing. */
  readonly entities: readonly string[];
  readonly keywords: readonly string[];
  readonly figures: readonly string[];
  readonly sentences: readonly string[];
  /** A count the brief actually asked for, e.g. "five taglines". */
  readonly count?: number;
}

const STOPWORDS = new Set(
  (
    "a an the and or but for to of in on with by from as at is are am was were be been being i we you it its this that " +
    "these those my our your their need needs needed want wants would like please help me us get make made write " +
    "writing so if then than about into out up down can could should will shall have has had do does did not no yes " +
    "just very really new some any all more most who what when where why how"
  ).split(" "),
);

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function read(rfp: Rfp): Brief {
  const goal = rfp.goal.trim();
  // A sentence-initial capital says nothing about whether a word names
  // anything, so the run has to start somewhere other than after a full stop.
  const entities = [
    ...new Set((goal.match(/(?<![.!?]\s)(?<!^)\b[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*/g) ?? []).map((run) => run.trim())),
  ]
    .filter((run) => run.length > 1 && !STOPWORDS.has(run.toLowerCase()))
    .slice(0, 8);

  // Words about the request are not words about the subject. "Write five
  // taglines for Ember" is a brief whose distinctive word is Ember; carrying
  // "taglines" through as though it described the product produced the line
  // "Taglines. Ember." and a keyword list that described the purchase order.
  const meta = new Set([...rfp.capability.split(/[.\s]/), ...META]);
  const words = goal.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [];
  const keywords = [...new Set(words.filter((word) => word.length > 2 && !STOPWORDS.has(word) && !meta.has(word)))];

  return {
    rfp,
    topic: topicOf(goal, keywords, entities, meta),
    audience: audienceOf(goal, meta),
    entities,
    keywords: keywords.slice(0, 12),
    figures: [
      ...new Set(goal.match(/(?:[$£€]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\b)/g) ?? []),
    ],
    sentences: goal
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 8),
    count: countOf([rfp.goal, rfp.deliverable, ...rfp.constraints].join(" ")),
  };
}

/**
 * The subject, taken from the goal rather than guessed at.
 *
 * A buyer's goal is nearly always "<framing verb> <the thing>": launching a
 * coffee brand, copy for our API console, a brief on the freight market. The
 * phrase after the verb is the subject, and when no verb matches, the goal's
 * own strongest content words are a duller but equally honest answer.
 */
function topicOf(goal: string, keywords: readonly string[], entities: readonly string[], meta: ReadonlySet<string>): string {
  // "a coffee brand called Ember" names itself. Take the name over the
  // description: the phrase-after-the-verb rule below otherwise stops mid-way
  // and returns "coffee brand called", which reads as a template that cannot
  // finish a sentence.
  const named = /\b(?:called|named)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/.exec(goal);
  if (named?.[1] !== undefined) return named[1];

  const candidates = [
    ...goal.matchAll(
      // The phrase is matched by lookahead so it is not consumed. Capturing it
      // normally ate the next trigger word: "for a launch film for Ember cold
      // brew" yielded only "launch film", because the first match swallowed the
      // second "for" and the subject was never a candidate at all.
      /\b(?:launch(?:ing)?|promot(?:e|ing)|sell(?:ing)?|build(?:ing)?|market(?:ing)?|announc(?:e|ing)|about|for|on|covering)\s+(?:a|an|the|my|our|their|its)?\s*(?=([A-Za-z0-9][\w'-]*(?:\s+[A-Za-z0-9][\w'-]*){0,2}))/g,
    ),
  ]
    .map((match) => {
      // Truncate at the first word that does not belong, never splice it out.
      // A noun phrase is contiguous: dropping the middle of "film for Ember"
      // produced "film Ember", which is not a phrase anyone wrote.
      const kept: string[] = [];
      for (const word of (match[1] ?? "").split(/\s+/)) {
        const lower = word.toLowerCase();
        if (word.length === 0 || STOPWORDS.has(lower) || meta.has(lower)) break;
        kept.push(word);
      }
      // A phrase that ends on a connective is a phrase that was cut off.
      while (kept.length > 1 && DANGLING.has(kept[kept.length - 1]!.toLowerCase())) kept.pop();
      return kept.join(" ");
    })
    .filter((phrase) => phrase.length > 0);

  // "a six shot list for a launch film for Ember cold brew" has three of these.
  // The one carrying a name is the subject; failing that the last one is,
  // because a request states its own shape first and what it is about last.
  const named_ = candidates.find((phrase) => entities.some((entity) => phrase.includes(entity)));
  const chosen = named_ ?? candidates.at(-1);
  if (chosen !== undefined) return chosen;

  const fallback = keywords.slice(0, 3).join(" ");
  return fallback.length > 0 ? fallback : goal.slice(0, 60);
}

/**
 * Who the work is for, when the brief says.
 *
 * Deliberately only matches a lowercase phrase. "Write five taglines for Ember,
 * a cold brew for night-shift nurses" has two `for`s, and the capitalised one
 * is a product name: taking it produced "Ember, for Ember." A named thing is
 * not an audience, and a common noun almost always is.
 */
function audienceOf(goal: string, meta: ReadonlySet<string>): string | undefined {
  for (const match of goal.matchAll(/(?:[Ff]or|[Aa]imed at|[Tt]argeting|[Ss]old to)\s+([a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,3})/g)) {
    const kept = (match[1] ?? "")
      .split(/\s+/)
      .filter((word) => !STOPWORDS.has(word.toLowerCase()) && !meta.has(word.toLowerCase()));
    if (kept.length > 0 && kept.join(" ").length > 2) return kept.join(" ");
  }
  return undefined;
}

/** Words that describe the purchase rather than the subject of it. */
const META = [
  "brief", "briefs", "tagline", "taglines", "copy", "shotlist", "shot", "shots", "list", "paragraph",
  "announcement", "review", "analysis", "numbers", "positioning", "concept", "concepts", "deliverable",
  "markdown", "json", "words", "word", "sentence", "sentences", "draft", "version",
];

/** Words a lifted phrase must not end on, because ending there means it was truncated. */
const DANGLING = new Set(["called", "named", "which", "whose", "using", "against", "versus", "vs"]);

/** A number the brief attached to a plural: "five taglines", "3 competitors". */
function countOf(text: string): number | undefined {
  const match = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:[a-z-]+\s+){0,2}?[a-z-]+s\b/i.exec(text);
  const token = match?.[1]?.toLowerCase();
  if (token === undefined) return undefined;
  const value = NUMBER_WORDS[token] ?? Number.parseInt(token, 10);
  return Number.isFinite(value) && value >= 1 && value <= 20 ? value : undefined;
}

// ── shared furniture ──────────────────────────────────────────────────────

const RULE = "=".repeat(66);

function gap(what: string): string {
  return `${GAP_MARKER} ${what}]`;
}

function wrap(text: string, indent = ""): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line.length > 0 && `${line} ${word}`.length + indent.length > 72) {
      lines.push(line);
      line = word;
    } else {
      line = line.length > 0 ? `${line} ${word}` : word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.map((entry) => `${indent}${entry}`).join("\n");
}

/** A wrapped bullet: the dash on the first line, hanging indent on the rest. */
function bullet(text: string): string {
  return wrap(text, "    ").replace(/^ {4}/, "  - ");
}

function field(label: string, text: string): string {
  return `${label}\n${wrap(text, "  ")}`;
}

function header(rfp: Rfp, sellerName: string, upstream: string): string {
  return [
    RULE,
    HOUSE_MARKER,
    RULE,
    field(
      "Produced by",
      "Yuzu's own house template. Deterministic string assembly over your brief. No language model wrote any part of what follows, and none was available to.",
    ),
    field(
      "Contracted seller",
      `${sellerName}. ${sellerName} did not write this, was not paid for it, and its reputation did not move on it. It was never actually asked.`,
    ),
    field(
      "Why the house delivered",
      `Every model supplier refused the delivery call (${upstream}). With no supplier there is no way to take work from a seller at all, so the market fulfilled the contract itself rather than returning an apology and leaving the goal unanswered.`,
    ),
    field("Capability", rfp.capability),
    field("Brief", rfp.deliverable),
    field(
      "How to read this",
      `Every line below is either a fixed heading from this template or a phrase copied out of your own brief. Where the brief did not answer something the slot is marked ${GAP_MARKER} ...] and left open. A model would have filled those in. This cannot, and does not pretend to.`,
    ),
    RULE,
  ].join("\n");
}

function constraints(rfp: Rfp): string {
  if (rfp.constraints.length === 0) {
    return ["CONSTRAINTS YOU SET", wrap("None were extracted from your goal, so none were carried through.", "  ")].join("\n");
  }
  return [
    "CONSTRAINTS YOU SET",
    wrap(
      "Each is repeated verbatim and carried into the sections above as an open item. A template can carry a constraint; it cannot judge whether the finished work meets it, and it does not claim to.",
      "  ",
    ),
    "",
    ...rfp.constraints.map((line, index) => `  ${index + 1}. ${line}\n     Status: carried through, not verified by the house.`),
  ].join("\n");
}

function footer(sellerName: string): string {
  return [
    RULE,
    "WHAT THIS TEMPLATE DID NOT DO",
    bullet("No research. Nothing here came from outside the brief you sent: no browsing, no sources, no facts about the world."),
    bullet("No judgement. It has no opinion about whether any of this is good, and the verification attached to it is structural only."),
    bullet(
      `No substitute for ${sellerName}. When a supplier answers again, re-run the same goal and the seller produces the work under the same contract terms.`,
    ),
    bullet(
      "You were not charged. A house-fulfilled deal settles at zero credits, because the price was negotiated against a seller's listing and a seller's proof, and neither of those priced this.",
    ),
    RULE,
    HOUSE_MARKER,
    RULE,
  ].join("\n");
}

interface Body {
  readonly text: string;
  readonly produced: number;
  readonly requested?: number;
}

// ── research.brief, research.positioning ──────────────────────────────────

const RESEARCH_QUESTIONS: readonly string[] = [
  "Who is this for?",
  "What is it, in one noun phrase?",
  "What category does it compete in?",
  "Who else is already in that category?",
  "What does it do that they do not?",
  "What would make a buyer switch?",
  "What evidence exists for that claim?",
  "What is the one sentence a buyer repeats to a colleague?",
];

function research(brief: Brief): Body {
  const answers: readonly (string | undefined)[] = [
    brief.audience,
    brief.topic,
    undefined,
    // Every capitalised run in the goal, including the buyer's own product.
    // Sorting your name from theirs takes knowledge the template does not have,
    // and quietly presenting the buyer's own brand as a competitor would be the
    // template inventing a finding.
    brief.entities.length > 0
      ? `${brief.entities.join(", ")}\n     (every name in your goal. The template cannot tell yours from theirs.)`
      : undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const open = answers.filter((answer) => answer === undefined).length;

  return {
    text: [
      "1. WHAT YOU ASKED FOR",
      `  Goal, as you sent it:\n${wrap(`"${brief.rfp.goal}"`, "    ")}`,
      `  Deliverable: ${brief.rfp.deliverable}`,
      `  Subject, lifted from your goal: ${brief.topic}`,
      `  Audience: ${brief.audience ?? gap("who this is for")}`,
      "",
      "2. NAMED IN YOUR BRIEF",
      brief.entities.length > 0
        ? brief.entities.map((entity) => `  - ${entity}`).join("\n")
        : wrap(
            "Nothing in your goal reads as a name, so this template has no competitors, products or organisations to work from. That is a fact about the brief rather than about the market.",
            "  ",
          ),
      "",
      "3. THE QUESTIONS A BRIEF ON THIS HAS TO ANSWER",
      wrap("Answered from your brief where your brief answered them, and left open where it did not.", "  "),
      "",
      ...RESEARCH_QUESTIONS.map(
        (question, index) => `  ${index + 1}. ${question}\n     ${answers[index] ?? gap("this was not in your goal")}`,
      ),
      "",
      "4. POSITIONING LINE, ASSEMBLED FROM THE ABOVE",
      wrap(
        `For ${brief.audience ?? gap("audience")}, ${brief.topic} is the ${gap("category")} that ${gap("the one thing only it does")}.`,
        "  ",
      ),
      "",
      "5. THE NEXT FIVE MINUTES",
      bullet(`Fill the open slots in sections 3 and 4. There are ${open} of them in section 3.`),
      bullet("Re-run this goal once a supplier answers; the seller writes the prose that goes around this."),
      bullet("Nothing above needs deleting. The scaffold is what the finished brief gets checked against."),
    ].join("\n"),
    produced: RESEARCH_QUESTIONS.length,
  };
}

// ── copy.taglines, copy.announcement ──────────────────────────────────────

interface Frame {
  readonly line: string;
  readonly angle: string;
  readonly check: string;
}

function frames(brief: Brief): readonly Frame[] {
  const topic = title(brief.topic);
  const audience = brief.audience ?? gap("who it is for");
  const verb = brief.keywords.find((word) => /(?:ing|es|s)$/.test(word)) ?? brief.keywords[1] ?? "works";
  return [
    {
      line: `${topic}.`,
      angle: "Name only. The safest line in the set and the one every other line has to beat.",
      check: "Does the name carry the category on its own? If not, this line is doing nothing.",
    },
    {
      line: `${topic}, for ${audience}.`,
      angle: "Audience first. Narrows on purpose, and loses everyone outside the segment.",
      check: "Is the audience specific enough that someone outside it self-selects out?",
    },
    {
      line: `${topic}, without the ${gap("the thing your buyer dreads")}.`,
      angle: "Contrast. Sells against the incumbent's worst feature rather than your best one.",
      check: "Name the dread out loud. If you cannot, this frame is not yours to use.",
    },
    {
      line: `The ${brief.topic} that ${gap("the one thing only you do")}.`,
      angle: "Category claim. The strongest line in the set when the blank is true, and worthless when it is not.",
      check: "Could a competitor drop their name into this sentence? If yes, it is not a claim.",
    },
    {
      line: `${title(verb)}. ${topic}.`,
      angle: `Verb first, using "${verb}" from your own goal text.`,
      check: "Read it aloud. Two-beat lines fail on the page more often than in the head.",
    },
    {
      line: `Why settle for ${gap("the incumbent")}?`,
      angle: "Question. Frames the buyer as already dissatisfied, which they may not be.",
      check: "Only ship this if the incumbent is genuinely disliked rather than merely large.",
    },
    {
      line: `${topic}: ${brief.keywords.slice(0, 3).join(", ") || gap("three words from your brief")}.`,
      angle: "List. Blunt, scannable, and taken straight from the words you used.",
      check: "Three words, not four. Cut the weakest one.",
    },
  ];
}

function copy(brief: Brief): Body {
  const wanted = Math.min(10, Math.max(3, brief.count ?? 5));
  const pool = frames(brief);
  const chosen = Array.from({ length: wanted }, (_, index) => pool[index % pool.length]!);
  const topic = title(brief.topic);

  return {
    text: [
      `1. TAGLINES (${wanted} asked for, ${wanted} produced)`,
      wrap(
        "Each line is a fixed rhetorical frame filled with your own words. The frame is named so you can see the angle rather than reverse-engineer it, and every line carries the one check that would kill it.",
        "  ",
      ),
      "",
      ...chosen.map(
        (frame, index) =>
          `  ${index + 1}. ${frame.line}\n${wrap(`Angle: ${frame.angle}`, "     ")}\n${wrap(`Check: ${frame.check}`, "     ")}`,
      ),
      "",
      "2. LAUNCH PARAGRAPH, ASSEMBLED",
      wrap(
        "Sixty words is roughly five sentences. The skeleton below is those five, in the order that survives being skimmed.",
        "  ",
      ),
      "",
      `  1. What it is:       ${topic} is ${gap("the category, in three words")}.`,
      `  2. Who it is for:    Built for ${brief.audience ?? gap("the audience")}.`,
      `  3. What it does:     ${brief.sentences[0] ?? brief.rfp.goal}`,
      `  4. Why it is better: ${gap("the one comparison you can defend")}`,
      `  5. What to do next:  ${gap("the single call to action")}`,
      "",
      "3. WORDS TAKEN FROM YOUR OWN BRIEF",
      wrap(
        brief.keywords.length > 0
          ? brief.keywords.join(", ")
          : "None. Your goal was short enough that the template had nothing distinctive to reuse.",
        "  ",
      ),
    ].join("\n"),
    produced: wanted,
    requested: wanted,
  };
}

function title(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── creative.shotlist, creative.concept ───────────────────────────────────

interface Beat {
  readonly name: string;
  readonly camera: string;
  readonly purpose: string;
}

const ARC: readonly Beat[] = [
  { name: "HOOK", camera: "Close, handheld, subject enters an empty frame.", purpose: "Earn the next two seconds and nothing more." },
  { name: "PROBLEM", camera: "Wide, locked off, the mess in full.", purpose: "Show the state of things before the product exists." },
  { name: "PRODUCT", camera: "Medium, slow push in, product centred.", purpose: "The first clear look. One object, one gesture." },
  { name: "PROOF", camera: "Insert, macro, hands and screen only.", purpose: "The thing working, shown rather than claimed." },
  { name: "USE", camera: "Over the shoulder, natural light, real setting.", purpose: "Someone the viewer recognises, using it unremarkably." },
  { name: "CLOSE", camera: "Static, product and wordmark, room to breathe.", purpose: "Name, one line, one action." },
];

function creative(brief: Brief): Body {
  const wanted = Math.min(8, Math.max(4, brief.count ?? ARC.length));
  const seconds = 3;

  return {
    text: [
      `1. SHOT LIST (${wanted} shots, ${wanted * seconds}s total at ${seconds}s each)`,
      wrap(
        `A fixed launch arc applied to "${brief.topic}". The arc is the template's; the subject, the on-screen lines and the named things are yours.`,
        "  ",
      ),
      "",
      ...Array.from({ length: wanted }, (_, index) => {
        const beat = ARC[index % ARC.length]!;
        const start = index * seconds;
        const line =
          index === 0
            ? `${title(brief.topic)}.`
            : index === wanted - 1
              ? `${title(brief.topic)}. ${gap("the call to action")}`
              : (brief.sentences[index - 1] ?? gap("an on-screen line for this beat"));
        return [
          `  SHOT ${index + 1} / ${clock(start)}-${clock(start + seconds)}  ${beat.name}`,
          `    Camera:    ${beat.camera}`,
          `    Purpose:   ${beat.purpose}`,
          `    On screen: ${line}`,
          `    Needs:     ${index === 2 ? gap("brand colour, in hex") : index === 4 ? gap("who is on camera") : gap("the location")}`,
        ].join("\n");
      }),
      "",
      "2. WHAT THE BRIEF GAVE THESE SHOTS",
      brief.entities.length > 0
        ? brief.entities.map((entity) => `  - ${entity}`).join("\n")
        : wrap("No names appeared in your goal, so every on-screen line above is either your own sentence or an open slot.", "  "),
      "",
      "3. WHAT A SHOT LIST STILL NEEDS FROM YOU",
      bullet("A brand colour in hex, and a wordmark file."),
      bullet("Who is on camera, and whether they speak."),
      bullet("The one action the last frame asks for."),
    ].join("\n"),
    produced: wanted,
    requested: wanted,
  };
}

function clock(seconds: number): string {
  return `0:${String(seconds).padStart(2, "0")}`;
}

// ── analysis.numbers, analysis.review ─────────────────────────────────────

function analysis(brief: Brief): Body {
  const figures = brief.figures;
  return {
    text: [
      `1. FIGURES FOUND IN THE BRIEF (${figures.length})`,
      figures.length === 0
        ? wrap(
            "None. Your goal contains no numbers, so there is no arithmetic to check, and that is a finding about the brief rather than about your figures.",
            "  ",
          )
        : figures
            .map((figure, index) =>
              [
                `  ${index + 1}. ${figure}`,
                `     Of what:          ${gap("what this figure measures")}`,
                `     Over what period: ${gap("the period")}`,
                `     Source:           ${gap("where this figure came from")}`,
                wrap(
                  "Checkable from the brief alone: no. A figure with no stated source is not a claim this or any other reviewer can settle.",
                  "     ",
                ),
              ].join("\n"),
            )
            .join("\n"),
      "",
      `2. CLAIMS FOUND IN THE BRIEF (${brief.sentences.length})`,
      wrap(
        "Each sentence of your goal, marked for what it would take to settle it. A sentence that only refers to the rest of your own text is checkable here; one that refers to the world is not, because this template does not browse.",
        "  ",
      ),
      "",
      ...brief.sentences.map((sentence, index) =>
        [
          `  S${index + 1}. ${sentence}`,
          `      Settles against: ${/\d/.test(sentence) ? "a source you did not supply" : "the rest of your own brief"}`,
        ].join("\n"),
      ),
      "",
      "3. ARITHMETIC",
      wrap(
        figures.length < 2
          ? `Nothing to recompute. The brief supplied ${figures.length} figure${figures.length === 1 ? "" : "s"} and no stated relationship between any of them, so there is no sum, ratio or total to check.`
          : `The brief supplied ${figures.length} figures and no stated relationship between them. Say which is a part of which and the arithmetic becomes checkable; until then, listing them is the whole of what can honestly be done.`,
        "  ",
      ),
      "",
      "4. WHAT WOULD SETTLE EACH OPEN ITEM",
      bullet("For every figure: its unit, its period, and the document it came from."),
      bullet("For every claim marked as needing a source: that source, inline."),
      bullet("Re-run this goal once a supplier answers, so the seller reviews the content rather than the shape."),
    ].join("\n"),
    produced: brief.sentences.length,
  };
}
