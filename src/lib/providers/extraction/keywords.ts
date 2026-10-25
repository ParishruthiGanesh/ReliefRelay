/**
 * Resource, scale and intent vocabulary for the deterministic extractor.
 *
 * This is what makes the built-in catalogue languages genuinely usable with no
 * API key: a request in Hindi, Tamil, Telugu or Spanish is read here, not just
 * replied to. It is keyword matching, not comprehension — it finds which
 * resources were named and how many people were mentioned, and leaves anything
 * it is not sure about as unknown for a coordinator to confirm.
 *
 * Its limits are stated rather than hidden: nuance, negation ("we do NOT need
 * water") and unusual phrasing are beyond it in every language including
 * English. Claude handles those when configured, and the interface reports
 * which extractor actually ran.
 */

export type CategoryId = 'meal_packs' | 'drinking_water' | 'hygiene_kits' | 'shelter_spaces';

export interface LanguageVocabulary {
  categories: Record<CategoryId, RegExp>;
  /** Canonical-unit counts, e.g. "20 litros", "50 पैकेट". */
  quantities: Partial<Record<CategoryId, RegExp[]>>;
  /** Counts in a unit we refuse to convert, e.g. bottles. */
  ambiguous: Partial<Record<CategoryId, Array<{ re: RegExp; unitWord: string }>>>;
  groupSize: RegExp[];
  need: RegExp;
  offer: RegExp;
  affirmative: RegExp;
  negative: RegExp;
  skip: RegExp;
  approximate: RegExp;
  urgent: RegExp;
  critical: RegExp;
  /** Number words to rewrite into digits before matching. */
  numberWords?: Record<string, number>;
}

