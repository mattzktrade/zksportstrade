/**
 * British English help for CRM notes.
 * Clear typos are replaced. American spellings are replaced only when typed in lowercase.
 * Capitalised words that are not known typos are left alone, so names stay as typed.
 */

const TYPOS: Record<string, string> = {
  accomodation: "accommodation",
  acommodation: "accommodation",
  accommodaton: "accommodation",
  adn: "and",
  ahve: "have",
  alot: "a lot",
  arguement: "argument",
  aswell: "as well",
  availible: "available",
  avaliable: "available",
  beacuse: "because",
  becasue: "because",
  becouse: "because",
  becuase: "because",
  begining: "beginning",
  beggining: "beginning",
  calender: "calendar",
  cant: "can't",
  collegue: "colleague",
  commitee: "committee",
  comittee: "committee",
  concensus: "consensus",
  coudl: "could",
  couldnt: "couldn't",
  definately: "definitely",
  definatly: "definitely",
  definitly: "definitely",
  didnt: "didn't",
  dilema: "dilemma",
  dont: "don't",
  eachother: "each other",
  embarass: "embarrass",
  enqiries: "enquiries",
  enqiriies: "enquiries",
  enquirys: "enquiries",
  enquries: "enquiries",
  enquriies: "enquiries",
  enqiry: "enquiry",
  enquriy: "enquiry",
  enqury: "enquiry",
  equiry: "enquiry",
  existance: "existence",
  experiance: "experience",
  finaly: "finally",
  foriegn: "foreign",
  foward: "forward",
  freind: "friend",
  garantee: "guarantee",
  gaurd: "guard",
  goverment: "government",
  governement: "government",
  harrass: "harass",
  het: "the",
  hte: "the",
  hvae: "have",
  im: "I'm",
  immediatly: "immediately",
  incase: "in case",
  independant: "independent",
  infront: "in front",
  intrest: "interest",
  intrested: "interested",
  intresting: "interesting",
  isnt: "isn't",
  ive: "I've",
  knowlege: "knowledge",
  liason: "liaison",
  libary: "library",
  maintainance: "maintenance",
  millenium: "millennium",
  mispell: "misspell",
  nad: "and",
  neccessary: "necessary",
  neccesary: "necessary",
  necesary: "necessary",
  noticable: "noticeable",
  ocassion: "occasion",
  ocasions: "occasions",
  occassion: "occasion",
  occassions: "occasions",
  occured: "occurred",
  occurance: "occurrence",
  occurence: "occurrence",
  occuring: "occurring",
  ocurred: "occurred",
  oppurtunity: "opportunity",
  oportunity: "opportunity",
  oyu: "you",
  payed: "paid",
  peice: "piece",
  persistant: "persistent",
  posession: "possession",
  prefered: "preferred",
  privelege: "privilege",
  priviledge: "privilege",
  publically: "publicly",
  quater: "quarter",
  questionaire: "questionnaire",
  realy: "really",
  realli: "really",
  reccomend: "recommend",
  recieve: "receive",
  recieved: "received",
  reciept: "receipt",
  recomend: "recommend",
  refered: "referred",
  relevent: "relevant",
  religous: "religious",
  repitition: "repetition",
  restaraunt: "restaurant",
  restraunt: "restaurant",
  resturant: "restaurant",
  seige: "siege",
  sentance: "sentence",
  seperate: "separate",
  seperated: "separated",
  seperately: "separately",
  shoudl: "should",
  shouldnt: "shouldn't",
  succesful: "successful",
  successfull: "successful",
  suprise: "surprise",
  surprize: "surprise",
  taht: "that",
  teh: "the",
  tendancy: "tendency",
  thats: "that's",
  theres: "there's",
  theyre: "they're",
  thier: "their",
  tommorow: "tomorrow",
  tommorrow: "tomorrow",
  tomorow: "tomorrow",
  tounge: "tongue",
  truely: "truly",
  unfortunatly: "unfortunately",
  untill: "until",
  usefull: "useful",
  vehical: "vehicle",
  waht: "what",
  wasnt: "wasn't",
  wensday: "Wednesday",
  whcih: "which",
  wich: "which",
  wiht: "with",
  wnat: "want",
  wont: "won't",
  wouldnt: "wouldn't",
  woudl: "would",
  writting: "writing",
  youre: "you're",
  yuo: "you",
}