const EN: LanguageVocabulary = {
  categories: {
    meal_packs: /\b(food|meals?|meal packs?|ration|rations|something to eat|hungry|cooked food|dry food|food packs?)\b/i,
    drinking_water: /\b(water|drinking water|clean water|thirsty|no water)\b/i,
    hygiene_kits: /\b(hygiene|sanitary|sanitation|soap|toiletries|nappies|diapers|sanitary pads|washing)\b/i,
    shelter_spaces: /\b(shelter|somewhere to stay|place to stay|sleep|beds?|spaces?|accommodation|roof over)\b/i,
  },
  quantities: {
    meal_packs: [/\b(\d{1,6})\s*(?:meal\s*packs?|food\s*packs?|packs?|rations?|meals?)\b/i],
    drinking_water: [
      /\b(\d{1,6})\s*(?:litres?|liters?|ltrs?|l)\b(?:\s*of)?(?:\s*(?:drinking\s*)?water)?/i,
      /\bwater\b[^.]{0,15}\b(\d{1,6})\s*(?:litres?|liters?|ltrs?)\b/i,
    ],
    hygiene_kits: [/\b(\d{1,6})\s*(?:hygiene\s*kits?|sanitation\s*kits?|kits?)\b/i],
    shelter_spaces: [/\b(\d{1,6})\s*(?:shelter\s*spaces?|spaces?|beds?|places?|spots?)\b/i],
  },
  ambiguous: {
    meal_packs: [
      { re: /\b(\d{1,6})\s*(?:boxes?|cartons?|crates?|sacks?|bags?)\b[^.]{0,20}\b(?:food|meals?|ration)/i, unitWord: 'boxes' },
      { re: /\b(?:food|meals?|rations?)\b[^.]{0,20}\b(\d{1,6})\s*(?:boxes?|cartons?|crates?|sacks?|bags?)\b/i, unitWord: 'boxes' },
    ],
    drinking_water: [
      { re: /\b(\d{1,6})\s*(?:bottles?|cans?|jerry\s?cans?|containers?|packs?|cases?)\b[^.]{0,15}\b(?:of\s*)?(?:drinking\s*)?water\b/i, unitWord: 'bottles' },
      { re: /\bwater\b[^.]{0,15}\b(\d{1,6})\s*(?:bottles?|cans?|jerry\s?cans?|containers?|cases?)\b/i, unitWord: 'bottles' },
    ],
  },
  groupSize: [
    /\b(?:there (?:are|is)|we are|we're)\s*(?:about|around|roughly|approximately)?\s*(\d{1,6})\s*(?:people|persons|of us|adults|families|children|here)?\b/i,
    /\b(\d{1,6})\s*(?:people|persons|individuals|survivors|residents)\b/i,
    /\bfamily of\s*(\d{1,6})\b/i,
    /\bgroup of\s*(\d{1,6})\b/i,
    /\b(\d{1,6})\s*of us\b/i,
  ],
  need: /\b(we|i|they)\s+(need|needs|require|want)\b|\bneed\b|\bwe have no\b|\bran? out of\b|\brunning out of\b|\bshort of\b|\bplease send\b|\bcan you send\b|\bwe are without\b|\bno (food|water|drinking water)\b/i,
  offer: /\b(we|i)\s+(can|could|will|would)\s+(provide|supply|donate|give|bring|deliver|spare|send|offer)\b|\boffering\b|\bwe have\b[^.]*\b(available|spare|to (give|donate|spare))\b|\bhappy to (provide|donate|help with)\b/i,
  affirmative: /\b(yes|yeah|yep|yup|correct|that'?s right|right|ok|okay|sure|please do|go ahead|confirm|submit it)\b/i,
  negative: /\b(no|nope|not really|that'?s wrong|incorrect|don'?t|do not|cancel|stop)\b/i,
  skip: /\b(i don'?t know|dont know|not sure|no idea|skip|pass|can'?t say|cannot say|unsure|unknown)\b/i,
  approximate: /\b(about|around|roughly|approximately|maybe|more or less|or so)\b/i,
  urgent: /\b(urgent|urgently|immediately|right now|as soon as possible|asap|desperate)\b/i,
  critical: /\b(critical|life threatening|emergency)\b/i,
};

const ES: LanguageVocabulary = {
  categories: {
    meal_packs: /(comida|alimentos?|raciones?|comer|hambre|paquetes de comida|v[ií]veres)/i,
    drinking_water: /(agua|agua potable|beber|sed)/i,
    hygiene_kits: /(higiene|jab[oó]n|aseo|kits? de higiene|pa[ñn]ales|compresas)/i,
    shelter_spaces: /(refugio|alojamiento|plazas?|dormir|albergue|d[oó]nde quedarnos)/i,
  },
  quantities: {
    meal_packs: [/\b(\d{1,6})\s*(?:paquetes? de comida|raciones?|comidas?|paquetes?)\b/i],
    drinking_water: [/\b(\d{1,6})\s*(?:litros?|l)\b(?:\s*de)?(?:\s*agua)?/i],
    hygiene_kits: [/\b(\d{1,6})\s*(?:kits? de higiene|kits?)\b/i],
    shelter_spaces: [/\b(\d{1,6})\s*(?:plazas?|camas?|sitios?)\b/i],
  },
  ambiguous: {
    drinking_water: [
      { re: /\b(\d{1,6})\s*(?:botellas?|bidones?|garrafas?|cajas?)\b[^.]{0,15}(?:de\s*)?agua/i, unitWord: 'botellas' },
      { re: /agua[^.]{0,15}\b(\d{1,6})\s*(?:botellas?|bidones?|garrafas?|cajas?)\b/i, unitWord: 'botellas' },
    ],
  },
  groupSize: [
    /\b(?:somos|hay|estamos)\s*(?:unas?|alrededor de|m[aá]s o menos)?\s*(\d{1,6})\b/i,
    /\b(\d{1,6})\s*(?:personas?|gente|familias?|ni[ñn]os?|habitantes?)\b/i,
    /\bfamilia de\s*(\d{1,6})\b/i,
    /\bgrupo de\s*(\d{1,6})\b/i,
  ],
  need: /(necesitamos|necesito|necesitan|hace falta|requerimos|no tenemos|nos hemos quedado sin|por favor env[ií]en|falta)/i,
  offer: /(podemos (proporcionar|donar|dar|traer|entregar|aportar)|ofrecemos|tenemos[^.]*disponibles?|queremos donar)/i,
  affirmative: /\b(s[ií]|claro|correcto|vale|de acuerdo|exacto|as[ií] es|adelante|env[ií]alo)\b/i,
  negative: /\b(no|incorrecto|est[aá] mal|cancela|para)\b/i,
  skip: /(no lo s[eé]|no s[eé]|ni idea|no estoy seguro|omitir|saltar)/i,
  approximate: /\b(unos|unas|alrededor|aproximadamente|m[aá]s o menos|quiz[aá]s)\b/i,
  urgent: /\b(urgente|urgentemente|inmediatamente|ahora mismo|cuanto antes)\b/i,
  critical: /\b(cr[ií]tico|emergencia|peligro de muerte)\b/i,
  numberWords: {
    cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
    ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
    quince: 15, dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18,
    diecinueve: 19, veinte: 20, veintiuno: 21, veintidós: 22, veintidos: 22,
    veintitrés: 23, veintitres: 23, veinticuatro: 24, veinticinco: 25,
    treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
    ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200,
  },
};

const HI: LanguageVocabulary = {
  categories: {
    meal_packs: /(खाना|खाने|भोजन|राशन|भूख|खाद्य)/,
    drinking_water: /(पानी|पीने का पानी|जल|प्यास)/,
    hygiene_kits: /(स्वच्छता|साबुन|सफ़ाई|सफाई|किट|डायपर)/,
    shelter_spaces: /(आश्रय|रहने|ठहरने|जगह|बिस्तर|सोने)/,
  },
  quantities: {
    meal_packs: [/(\d{1,6})\s*(?:पैकेट|खाने के पैकेट|भोजन)/],
    drinking_water: [/(\d{1,6})\s*(?:लीटर)/],
    hygiene_kits: [/(\d{1,6})\s*(?:किट|किटें)/],
    shelter_spaces: [/(\d{1,6})\s*(?:जगह|जगहें|बिस्तर)/],
  },
  ambiguous: {
    drinking_water: [{ re: /(\d{1,6})\s*(?:बोतल|बोतलें|कैन)/, unitWord: 'बोतल' }],
  },
  groupSize: [
    /(\d{1,6})\s*(?:लोग|लोगों|व्यक्ति|जन|बच्चे|परिवार)/,
    /यहाँ\s*(?:लगभग)?\s*(\d{1,6})/,
    /हम\s*(\d{1,6})\s*(?:लोग|हैं)/,
  ],
  need: /(चाहिए|ज़रूरत|जरूरत|नहीं है|ख़त्म हो गया|खत्म हो गया|भेजिए|भेजें)/,
  offer: /(दे सकते|दे सकता|दे सकती|देना चाहते|उपलब्ध है|दान)/,
  affirmative: /(हाँ|हां|जी|ठीक है|सही है|बिल्कुल|भेज दीजिए)/,
  negative: /(नहीं|ग़लत|गलत|रद्द)/,
  skip: /(मुझे नहीं पता|पता नहीं|मालूम नहीं|यकीन नहीं)/,
  approximate: /(लगभग|करीब|क़रीब|तक़रीबन|तकरीबन)/,
  urgent: /(तुरंत|जल्दी|अत्यावश्यक|फ़ौरन|फौरन)/,
  critical: /(आपात|जानलेवा|गंभीर)/,
  numberWords: {
    शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, छः: 6,
    सात: 7, आठ: 8, नौ: 9, दस: 10, ग्यारह: 11, बारह: 12, तेरह: 13, चौदह: 14,
    पंद्रह: 15, सोलह: 16, सत्रह: 17, अठारह: 18, उन्नीस: 19, बीस: 20,
    पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70, अस्सी: 80,
    नब्बे: 90, सौ: 100,
  },
};

const TA: LanguageVocabulary = {
  categories: {
    meal_packs: /(உணவு|சாப்பாடு|உணவுப்|பசி|ரேஷன்)/,
    drinking_water: /(தண்ணீர்|குடிநீர்|நீர்|தாகம்)/,
    hygiene_kits: /(சுகாதார|சோப்பு|சுத்தம்|கிட்)/,
    shelter_spaces: /(தங்கும்|தங்க|இடம்|படுக்கை|தஞ்சம்)/,
  },
  quantities: {
    meal_packs: [/(\d{1,6})\s*(?:பொட்டலம்|பொட்டலங்கள்|உணவு)/],
    drinking_water: [/(\d{1,6})\s*(?:லிட்டர்)/],
    hygiene_kits: [/(\d{1,6})\s*(?:கிட்|கிட்கள்)/],
    shelter_spaces: [/(\d{1,6})\s*(?:இடம்|இடங்கள்|படுக்கை)/],
  },
  ambiguous: {
    drinking_water: [{ re: /(\d{1,6})\s*(?:பாட்டில்|கேன்)/, unitWord: 'பாட்டில்' }],
  },
  groupSize: [
    /(\d{1,6})\s*(?:பேர்|நபர்|மக்கள்|குழந்தைகள்|குடும்பம்)/,
    /இங்கே\s*(\d{1,6})/,
  ],
  need: /(தேவை|வேண்டும்|இல்லை|தீர்ந்து|அனுப்புங்கள்)/,
  offer: /(கொடுக்க முடியும்|வழங்க முடியும்|தர முடியும்|நன்கொடை)/,
  affirmative: /(ஆம்|ஆமாம்|சரி|சரியானது)/,
  negative: /(இல்லை|தவறு|ரத்து)/,
  skip: /(எனக்குத் தெரியாது|தெரியவில்லை|உறுதியாக தெரியவில்லை)/,
  approximate: /(சுமார்|ஏறக்குறைய|கிட்டத்தட்ட)/,
  urgent: /(அவசரம்|உடனடியாக|விரைவாக)/,
  critical: /(அவசரநிலை|உயிருக்கு ஆபத்து)/,
  numberWords: {
    ஒன்று: 1, இரண்டு: 2, மூன்று: 3, நான்கு: 4, ஐந்து: 5, ஆறு: 6, ஏழு: 7,
    எட்டு: 8, ஒன்பது: 9, பத்து: 10, பதினைந்து: 15, இருபது: 20,
    இருபத்தைந்து: 25, முப்பது: 30, நாற்பது: 40, ஐம்பது: 50, நூறு: 100,
  },
};

const TE: LanguageVocabulary = {
  categories: {
    meal_packs: /(ఆహారం|తిండి|భోజనం|ఆకలి|రేషన్)/,
    drinking_water: /(నీరు|తాగునీరు|నీళ్లు|నీళ్ళు|దాహం)/,
    hygiene_kits: /(పరిశుభ్రత|సబ్బు|శుభ్రత|కిట్)/,
    shelter_spaces: /(ఆశ్రయం|ఉండటానికి|స్థలం|పడక|తలదాచు)/,
  },
  quantities: {
    meal_packs: [/(\d{1,6})\s*(?:ప్యాకెట్|ప్యాకెట్లు|భోజనం)/],
    drinking_water: [/(\d{1,6})\s*(?:లీటర్|లీటర్లు)/],
    hygiene_kits: [/(\d{1,6})\s*(?:కిట్|కిట్లు)/],
    shelter_spaces: [/(\d{1,6})\s*(?:స్థలం|స్థలాలు|పడకలు)/],
  },
  ambiguous: {
    drinking_water: [{ re: /(\d{1,6})\s*(?:బాటిల్|బాటిళ్లు|క్యాన్)/, unitWord: 'బాటిల్' }],
  },
  groupSize: [
    /(\d{1,6})\s*(?:మంది|వ్యక్తులు|పిల్లలు|కుటుంబం)/,
    /ఇక్కడ\s*(\d{1,6})/,
  ],
  need: /(కావాలి|అవసరం|లేదు|అయిపోయింది|పంపండి)/,
  offer: /(ఇవ్వగలం|అందించగలం|ఇవ్వగలను|విరాళం)/,
  affirmative: /(అవును|సరే|సరి|ఖచ్చితంగా)/,
  negative: /(కాదు|తప్పు|రద్దు)/,
  skip: /(నాకు తెలియదు|తెలియదు|ఖచ్చితంగా తెలియదు)/,
  approximate: /(సుమారు|దాదాపు|రమారమి)/,
  urgent: /(అత్యవసరం|వెంటనే|తక్షణమే)/,
  critical: /(ప్రాణాపాయం|అత్యవసర పరిస్థితి)/,
  numberWords: {
    ఒకటి: 1, రెండు: 2, మూడు: 3, నాలుగు: 4, ఐదు: 5, ఆరు: 6, ఏడు: 7,
    ఎనిమిది: 8, తొమ్మిది: 9, పది: 10, పదిహేను: 15, ఇరవై: 20,
    ఇరవైఐదు: 25, ముప్పై: 30, నలభై: 40, యాభై: 50, వంద: 100,
  },
};

export const VOCABULARIES: Record<string, LanguageVocabulary> = {
  en: EN,
  es: ES,
  hi: HI,
  ta: TA,
  te: TE,
};

/** Falls back to English, which is also the right behaviour for place names. */
export function vocabularyFor(language: string): LanguageVocabulary {
  return VOCABULARIES[language] ?? EN;
}

/** Languages the deterministic extractor can actually read. */
export const RULE_EXTRACTION_LANGUAGES = Object.keys(VOCABULARIES);