/** Lowercase American spellings. Title case is left alone so surnames such as Gray stay put. */
const BRITISH: Record<string, string> = {
  aging: "ageing",
  aluminum: "aluminium",
  analyze: "analyse",
  analyzed: "analysed",
  apologize: "apologise",
  apologized: "apologised",
  canceled: "cancelled",
  canceling: "cancelling",
  celiac: "coeliac",
  center: "centre",
  centers: "centres",
  color: "colour",
  colored: "coloured",
  coloring: "colouring",
  colors: "colours",
  defense: "defence",
  diarrhea: "diarrhoea",
  favor: "favour",
  favorable: "favourable",
  favorite: "favourite",
  favorites: "favourites",
  favors: "favours",
  fulfill: "fulfil",
  fulfilled: "fulfilled",
  fulfilling: "fulfilling",
  fulfillment: "fulfilment",
  gray: "grey",
  honor: "honour",
  honorable: "honourable",
  honors: "honours",
  jewelry: "jewellery",
  labeled: "labelled",
  labeling: "labelling",
  offense: "offence",
  organize: "organise",
  organized: "organised",
  organizes: "organises",
  organizing: "organising",
  organization: "organisation",
  organizations: "organisations",
  realize: "realise",
  realized: "realised",
  realizing: "realising",
  recognize: "recognise",
  recognized: "recognised",
  recognizing: "recognising",
  theater: "theatre",
  theaters: "theatres",
  traveled: "travelled",
  traveler: "traveller",
  travelers: "travellers",
  traveling: "travelling",
}

// Both sides of a one-swap pair must be listed, otherwise "three" can become "there".
const WORDS = `
a about above across after again against all almost already also although always am among an and another any anyone anything are around as ask asked asking at available availability away
back be because been before begin beginning being believe believed between book booked booking bookings both bring brought but by
call called can centre centres champion champions change changed check client clients close closed club colour colours come comes coming confirm confirmation confirmed could
day days deal deals deposit did do does doing done down during
each enquiry enquiries enquire enquired enquiring even ever every everyone everything
favour favourite favourites feel few finally find first for form from friday full further
get gets getting give given go going gone good got great guest guests
had has have having he her here hers him his hospitality hotel hotels how
if in include included interest interested into invoice invoices is it its it's
just
keep kept know known
last later leave left let licence like little live long look looked lot lots
made make makes making many may me meet meeting might monday more most move much must my
need needed needs never next night no not note notes now
of off offer offered often on once one only open or order orders organised other our out over own
package packages paddock paid pay payment payments people place please possible practice practise programme program put
qualifying quarter question questions
race races really receipt receive received recommend referred right
said same saturday say says see seen separate separated separately set she should show so some someone something soon still such sunday supplier suppliers sure
take taken tell than thank thanks that the their them then there these they this those three through ticket tickets time to today together tomorrow too tuesday thursday
under until up us use used useful
very via
want wanted wants was we wednesday week weekend well were what when where which while who will with within without work worked working would
year years yes yesterday you your
able accept accepted access accessible accessibility accommodation account accounts across activity add added address after agent agents agree agreed airport allergy allergies already arrival arrive arrived ask available balance before budget busy
calendar called cancelled cancellation car cars card cards cash change charge charged check choice choose chosen city class clear close collect collected come company complete completed contact contacted continue continued contract copy cost costs course cover covered
deliver delivered delivery details dietary did dinner do during early easy else email emails end enough evening event events expect expected experience explain explained extra
family feel festival final find fine finish finished flight flights follow followed food for friday friend friends full
grandstand group groups guarantee guest guide
half hand happy have hear heard help helped hold holds holder holders home hope hour hours house however
include information instead issue issues
keep kind knew
large last late later least leave less level list little local long look love lunch
many match maybe mean means meant meet message might mile miles mind minute minutes moment money month months morning move moved
name names near need next night nothing number numbers
off office often okay once only open option options other otherwise own
part party pass passed people person phone place plan planned please plus point possible prefer preferred present price prices probably problem provide provided public put
question quick quietly quite
read ready reason remember remembered reply request requested require required rest return returned room rooms run
same save saved see seem seemed send sent service services set several share short should show shown side since single sit sitting size small soon sort speak special spend spent spoke spoken staff stand start started stay stayed still stop stopped such suggest suggested support sure
talk talked team tell told term terms thing things think thinking thought though till time today told took total towards travel travelled travelling trip true try turn turned
under understand understood until update updated upon use usually
wait walk want watch way week well went while whole wish within without word words work world write written wrong
abu dhabi austin australia austria azerbaijan bahrain barcelona belgium brazil britain british budapest canada catalunya china imola interlagos italy japan jeddah las vegas london lusail melbourne mexico miami monaco montreal monza netherlands paris qatar saudi shanghai silverstone singapore spa spielberg suzuka uk united states vegas yas zandvoort
angel angle board broad casual causal cloud could quiet quite three there trail trial united untied
`

const LETTERS = "abcdefghijklmnopqrstuvwxyz"
const WORD_PATTERN = /[A-Za-z]+(?:'[A-Za-z]+)*/g

const DICTIONARY = buildDictionary(WORDS, TYPOS, BRITISH)

function buildDictionary(
  words: string,
  typos: Record<string, string>,
  british: Record<string, string>,
): Set<string> {
  const dictionary = new Set<string>()
  for (const word of words.split(/\s+/)) {
    const cleaned = word.trim().toLowerCase()
    if (cleaned) dictionary.add(cleaned)
  }
  for (const replacement of [...Object.values(typos), ...Object.values(british)]) {
    for (const part of replacement.split(/\s+/)) {
      const cleaned = part.toLowerCase()
      if (/[a-z]/.test(cleaned)) dictionary.add(cleaned)
    }
  }
  return dictionary
}

type WordShape = "lower" | "title" | "upper" | "mixed"

function wordShape(word: string): WordShape {
  if (word === word.toLowerCase()) return "lower"
  if (word === word.toUpperCase()) return "upper"
  if (word.slice(1) === word.slice(1).toLowerCase()) return "title"
  return "mixed"
}

function applyCase(original: string, replacement: string): string {
  if (original === original.toLowerCase()) return replacement
  if (replacement[0] === replacement[0]?.toUpperCase()) return replacement
  return replacement[0].toUpperCase() + replacement.slice(1)
}

function isDoubleLetterEdit(longer: string, shorter: string): boolean {
  if (longer.length !== shorter.length + 1) return false
  let index = 0
  while (index < shorter.length && shorter[index] === longer[index]) index += 1
  if (shorter.slice(index) !== longer.slice(index + 1)) return false
  const extra = longer[index]
  return extra === longer[index - 1] || extra === longer[index + 1]
}

function uniqueEdit(word: string): string | null {
  const hits = new Set<string>()

  const consider = (candidate: string, kind: "transpose" | "double" | "indel") => {
    if (kind === "indel") return
    if (!DICTIONARY.has(candidate) || candidate === word) return
    hits.add(candidate)
  }

  for (let index = 0; index <= word.length; index += 1) {
    const left = word.slice(0, index)
    const right = word.slice(index)
    if (right.length > 1) {
      consider(left + right[1] + right[0] + right.slice(2), "transpose")
    }
    if (right) {
      const deleted = left + right.slice(1)
      consider(deleted, isDoubleLetterEdit(word, deleted) ? "double" : "indel")
    }
    for (const letter of LETTERS) {
      const inserted = left + letter + right
      consider(inserted, isDoubleLetterEdit(inserted, word) ? "double" : "indel")
    }
  }

  if (hits.size !== 1) return null
  return [...hits][0] ?? null
}

export function correctToken(word: string): string {
  const shape = wordShape(word)
  if (shape === "upper" || shape === "mixed" || word.length < 2) return word

  const lower = word.toLowerCase()
  const typo = TYPOS[lower]
  if (typo) return applyCase(word, typo)
  if (shape === "lower") {
    const british = BRITISH[lower]
    if (british) return british
    if (DICTIONARY.has(lower) || lower.length < 4) return word
    return uniqueEdit(lower) ?? word
  }
  return word
}

function isProtected(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? ""
  const after = text[end] ?? ""
  if (/[@/\\_#&\-\d]/.test(before) || /[@/\\_#&\-\d]/.test(after)) return true
  if (before === ".") return true
  if (after === ".") {
    const afterDot = text[end + 1] ?? ""
    if (/[A-Za-z]/.test(afterDot)) return true
    if (end - start <= 2) return true
  }
  return false
}

export function correctProse(text: string): string {
  return text.replace(WORD_PATTERN, (word, index: number) => {
    if (isProtected(text, index, index + word.length)) return word
    return correctToken(word)
  })
}

export function correctCompletedWord(
  text: string,
  caret: number,
): { value: string; caret: number } | null {
  if (caret <= 0) return null
  if (/[A-Za-z']/.test(text[caret] ?? "")) return null

  let start = caret
  while (start > 0 && /[A-Za-z']/.test(text[start - 1] ?? "")) start -= 1
  if (start === caret) return null

  const token = text.slice(start, caret)
  if (!/^[A-Za-z]/.test(token) || isProtected(text, start, caret)) return null

  const fixed = correctToken(token)
  if (fixed === token) return null
  return {
    value: text.slice(0, start) + fixed + text.slice(caret),
    caret: start + fixed.length,
  }
}

export function proseBoundary(key: string): string | null {
  if (key === " ") return " "
  if (key === "Enter") return "\n"
  if (key.length === 1 && ",.!?;:)]}".includes(key)) return key
  return null
}
